import { createPublicClient, http } from 'viem';
import { createDatabase, loadCoreConfig, migrate, writeHeartbeat } from '@pact/operations';
import { randomUUID } from 'node:crypto';
import { PactIndexer } from './indexer.js';

const config = loadCoreConfig();
const startText = process.env.PACT_INDEXER_START_BLOCK;
if (!startText || !/^(0|[1-9]\d*)$/.test(startText))
  throw new Error('PACT_INDEXER_START_BLOCK must be a nonnegative integer');
const database = createDatabase(config.databaseUrl);
await migrate(database);
const rpc = createPublicClient({ transport: http(config.rpcUrl) });
if (await rpc.getChainId() !== config.chainId) throw new Error('RPC chain ID mismatch');
const indexer = new PactIndexer(database, rpc, config.chainId, Object.values(config.addresses),
  BigInt(startText), config.finalityBlocks);
let running = true;
const instanceId = randomUUID();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { running = false; });
while (running) {
  try { await indexer.tick(); await writeHeartbeat(database, 'indexer', instanceId, true); }
  catch (error) {
    console.error('Indexer tick failed', error instanceof Error ? error.name : 'UNKNOWN');
    try { await writeHeartbeat(database, 'indexer', instanceId, false, 'TICK_FAILED'); }
    catch { console.error('Indexer heartbeat unavailable'); }
  }
  await new Promise(resolve => setTimeout(resolve, 2_000));
}
await database.end();
