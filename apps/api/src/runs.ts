import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthError, jsonSafe, modelChargeMicro } from '@pact/operations';
import type { ApiContext } from './server.js';
import { priceFor } from './billing.js';

const uuid = z.uuid();
const configSchema = z.object({ provider: z.enum(['openai', 'anthropic', 'custom']),
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,119}$/),
  instructions: z.string().max(12_000),
  maxOutputTokens: z.number().int().min(64).max(4096),
  fundingMode: z.enum(['byo','pact']).default('byo'),
  customEndpoint: z.url().optional() }).strict();
const runSchema = z.object({ input: z.string().min(1).max(32_000),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/) }).strict();
const deny = (code: string, status = 403): never => { throw new AuthError(code, status); };

export function registerRunRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const access = async (id: string, header: string | undefined, scope: string) => {
    if (!uuid.safeParse(id).success) deny('INVALID_AGENT_ID', 400);
    const session = await ctx.auth.authenticate(header, scope);
    const row = await ctx.database.query<{ id: string; grant_id: string; principal: string;
      operational_address: string; status: string }>('SELECT * FROM pact_agents WHERE id=$1', [id]);
    const agent = row.rows[0];
    if (!agent || agent.principal !== session.principal.toLowerCase() ||
        (session.kind === 'agent' && session.grantId?.toString() !== agent.grant_id))
      deny('AGENT_NOT_FOUND', 404);
    return { agent: agent!, session };
  };
  app.get('/v1/agents/:id/config', async request => {
    const { agent } = await access((request.params as { id: string }).id,
      request.headers.authorization, 'read');
    const row = await ctx.database.query(
      `SELECT provider,model,instructions,max_output_tokens,custom_endpoint,funding_mode,updated_at
       FROM pact_agent_configs WHERE agent_id=$1`, [agent.id]);
    return jsonSafe(row.rows[0] ?? null);
  });
  app.put('/v1/agents/:id/config', async request => {
    const { agent, session } = await access((request.params as { id: string }).id,
      request.headers.authorization, 'read');
    if (session.kind !== 'principal') deny('PRINCIPAL_ONLY');
    const input = configSchema.parse(request.body);
    if (input.provider === 'custom') {
      if (!input.customEndpoint || !input.customEndpoint.startsWith('https://') ||
          !ctx.customModelEndpoints?.includes(input.customEndpoint))
        deny('CUSTOM_ENDPOINT_NOT_APPROVED', 400);
    } else if (input.customEndpoint) deny('CUSTOM_ENDPOINT_UNEXPECTED', 400);
    if (input.fundingMode === 'pact' && !priceFor(ctx.billing, input.provider, input.model))
      deny('PACT_FUNDED_MODEL_UNAVAILABLE', 400);
    await ctx.database.query(
      `INSERT INTO pact_agent_configs
       (agent_id,provider,model,instructions,custom_endpoint,max_output_tokens,funding_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (agent_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,
         instructions=excluded.instructions,custom_endpoint=excluded.custom_endpoint,
         max_output_tokens=excluded.max_output_tokens,funding_mode=excluded.funding_mode,
         updated_at=now()`,
      [agent.id, input.provider, input.model, input.instructions,
        input.customEndpoint ?? null, input.maxOutputTokens, input.fundingMode]);
    return { status: 'configured' };
  });
  app.post('/v1/agents/:id/runs', async request => {
    const { agent } = await access((request.params as { id: string }).id,
      request.headers.authorization, 'runs.trigger');
    if (agent.status !== 'active') deny('AGENT_DISABLED');
    const grant = await ctx.pact.grant(BigInt(agent.grant_id));
    if (!grant.active || grant.principal.toLowerCase() !== agent.principal ||
        grant.agent.toLowerCase() !== agent.operational_address) deny('AGENT_AUTHORITY_CHANGED');
    const input = runSchema.parse(request.body);
    const config = await ctx.database.query<{ provider: string; model: string;
      instructions: string; custom_endpoint: string | null; max_output_tokens: number;
      funding_mode: 'byo' | 'pact' }>(
      'SELECT * FROM pact_agent_configs WHERE agent_id=$1', [agent.id]);
    const value = config.rows[0];
    if (!value) throw new AuthError('AGENT_NOT_CONFIGURED', 409);
    const price = value.funding_mode === 'pact' ? priceFor(ctx.billing, value.provider, value.model) : undefined;
    if (value.funding_mode === 'pact' && !price) deny('PACT_FUNDED_MODEL_UNAVAILABLE', 409);
    if (value.funding_mode === 'byo') {
      const credential = await ctx.database.query(
        `SELECT id FROM pact_provider_credentials WHERE agent_id=$1 AND provider=$2 AND revoked_at IS NULL`,
        [agent.id, value.provider]);
      if (!credential.rows[0]) deny('PROVIDER_CREDENTIAL_REQUIRED', 409);
    }
    const reserve = price ? modelChargeMicro(
      Buffer.byteLength(input.input) + Buffer.byteLength(value.instructions) + 100,
      value.max_output_tokens, price) : 0n;
    const client = await ctx.database.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string; input: string; state: string }>(
        `SELECT id,input,state FROM pact_agent_runs WHERE agent_id=$1 AND idempotency_key=$2
         FOR UPDATE`, [agent.id, input.idempotencyKey]);
      if (existing.rows[0]) {
        if (existing.rows[0].input !== input.input) deny('IDEMPOTENCY_CONFLICT', 409);
        await client.query('COMMIT');
        return { id: existing.rows[0].id, state: existing.rows[0].state };
      }
      if (price) {
        const balance = await client.query(
          `UPDATE pact_billing_accounts SET balance_micro=balance_micro-$2,updated_at=now()
           WHERE principal=$1 AND balance_micro >= $2 RETURNING balance_micro`,
          [agent.principal, reserve.toString()]);
        if (!balance.rows[0]) deny('INSUFFICIENT_TESTNET_CREDIT', 402);
      }
      const runId = randomUUID();
      await client.query(
        `INSERT INTO pact_agent_runs
         (id,agent_id,principal,grant_id,idempotency_key,input,provider,model,instructions,
          custom_endpoint,max_output_tokens,funding_mode,input_rate_micro,output_rate_micro)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [runId, agent.id, agent.principal, agent.grant_id, input.idempotencyKey,
          input.input, value.provider, value.model, value.instructions,
          value.custom_endpoint, value.max_output_tokens, value.funding_mode,
          price?.input ?? null, price?.output ?? null]);
      if (price) await client.query(
        `INSERT INTO pact_billing_reservations (run_id,principal,reserved_micro)
         VALUES ($1,$2,$3)`, [runId, agent.principal, reserve.toString()]);
      await client.query('COMMIT');
      return { id: runId, state: 'queued', reservedMicro: reserve.toString() };
    } catch (cause) {
      await client.query('ROLLBACK');
      if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505') {
        const existing = await ctx.database.query<{ id: string; input: string; state: string }>(
          `SELECT id,input,state FROM pact_agent_runs WHERE agent_id=$1 AND idempotency_key=$2`,
          [agent.id, input.idempotencyKey]);
        if (existing.rows[0]?.input === input.input)
          return { id: existing.rows[0].id, state: existing.rows[0].state };
        deny('IDEMPOTENCY_CONFLICT', 409);
      }
      throw cause;
    }
    finally { client.release(); }
  });
  app.get('/v1/agents/:id/runs', async request => {
    const { agent } = await access((request.params as { id: string }).id,
      request.headers.authorization, 'read');
    const rows = await ctx.database.query(
      `SELECT id,state,provider,model,input_tokens,output_tokens,error_code,created_at,
        started_at,finished_at FROM pact_agent_runs WHERE agent_id=$1
       ORDER BY created_at DESC LIMIT 100`, [agent.id]);
    return { runs: jsonSafe(rows.rows) };
  });
  app.get('/v1/agents/:id/runs/:runId', async request => {
    const params = request.params as { id: string; runId: string };
    const { agent } = await access(params.id, request.headers.authorization, 'read');
    if (!uuid.safeParse(params.runId).success) deny('INVALID_RUN_ID', 400);
    const row = await ctx.database.query(
      `SELECT id,state,provider,model,input,output,input_tokens,output_tokens,error_code,
        created_at,started_at,finished_at FROM pact_agent_runs WHERE agent_id=$1 AND id=$2`,
      [agent.id, params.runId]);
    if (!row.rows[0]) deny('RUN_NOT_FOUND', 404);
    return jsonSafe(row.rows[0]);
  });
}
