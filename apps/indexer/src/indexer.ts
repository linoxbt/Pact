import { decodeEventLog, type Address, type Hex, type PublicClient } from 'viem';
import { AuthorityRegistryAbi, CommitmentLedgerAbi, PactAccountAbi,
  ObligationManagerAbi, SettlementVaultAbi, ReceiptRegistryAbi } from '@pact/abis';
import { jsonSafe, type Database } from '@pact/operations';

const allAbis = [...AuthorityRegistryAbi, ...CommitmentLedgerAbi, ...PactAccountAbi,
  ...ObligationManagerAbi, ...SettlementVaultAbi, ...ReceiptRegistryAbi] as const;
type Cursor = { block_number: string; block_hash: Hex };

export function decodePactEvent(log: { data: Hex; topics: readonly Hex[] }) {
  if (log.topics.length === 0) return null;
  try {
    const decoded = decodeEventLog({ abi: allAbis, data: log.data,
      topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
    return { name: decoded.eventName, args: jsonSafe(decoded.args) };
  } catch { return null; }
}

export class PactIndexer {
  constructor(readonly database: Database, readonly rpc: PublicClient,
    readonly chainId: number, readonly addresses: readonly Address[],
    readonly startBlock: bigint, readonly finalityBlocks: number,
    readonly batchSize = 100n) {}

  async tick(): Promise<bigint | null> {
    const latest = await this.rpc.getBlockNumber();
    const safeHead = latest - BigInt(this.finalityBlocks);
    if (safeHead < this.startBlock) return null;
    const current = await this.database.query<Cursor>(
      'SELECT block_number,block_hash FROM pact_indexer_cursor WHERE chain_id=$1', [this.chainId]);
    const cursor = current.rows[0];
    if (cursor) {
      const block = await this.rpc.getBlock({ blockNumber: BigInt(cursor.block_number) });
      if (block.hash !== cursor.block_hash) await this.rollbackToCommonAncestor(BigInt(cursor.block_number));
    }
    const next = await this.database.query<Cursor>(
      'SELECT block_number,block_hash FROM pact_indexer_cursor WHERE chain_id=$1', [this.chainId]);
    const from = next.rows[0] ? BigInt(next.rows[0].block_number) + 1n : this.startBlock;
    if (from > safeHead) return null;
    const to = from + this.batchSize - 1n < safeHead ? from + this.batchSize - 1n : safeHead;
    const [logs, blocks] = await Promise.all([
      this.rpc.getLogs({ address: [...this.addresses], fromBlock: from, toBlock: to }),
      Promise.all(Array.from({ length: Number(to - from + 1n) }, (_, offset) =>
        this.rpc.getBlock({ blockNumber: from + BigInt(offset) }))),
    ]);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [0x50414354 + this.chainId]);
      for (const block of blocks) await client.query(
        `INSERT INTO pact_indexer_blocks (chain_id,block_number,block_hash) VALUES ($1,$2,$3)
         ON CONFLICT (chain_id,block_number) DO UPDATE SET block_hash=excluded.block_hash`,
        [this.chainId, block.number.toString(), block.hash]);
      for (const log of logs) {
        const decoded = decodePactEvent(log);
        if (!decoded || log.blockNumber === null || log.blockHash === null ||
            log.transactionHash === null || log.logIndex === null) continue;
        await client.query(
          `INSERT INTO pact_chain_events
           (chain_id,block_number,block_hash,tx_hash,log_index,contract_address,event_name,args)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (chain_id,tx_hash,log_index) DO UPDATE SET
             block_number=excluded.block_number,block_hash=excluded.block_hash,
             contract_address=excluded.contract_address,event_name=excluded.event_name,args=excluded.args`,
          [this.chainId, log.blockNumber.toString(), log.blockHash, log.transactionHash,
            log.logIndex, log.address.toLowerCase(), decoded.name, JSON.stringify(decoded.args)]);
      }
      await client.query(
        `INSERT INTO pact_indexer_cursor (chain_id,block_number,block_hash) VALUES ($1,$2,$3)
         ON CONFLICT (chain_id) DO UPDATE SET block_number=excluded.block_number,
           block_hash=excluded.block_hash,updated_at=now()`,
        [this.chainId, to.toString(), blocks.at(-1)!.hash]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return to;
  }

  private async rollbackToCommonAncestor(cursor: bigint): Promise<void> {
    const rows = await this.database.query<Cursor>(
      `SELECT block_number,block_hash FROM pact_indexer_blocks
       WHERE chain_id=$1 AND block_number<=$2 ORDER BY block_number DESC`,
      [this.chainId, cursor.toString()]);
    let ancestor: bigint | null = null;
    for (const row of rows.rows) {
      const chain = await this.rpc.getBlock({ blockNumber: BigInt(row.block_number) });
      if (chain.hash === row.block_hash) { ancestor = BigInt(row.block_number); break; }
    }
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [0x50414354 + this.chainId]);
      const from = (ancestor ?? this.startBlock - 1n).toString();
      await client.query('DELETE FROM pact_chain_events WHERE chain_id=$1 AND block_number>$2', [this.chainId, from]);
      await client.query('DELETE FROM pact_indexer_blocks WHERE chain_id=$1 AND block_number>$2', [this.chainId, from]);
      if (ancestor === null) await client.query('DELETE FROM pact_indexer_cursor WHERE chain_id=$1', [this.chainId]);
      else await client.query(
        `UPDATE pact_indexer_cursor SET block_number=$2,block_hash=$3,updated_at=now() WHERE chain_id=$1`,
        [this.chainId, ancestor.toString(), rows.rows.find(row => BigInt(row.block_number) === ancestor)!.block_hash]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
