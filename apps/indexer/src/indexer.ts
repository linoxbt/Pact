import { decodeEventLog, type Address, type Hex, type PublicClient } from 'viem';
import { AuthorityRegistryAbi, CommitmentLedgerAbi, PactAccountAbi, PactAccountFactoryAbi,
  ObligationManagerAbi, SettlementVaultAbi, ReceiptRegistryAbi } from '@pact/abis';
import { jsonSafe, type Database } from '@pact/operations';
import { createHash } from 'node:crypto';

const allAbis = [...AuthorityRegistryAbi, ...CommitmentLedgerAbi, ...PactAccountAbi,
  ...ObligationManagerAbi, ...SettlementVaultAbi, ...ReceiptRegistryAbi, ...PactAccountFactoryAbi] as const;
type Cursor = { block_number: string; block_hash: Hex };
// Sparse historical checkpoints bound disk use without losing the ability to
// find an ancestor after a deep reorg. Keep a dense recent window for fast
// normal rollback; older gaps are replayed from the last common checkpoint.
const checkpointInterval = 4096n;
const recentWindow = 256n;

export function decodePactEvent(log: { data: Hex; topics: readonly Hex[] }) {
  if (log.topics.length === 0) return null;
  try {
    const decoded = decodeEventLog({ abi: allAbis, data: log.data,
      topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
    return { name: decoded.eventName, args: jsonSafe(decoded.args) };
  } catch { return null; }
}

export class PactIndexer {
  private configurationChecked = false;
  constructor(readonly database: Database, readonly rpc: PublicClient,
    readonly chainId: number, readonly addresses: readonly Address[],
    readonly startBlock: bigint, readonly finalityBlocks: number,
    readonly batchSize = 20n, readonly factory?: Address) {}

  async tick(): Promise<bigint | null> {
    if (!this.configurationChecked) {
      // Adding a factory to an existing cursor must replay its creation history.
      // Retain historical events; inserts are idempotent across the replay.
      const fingerprint = createHash('sha256').update(JSON.stringify({
        addresses: [...this.addresses].map(a => a.toLowerCase()).sort(),
        factory: this.factory?.toLowerCase(), start: this.startBlock.toString(),
      })).digest('hex');
      const client = await this.database.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [0x50414354 + this.chainId]);
        const previous = await client.query<{fingerprint:string}>(
          'SELECT fingerprint FROM pact_indexer_configuration WHERE chain_id=$1', [this.chainId]);
        if (previous.rows[0]?.fingerprint !== fingerprint) {
          await client.query('DELETE FROM pact_indexer_cursor WHERE chain_id=$1', [this.chainId]);
          await client.query('DELETE FROM pact_indexer_blocks WHERE chain_id=$1', [this.chainId]);
          await client.query(`INSERT INTO pact_indexer_configuration(chain_id,fingerprint) VALUES($1,$2)
            ON CONFLICT(chain_id) DO UPDATE SET fingerprint=excluded.fingerprint,updated_at=now()`,
            [this.chainId,fingerprint]);
        }
        await client.query('COMMIT');
        this.configurationChecked = true;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
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
    const logs = await this.rpc.getLogs({ address: [...this.addresses, ...(this.factory ? [this.factory] : [])],
      fromBlock: from, toBlock: to });
    const created: {address:Address;principal:Address;block:bigint}[] = [];
    if (this.factory) {
      for (const log of logs) {
        if (log.address.toLowerCase() !== this.factory.toLowerCase() || log.blockNumber === null) continue;
        const decoded = decodePactEvent(log);
        if (decoded?.name === 'AccountCreated') {
          const args = decoded.args as {account:Address;principal:Address};
          created.push({address:args.account,principal:args.principal,block:log.blockNumber});
        }
      }
      const known = await this.database.query<{address:Address}>(
        'SELECT address FROM pact_indexed_accounts WHERE chain_id=$1 AND factory=$2',
        [this.chainId,this.factory.toLowerCase()]);
      const accounts = [...new Set([...known.rows.map(row=>row.address),...created.map(row=>row.address)])];
      for (let i=0;i<accounts.length;i+=100) logs.push(...await this.rpc.getLogs({
        address:accounts.slice(i,i+100),fromBlock:from,toBlock:to }));
    }
    const blocks = [];
    // During catch-up, only log-bearing blocks, sparse checkpoints and the
    // batch end need headers. Recent blocks retain the dense rollback window.
    const needed = new Set<bigint>([to]);
    for (let number=from;number<=to;number++)
      if(number>=safeHead-recentWindow+1n || number%checkpointInterval===0n) needed.add(number);
    for(const log of logs) {
      if(log.blockNumber===null || log.blockNumber<from || log.blockNumber>to)
        throw new Error('RPC returned a log outside the requested block range');
      needed.add(log.blockNumber);
    }
    const blockNumbers=[...needed].sort((a,b)=>a<b?-1:a>b?1:0);
    // Public RPCs commonly reject bursts of dozens of concurrent block requests.
    // Keep each burst small while preserving ordered, reorg-checkable headers.
    for (let offset = 0; offset < blockNumbers.length; offset += 5) {
      blocks.push(...await Promise.all(blockNumbers.slice(offset,offset+5).map(blockNumber=>
        this.rpc.getBlock({ blockNumber }))));
    }
    const headerHashes = new Map(blocks.map(block => [block.number.toString(), block.hash.toLowerCase()]));
    if (logs.some(log => log.blockNumber === null || log.blockHash === null ||
        headerHashes.get(log.blockNumber.toString()) !== log.blockHash.toLowerCase()))
      throw new Error('RPC returned logs from a different chain view');
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [0x50414354 + this.chainId]);
      const lockedCursor = await client.query<Cursor>(
        'SELECT block_number,block_hash FROM pact_indexer_cursor WHERE chain_id=$1', [this.chainId]);
      if ((lockedCursor.rows[0]?.block_number ?? null) !== (next.rows[0]?.block_number ?? null) ||
          (lockedCursor.rows[0]?.block_hash ?? null) !== (next.rows[0]?.block_hash ?? null))
        throw new Error('Indexer cursor changed while fetching chain data');
      for (const account of created) await client.query(`INSERT INTO pact_indexed_accounts
        (chain_id,factory,address,principal,created_block) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(chain_id,address) DO UPDATE SET created_block=excluded.created_block`,
        [this.chainId,this.factory!.toLowerCase(),account.address.toLowerCase(),account.principal.toLowerCase(),account.block.toString()]);
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
      await client.query(
        `DELETE FROM pact_indexer_blocks WHERE chain_id=$1 AND block_number<$2
         AND block_number % $3 <> 0`,
        [this.chainId, (to - recentWindow + 1n).toString(), checkpointInterval.toString()]);
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
      await client.query('DELETE FROM pact_indexed_accounts WHERE chain_id=$1 AND created_block>$2',[this.chainId,from]);
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
