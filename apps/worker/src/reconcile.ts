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
      `SELECT id,actor,kind,action_hash,target_address,expected_event,grant_id,reservation_id,tx_hash,submitted_at
       FROM pact_operations WHERE state IN ('submitted','recoverable') AND tx_hash IS NOT NULL
       ORDER BY submitted_at LIMIT 100`);
    for (const row of result.rows) await this.reconcile(row);
    return result.rows.length;
  }

  private async reconcile(row: PendingRow): Promise<void> {
    let receipt;
    try { receipt = await this.rpc.getTransactionReceipt({ hash: row.tx_hash }); }
    catch {
      if (Date.now() - row.submitted_at.getTime() > 15 * 60_000)
        await this.update(row.id, 'recoverable', 'RECEIPT_NOT_FOUND');
      return;
    }
    const head = await this.rpc.getBlockNumber();
    if (head < receipt.blockNumber + BigInt(this.finalityBlocks)) return;
    const canonicalBlock = await this.rpc.getBlock({ blockNumber: receipt.blockNumber });
    if (canonicalBlock.hash !== receipt.blockHash) {
      await this.update(row.id, 'recoverable', 'BLOCK_REORG');
      return;
    }
    if (receipt.status !== 'success') {
      await this.update(row.id, 'reverted', 'EXECUTION_REVERTED');
      return;
    }
    if (receipt.to?.toLowerCase() !== row.target_address.toLowerCase() ||
        !matchesExpectedEvent(row, receipt.logs)) {
      await this.update(row.id, 'recoverable', 'EXPECTED_EVENT_MISSING');
      return;
    }
    await this.confirm(row);
  }

  private async update(id: string, state: 'confirmed' | 'reverted' | 'recoverable', code: string | null) {
    await this.database.query(
      `UPDATE pact_operations SET state=$2,error_code=$3,updated_at=now()
       WHERE id=$1 AND state IN ('submitted','recoverable')`, [id, state, code]);
  }

  private async confirm(row: PendingRow): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE pact_operations SET state='confirmed',error_code=NULL,updated_at=now()
         WHERE id=$1 AND state IN ('submitted','recoverable')`, [row.id]);
      if (row.kind === 'transfer-execution' && row.reservation_id !== null) await client.query(
        `UPDATE pact_approval_requests SET state='consumed',consumed_at=now(),updated_at=now()
         WHERE grant_id=$1 AND reservation_id=$2 AND lower(intent_hash)=lower($3)
           AND state='approved'`, [row.grant_id, row.reservation_id, row.action_hash]);
      await client.query('COMMIT');
    } catch (cause) { await client.query('ROLLBACK'); throw cause; }
    finally { client.release(); }
  }
}
