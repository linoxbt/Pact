import {createHash} from 'node:crypto';
import type {Database} from './db.js';
import {AuthError} from './auth.js';

/** Preserve client parser errors without reflecting request data. */
export function clientHttpError(cause: unknown): {status: number; code: string} | null {
  if (!cause || typeof cause !== 'object') return null;
  const value = cause as {code?: unknown; statusCode?: unknown};
  if (typeof value.code !== 'string' || !value.code.startsWith('FST_ERR_')) return null;
  if (value.statusCode === 400) return {status:400,code:'INVALID_REQUEST'};
  if (value.statusCode === 413) return {status:413,code:'PAYLOAD_TOO_LARGE'};
  if (value.statusCode === 415) return {status:415,code:'UNSUPPORTED_MEDIA_TYPE'};
  if (value.statusCode === 431) return {status:431,code:'HEADERS_TOO_LARGE'};
  return null;
}

export async function enforceRequestLimit(database: Database, scope: string, limit: number): Promise<void> {
  const key = createHash('sha256').update(scope).digest('hex');
  const result = await database.query(`INSERT INTO pact_ingress_limits(bucket,period_start,requests)
    VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(bucket,period_start)
    DO UPDATE SET requests=pact_ingress_limits.requests+1 WHERE pact_ingress_limits.requests<$2
    RETURNING requests`,[key,limit]);
  if (result.rowCount === 0) throw new AuthError('RATE_LIMIT_EXCEEDED',429);
}

export async function enforceIngress(database: Database, ip: string, authorization?: string): Promise<void> {
  await enforceRequestLimit(database,`ip:${ip}`,600);
  if (authorization) await enforceRequestLimit(database,`credential:${authorization}`,300);
}
