import type { Database } from './db.js';

export async function writeHeartbeat(database: Database, service: 'worker' | 'indexer',
  instanceId: string, success: boolean, errorCode?: string): Promise<void> {
  if (errorCode && !/^[A-Z_]{1,64}$/.test(errorCode)) throw new Error('Invalid heartbeat error code');
  await database.query(
    `INSERT INTO pact_service_heartbeats
     (service,instance_id,last_success_at,last_error_at,last_error_code)
     VALUES ($1,$2,CASE WHEN $3 THEN now() ELSE NULL END,
       CASE WHEN $3 THEN NULL ELSE now() END,$4)
     ON CONFLICT (service) DO UPDATE SET instance_id=excluded.instance_id,
       last_success_at=CASE WHEN $3 THEN now() ELSE pact_service_heartbeats.last_success_at END,
       last_error_at=CASE WHEN $3 THEN pact_service_heartbeats.last_error_at ELSE now() END,
       last_error_code=$4,updated_at=now()`,
    [service, instanceId, success, errorCode ?? null]);
}
