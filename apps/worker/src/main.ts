import { createPublicClient, http } from 'viem';
import { createDatabase, loadCoreConfig, migrate, writeHeartbeat } from '@pact/operations';
import { randomUUID } from 'node:crypto';
import { Reconciler } from './reconcile.js';

const config = loadCoreConfig();
const database = createDatabase(config.databaseUrl);
await migrate(database);
const rpc = createPublicClient({ transport: http(config.rpcUrl) });
if (await rpc.getChainId() !== config.chainId) throw new Error('RPC chain ID mismatch');
const reconciler = new Reconciler(database, rpc, config.finalityBlocks);
let running = true;
let lastRetentionSweep = 0;
const instanceId = randomUUID();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { running = false; });
while (running) {
  try {
    await reconciler.tick();
    if (Date.now() - lastRetentionSweep > 86_400_000) {
      await database.query(`DELETE FROM pact_proxy_activity WHERE created_at<now()-interval '30 days'`);
      await database.query(`DELETE FROM pact_policy_usage WHERE period_start<extract(epoch from now())-604800`);
      await database.query(`DELETE FROM pact_address_challenges WHERE expires_at<now()-interval '1 day'`);
      lastRetentionSweep = Date.now();
    }
    await writeHeartbeat(database, 'worker', instanceId, true);
  }
  catch (error) {
    console.error('Reconciliation tick failed', error instanceof Error ? error.name : 'UNKNOWN');
    try { await writeHeartbeat(database, 'worker', instanceId, false, 'TICK_FAILED'); }
    catch { console.error('Worker heartbeat unavailable'); }
  }
  await new Promise(resolve => setTimeout(resolve, 3_000));
}
await database.end();
