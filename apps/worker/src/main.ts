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
    await database.query(`WITH stale AS (
      UPDATE pact_proxy_dispatches SET state=CASE WHEN state='authorized' THEN 'not_forwarded' ELSE 'outcome_unknown' END,
        updated_at=now() WHERE state IN ('authorized','dispatching') AND updated_at<now()-interval '2 minutes'
      RETURNING request_id,state)
      UPDATE pact_proxy_activity a SET execution_state=s.state,reason='EXECUTION_INTERRUPTED'
      FROM stale s WHERE a.id=s.request_id`);
    if (Date.now() - lastRetentionSweep > 3_600_000) {
      await database.query(`DELETE FROM pact_proxy_activity WHERE created_at<now()-interval '30 days'`);
      await database.query(`DELETE FROM pact_policy_usage WHERE period_start<extract(epoch from now())-604800`);
      await database.query(`DELETE FROM pact_address_challenges WHERE expires_at<now()-interval '1 day'`);
      await database.query(`DELETE FROM pact_ingress_limits WHERE period_start<now()-interval '1 hour'`);
      await database.query(`DELETE FROM pact_verification_probes WHERE expires_at<now()-interval '30 days'`);
      await database.query(`DELETE FROM pact_audit_events WHERE created_at<now()-interval '365 days'`);
      await database.query(`DELETE FROM pact_sessions WHERE expires_at<now()-interval '1 day'`);
      await database.query(`DELETE FROM pact_challenges WHERE expires_at<now()-interval '1 day'`);
      await database.query(`UPDATE pact_proxy_approvals SET sealed_intent=NULL
        WHERE sealed_intent IS NOT NULL AND expires_at<now()-interval '30 days'`);
      await database.query(`DELETE FROM pact_proxy_dispatches WHERE updated_at<now()-interval '100 days'`);
      await database.query(`DELETE FROM pact_proxy_approvals x WHERE x.expires_at<now()-interval '90 days'
        AND NOT EXISTS(SELECT 1 FROM pact_proxy_activity a WHERE a.approval_id=x.id)`);
      await database.query(`DELETE FROM pact_gateway_usage WHERE period_start<extract(epoch from now())-604800`);
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
