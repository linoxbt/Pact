import { createPublicClient, http, isAddress } from 'viem';
import { createDatabase, loadCoreConfig, migrate, writeHeartbeat } from '@pact/operations';
import { randomUUID } from 'node:crypto';
import { PactIndexer } from './indexer.js';

const config = loadCoreConfig();
const startText = process.env.PACT_INDEXER_START_BLOCK;
const batchSize=Number(process.env.PACT_INDEXER_BATCH_SIZE ?? '100');
if(!Number.isSafeInteger(batchSize) || batchSize<1 || batchSize>1000)
  throw new Error('PACT_INDEXER_BATCH_SIZE must be between 1 and 1000');
if (!startText || !/^(0|[1-9]\d*)$/.test(startText))
  throw new Error('PACT_INDEXER_START_BLOCK must be a nonnegative integer');
const database = createDatabase(config.databaseUrl);
await migrate(database);
const rpc = createPublicClient({ transport: http(config.rpcUrl) });
const factory = process.env.PACT_ACCOUNT_FACTORY;
if (factory && !isAddress(factory)) throw new Error('Invalid PACT_ACCOUNT_FACTORY');
if (await rpc.getChainId() !== config.chainId) throw new Error('RPC chain ID mismatch');
const indexer = new PactIndexer(database, rpc, config.chainId, Object.values(config.addresses),
  BigInt(startText), config.finalityBlocks, BigInt(batchSize), factory as `0x${string}` | undefined);
let running = true;
const instanceId = randomUUID();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { running = false; });
while (running) {
  try { await indexer.tick(); await writeHeartbeat(database, 'indexer', instanceId, true); }
  catch (error) {
    const rpcStatus = error && typeof error === 'object' && 'status' in error ?
      String(error.status) : 'unknown';
    console.error('Indexer tick failed', error instanceof Error ? error.name : 'UNKNOWN',
      `rpcStatus=${rpcStatus}`);
    try { await writeHeartbeat(database, 'indexer', instanceId, false, 'TICK_FAILED'); }
    catch { console.error('Indexer heartbeat unavailable'); }
  }
  await new Promise(resolve => setTimeout(resolve, 2_000));
}
await database.end();
