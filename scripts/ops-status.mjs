import { createDatabase, loadCoreConfig } from '../packages/operations/dist/index.js';

const config = loadCoreConfig();
const maxAge = Number(process.env.PACT_HEARTBEAT_MAX_AGE_SECONDS ?? '30');
const maxLag = BigInt(process.env.PACT_MAX_INDEXER_LAG_BLOCKS ?? '20');
if (!Number.isInteger(maxAge) || maxAge < 5 || maxLag < 0n) throw new Error('Invalid health thresholds');
const database = createDatabase(config.databaseUrl);
const faults = [];
try {
  const [heartbeats, cursor, pending, rpc] = await Promise.all([
    database.query('SELECT service,last_success_at,last_error_at,last_error_code FROM pact_service_heartbeats'),
    database.query('SELECT block_number FROM pact_indexer_cursor WHERE chain_id=$1', [config.chainId]),
    database.query(`SELECT state,count(*)::integer AS count FROM pact_operations
      WHERE state IN ('submitted','recoverable') GROUP BY state`),
    fetch(config.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(5_000) }).then(response => response.json()),
  ]);
  for (const service of ['worker', 'indexer', ...(process.env.PACT_ENABLE_RUNNER === 'yes' ? ['runner'] : [])]) {
    const row = heartbeats.rows.find(item => item.service === service);
    if (!row?.last_success_at || Date.now() - new Date(row.last_success_at).getTime() > (service === 'runner' ? Math.max(maxAge,180) : maxAge) * 1_000)
      faults.push(`${service}_stale`);
  }
  const head = BigInt(rpc.result);
  const safeHead = head > BigInt(config.finalityBlocks) ? head - BigInt(config.finalityBlocks) : 0n;
  const indexed = cursor.rows[0] ? BigInt(cursor.rows[0].block_number) : null;
  if (indexed === null || safeHead - indexed > maxLag) faults.push('indexer_lag');
  const status = { healthy: faults.length === 0, faults, chainId: config.chainId,
    finalizedHead: safeHead.toString(), indexedBlock: indexed?.toString() ?? null,
    pendingOperations: Object.fromEntries(pending.rows.map(row => [row.state, row.count])),
    heartbeats: heartbeats.rows.map(row => ({ service: row.service,
      lastSuccessAt: row.last_success_at, lastErrorAt: row.last_error_at,
      lastErrorCode: row.last_error_code })) };
  process.stdout.write(`${JSON.stringify(status)}\n`);
  if (!status.healthy) process.exitCode = 2;
} catch (cause) {
  process.stderr.write(`Pact operational status unavailable: ${cause instanceof Error ? cause.name : 'UNKNOWN'}\n`);
  process.exitCode = 2;
} finally { await database.end(); }
