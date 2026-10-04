import { KMSClient } from '@aws-sdk/client-kms';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createPublicClient, http } from 'viem';
import { CredentialCipher, DeploymentSecretCipher } from '@pact/security';
import { createDatabase, loadCoreConfig, migrate, modelChargeMicro } from '@pact/operations';
import { PactClient } from '@pact/sdk-ts';
import { invokeModel, type ModelRequest } from './providers.js';

const config = loadCoreConfig();
const keyId = process.env.PACT_CREDENTIAL_KMS_KEY_ID;
if (config.environment === 'production' && !keyId)
  throw new Error('Production runner requires PACT_CREDENTIAL_KMS_KEY_ID');
const approvedEndpoints = (process.env.PACT_CUSTOM_MODEL_ENDPOINTS ?? '').split(',').filter(Boolean);
const database = createDatabase(config.databaseUrl);
await migrate(database);
const cipher = keyId ? new CredentialCipher(new KMSClient({}), keyId) :
  config.environment !== 'production' && process.env.PACT_VAULT_MASTER_KEY ?
    new DeploymentSecretCipher(process.env.PACT_VAULT_MASTER_KEY) :
    (() => { throw new Error('Runner requires credential encryption'); })();
const secrets = new SecretsManagerClient({});
const rpc = createPublicClient({ transport: http(config.rpcUrl) });
if (await rpc.getChainId() !== config.chainId) throw new Error('RPC chain ID mismatch');
const pact = new PactClient(rpc, config.addresses);
type Run = { id: string; agent_id: string; principal: string; grant_id: string;
  input: string; provider: ModelRequest['provider']; model: string; instructions: string;
  custom_endpoint: string | null; max_output_tokens: number };
type BilledRun = Run & { funding_mode: 'byo' | 'pact'; input_rate_micro: number | null;
  output_rate_micro: number | null };
type Credential = { id: string; ciphertext: string; encrypted_key: string;
  kms_key_id: string; cipher_version: number };
let stopped = false;
const settle = async (run: BilledRun, state: 'succeeded' | 'failed',
  output?: string, inputTokens?: number, outputTokens?: number, errorCode?: string) => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    if (run.funding_mode === 'pact') {
      const reservation = await client.query<{ reserved_micro: string; settled_at: Date | null }>(
        `SELECT reserved_micro,settled_at FROM pact_billing_reservations WHERE run_id=$1 FOR UPDATE`,
        [run.id]);
      const record = reservation.rows[0];
      if (!record) throw new Error('BILLING_RESERVATION_INVALID');
      if (record.settled_at) { await client.query('ROLLBACK'); return; }
      const reserved = BigInt(record.reserved_micro);
      const actual = state === 'succeeded' ? modelChargeMicro(inputTokens ?? 0, outputTokens ?? 0,
        { input: run.input_rate_micro ?? 0, output: run.output_rate_micro ?? 0 }) : 0n;
      const charged = actual > reserved ? reserved : actual;
      await client.query(
        `UPDATE pact_billing_accounts SET balance_micro=balance_micro+$2,updated_at=now()
         WHERE principal=$1`, [run.principal, (reserved - charged).toString()]);
      await client.query(
        `UPDATE pact_billing_reservations SET charged_micro=$2,settled_at=now() WHERE run_id=$1`,
        [run.id, charged.toString()]);
    }
    const updated = await client.query(
      `UPDATE pact_agent_runs SET state=$2,output=$3,input_tokens=$4,output_tokens=$5,
       error_code=$6,finished_at=now() WHERE id=$1 AND state='running'`,
      [run.id, state, output ?? null, inputTokens ?? null, outputTokens ?? null,
        errorCode ?? null]);
    if (updated.rowCount !== 1) { await client.query('ROLLBACK'); return; }
    await client.query('COMMIT');
  } catch (cause) { await client.query('ROLLBACK'); throw cause; }
  finally { client.release(); }
};
const providerSecret = async (run: BilledRun): Promise<string> => {
  if (run.funding_mode === 'pact') {
    const envName = run.provider === 'openai' ? 'PACT_OPENAI_SECRET_ID' :
      run.provider === 'anthropic' ? 'PACT_ANTHROPIC_SECRET_ID' : 'PACT_CUSTOM_MODEL_SECRET_ID';
    const secretId = process.env[envName];
    if (!secretId) throw new Error('PACT_PROVIDER_SECRET_UNAVAILABLE');
    const result = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!result.SecretString || /[\r\n]/.test(result.SecretString))
      throw new Error('PACT_PROVIDER_SECRET_UNAVAILABLE');
    return result.SecretString;
  }
  const credential = await database.query<Credential>(
    `SELECT * FROM pact_provider_credentials WHERE agent_id=$1 AND provider=$2
     AND revoked_at IS NULL`, [run.agent_id, run.provider]);
  const row = credential.rows[0];
  if (!row) throw new Error('PROVIDER_CREDENTIAL_REQUIRED');
  return cipher.open({ id: row.id, principal: run.principal, provider: run.provider },
    { ciphertext: row.ciphertext, encryptedKey: row.encrypted_key,
      kmsKeyId: row.kms_key_id, version: row.cipher_version });
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { stopped = true; });
let lastReap = 0;
while (!stopped) {
  if (Date.now() - lastReap > 60_000) {
    lastReap = Date.now();
    const stale = await database.query<BilledRun>(
      `SELECT * FROM pact_agent_runs WHERE state='running'
       AND started_at < now() - interval '3 minutes' LIMIT 100`);
    for (const run of stale.rows) {
      try { await settle(run, 'failed', undefined, undefined, undefined, 'RUN_TIMEOUT'); }
      catch { /* A concurrent worker may have settled this run. */ }
    }
  }
  const result = await database.query<BilledRun>(
    `UPDATE pact_agent_runs SET state='running',started_at=now()
     WHERE id=(SELECT id FROM pact_agent_runs WHERE state='queued'
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
  const run = result.rows[0];
  if (!run) { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
  try {
    const agent = await database.query<{ status: string; operational_address: string }>(
      'SELECT status,operational_address FROM pact_agents WHERE id=$1', [run.agent_id]);
    const grant = await pact.grant(BigInt(run.grant_id));
    if (agent.rows[0]?.status !== 'active' || !grant.active ||
        grant.principal.toLowerCase() !== run.principal ||
        grant.agent.toLowerCase() !== agent.rows[0]?.operational_address)
      throw new Error('AGENT_AUTHORITY_CHANGED');
    if (run.provider === 'custom' &&
        (!run.custom_endpoint || !approvedEndpoints.includes(run.custom_endpoint)))
      throw new Error('CUSTOM_ENDPOINT_NOT_APPROVED');
    const secret = await providerSecret(run);
    const model = await invokeModel({ provider: run.provider, endpoint: run.custom_endpoint,
      model: run.model, instructions: run.instructions, input: run.input,
      maxOutputTokens: run.max_output_tokens, secret });
    await settle(run, 'succeeded', model.output, model.inputTokens, model.outputTokens);
  } catch (cause) {
    const code = cause instanceof Error && /^[A-Z0-9_]+$/.test(cause.message) ? cause.message :
      cause instanceof Error && /^MODEL_PROVIDER_HTTP_\d+$/.test(cause.message) ? cause.message :
      'MODEL_RUN_FAILED';
    await settle(run, 'failed', undefined, undefined, undefined, code);
  }
}
await database.end();
