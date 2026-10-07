import { decodeEventLog, type Address, type Hex, type PublicClient } from 'viem';
import { CommitmentLedgerAbi, ObligationManagerAbi, PactAccountAbi } from '@pact/abis';
import type { Database } from '@pact/operations';

type PendingRow = { id: string; actor: Address; kind: string; action_hash: Hex; target_address: Address;
  expected_event: string; grant_id: string | null; reservation_id: string | null;
  tx_hash: Hex; submitted_at: Date };

export function matchesExpectedEvent(row: PendingRow, logs: readonly {
  address: Address; data: Hex; topics: readonly Hex[] }[]): boolean {
  const abi = row.expected_event === 'Reserved' ? CommitmentLedgerAbi
    : row.expected_event === 'TransferExecuted' ? PactAccountAbi
    : row.expected_event === 'ObligationCreated' ? ObligationManagerAbi : null;
  if (!abi) return false;
  for (const log of logs) {
    if (log.address.toLowerCase() !== row.target_address.toLowerCase()) continue;
    if (log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({ abi, data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
      if (decoded.eventName !== row.expected_event) continue;
      const args = decoded.args as Record<string, unknown>;
      const hash = args.intentHash ?? args.termsDigest;
      if (typeof hash !== 'string' || hash.toLowerCase() !== row.action_hash.toLowerCase()) continue;
      const grantId = args.grantId;
      if (row.grant_id !== null && String(grantId) !== row.grant_id) continue;
      return true;
    } catch { /* This log belongs to another event. */ }
  }
  return false;
}

export class Reconciler {
  constructor(readonly database: Database, readonly rpc: PublicClient,
    readonly finalityBlocks: number) {}

  async tick(): Promise<number> {
    const result = await this.database.query<PendingRow>(
      `WITH due AS (
         SELECT id FROM pact_operations WHERE state IN ('submitted','recoverable') AND tx_hash IS NOT NULL
           AND next_attempt_at<=now() ORDER BY next_attempt_at,submitted_at
           LIMIT 100 FOR UPDATE SKIP LOCKED
       ) UPDATE pact_operations o SET reconcile_attempts=reconcile_attempts+1,
         next_attempt_at=now()+make_interval(secs=>LEAST(3600,30*power(2,LEAST(reconcile_attempts,7)))::integer)
         FROM due WHERE o.id=due.id
         RETURNING o.id,o.actor,o.kind,o.action_hash,o.target_address,o.expected_event,
           o.grant_id,o.reservation_id,o.tx_hash,o.submitted_at`);
    for (const row of result.rows) {
      try { await this.reconcile(row); }
      catch { await this.update(row,'recoverable','RECONCILIATION_RETRY'); }
    }
    return result.rows.length;
  }

  private async reconcile(row: PendingRow): Promise<void> {
    let receipt;
    try { receipt = await this.rpc.getTransactionReceipt({ hash: row.tx_hash }); }
    catch {
      if (Date.now() - row.submitted_at.getTime() > 15 * 60_000)
        await this.update(row, 'recoverable', 'RECEIPT_NOT_FOUND');
      return;
    }
    const head = await this.rpc.getBlockNumber();
    if (head < receipt.blockNumber + BigInt(this.finalityBlocks)) return;
    const canonicalBlock = await this.rpc.getBlock({ blockNumber: receipt.blockNumber });
    if (canonicalBlock.hash !== receipt.blockHash) {
      await this.update(row, 'recoverable', 'BLOCK_REORG');
      return;
    }
    if (receipt.status !== 'success') {
      await this.update(row, 'reverted', 'EXECUTION_REVERTED');
      return;
    }
    if (receipt.to?.toLowerCase() !== row.target_address.toLowerCase() ||
        !matchesExpectedEvent(row, receipt.logs)) {
      await this.update(row, 'recoverable', 'EXPECTED_EVENT_MISSING');
      return;
    }
    await this.confirm(row);
  }

  private async update(row: PendingRow, state: 'confirmed' | 'reverted' | 'recoverable', code: string | null) {
    await this.database.query(
      `UPDATE pact_operations SET state=$2,error_code=$3,updated_at=now()
       WHERE id=$1 AND tx_hash=$4 AND state IN ('submitted','recoverable')`,
      [row.id, state, code, row.tx_hash]);
  }

  private async confirm(row: PendingRow): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const confirmed = await client.query(
        `UPDATE pact_operations SET state='confirmed',error_code=NULL,updated_at=now()
         WHERE id=$1 AND tx_hash=$2 AND state IN ('submitted','recoverable') RETURNING id`,
        [row.id, row.tx_hash]);
      if (confirmed.rowCount === 1 && row.kind === 'transfer-execution' && row.reservation_id !== null) await client.query(
        `UPDATE pact_approval_requests SET state='consumed',consumed_at=now(),updated_at=now()
         WHERE grant_id=$1 AND reservation_id=$2 AND lower(intent_hash)=lower($3)
           AND state='approved'`, [row.grant_id, row.reservation_id, row.action_hash]);
      await client.query('COMMIT');
    } catch (cause) { await client.query('ROLLBACK'); throw cause; }
    finally { client.release(); }
  }
}
