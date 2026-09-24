import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

export type Database = pg.Pool;

export function createDatabase(connectionString: string): Database {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000 });
}

export async function migrate(database: Database): Promise<void> {
  const directory = resolve(import.meta.dirname, '../sql');
  const files = readdirSync(directory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [0x50414354]);
    await client.query(`CREATE TABLE IF NOT EXISTS pact_schema_migrations
      (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    for (const file of files) {
      const sql = readFileSync(resolve(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = await client.query<{ checksum: string }>(
        'SELECT checksum FROM pact_schema_migrations WHERE version=$1', [file]);
      if (applied.rows[0]) {
        if (applied.rows[0].checksum !== checksum) throw new Error(`Migration ${file} changed after application`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO pact_schema_migrations (version,checksum) VALUES ($1,$2)', [file, checksum]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  return value;
}
