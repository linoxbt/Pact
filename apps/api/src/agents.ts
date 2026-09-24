import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthError, jsonSafe } from '@pact/operations';
import type { ApiContext } from './server.js';
import { id } from './validation.js';

const label = z.string().trim().min(2).max(80);
const description = z.string().trim().max(1000);
export const agentKeyScope = z.enum(['read', 'quote', 'prepare', 'approval.request',
  'provider.read', 'evidence.write', 'runs.trigger']);
const keyRequest = z.object({ name: label, scopes: z.array(agentKeyScope).min(1).max(6),
  expiresAt: z.iso.datetime({ offset: true }) }).strict();
type AgentRow = { id: string; principal: string; grant_id: string; operational_address: string;
  name: string; description: string; status: string };
type ChallengeRow = { id: string; agent_id: string; principal: string; name: string;
  scopes: string[]; expires_at: Date; message: string; challenge_expires_at: Date;
  consumed_at: Date | null };
const denied = (code: string, status = 403): never => { throw new AuthError(code, status); };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function registerAgentRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const principal = async (header: string | undefined) => {
    const session = await ctx.auth.authenticate(header);
    if (session.kind !== 'principal') denied('PRINCIPAL_ONLY');
    return session;
  };
  const ownedAgent = async (agentId: string, header: string | undefined): Promise<AgentRow> => {
    if (!z.uuid().safeParse(agentId).success) denied('INVALID_AGENT_ID', 400);
    const session = await principal(header);
    const result = await ctx.database.query<AgentRow>(
      'SELECT * FROM pact_agents WHERE id=$1 AND principal=$2',
      [agentId, session.principal.toLowerCase()]);
    if (!result.rows[0]) denied('AGENT_NOT_FOUND', 404);
    return result.rows[0]!;
  };

  app.post('/v1/agents', async request => {
    const session = await principal(request.headers.authorization);
    const input = z.object({ grantId: id, name: label, description: description.default('') })
      .strict().parse(request.body);
    const grant = await ctx.pact.grant(input.grantId);
    if (!grant.active || grant.principal.toLowerCase() !== session.principal.toLowerCase())
      denied('GRANT_SCOPE_DENIED');
    const existing = await ctx.database.query<AgentRow>(
      'SELECT * FROM pact_agents WHERE grant_id=$1', [input.grantId.toString()]);
    if (existing.rows[0]) denied('AGENT_ALREADY_REGISTERED', 409);
    const result = await ctx.database.query<AgentRow>(
      `INSERT INTO pact_agents (id,principal,grant_id,operational_address,name,description)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [randomUUID(), session.principal.toLowerCase(), input.grantId.toString(),
        grant.agent.toLowerCase(), input.name, input.description]);
    return jsonSafe(result.rows[0]);
  });
  app.get('/v1/agents', async request => {
    const session = await principal(request.headers.authorization);
    const result = await ctx.database.query<AgentRow>(
      'SELECT * FROM pact_agents WHERE principal=$1 ORDER BY created_at DESC LIMIT 100',
      [session.principal.toLowerCase()]);
    return { agents: jsonSafe(result.rows) };
  });
  app.get('/v1/agents/:id', async request =>
    jsonSafe(await ownedAgent((request.params as { id: string }).id, request.headers.authorization)));
  app.patch('/v1/agents/:id', async request => {
    const agent = await ownedAgent((request.params as { id: string }).id, request.headers.authorization);
    const input = z.object({ name: label.optional(), description: description.optional(),
      status: z.enum(['active', 'disabled']).optional() }).strict().parse(request.body);
    if (Object.keys(input).length === 0) denied('EMPTY_UPDATE', 400);
    const result = await ctx.database.query<AgentRow>(
      `UPDATE pact_agents SET name=COALESCE($2,name),description=COALESCE($3,description),
       status=COALESCE($4,status),updated_at=now() WHERE id=$1 RETURNING *`,
      [agent.id, input.name ?? null, input.description ?? null, input.status ?? null]);
    return jsonSafe(result.rows[0]);
  });
  app.post('/v1/agents/:id/sync', async request => {
    const agent = await ownedAgent((request.params as { id: string }).id, request.headers.authorization);
    const grant = await ctx.pact.grant(BigInt(agent.grant_id));
    if (grant.principal.toLowerCase() !== agent.principal) denied('GRANT_SCOPE_DENIED');
    if (grant.agent.toLowerCase() !== agent.operational_address || !grant.active) {
      await ctx.database.query('UPDATE pact_agent_keys SET revoked_at=now() WHERE agent_id=$1 AND revoked_at IS NULL',
        [agent.id]);
    }
    const result = await ctx.database.query<AgentRow>(
      `UPDATE pact_agents SET operational_address=$2,status=$3,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [agent.id, grant.agent.toLowerCase(), grant.active ? 'active' : 'disabled']);
    return jsonSafe(result.rows[0]);
  });

  app.post('/v1/agents/:id/keys/challenge', async request => {
    const agent = await ownedAgent((request.params as { id: string }).id, request.headers.authorization);
    if (agent.status !== 'active') denied('AGENT_DISABLED');
    const input = keyRequest.parse(request.body);
    const scopes = [...new Set(input.scopes)].sort();
    const expiresAt = new Date(input.expiresAt);
    if (expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 90 * 86_400_000)
      denied('INVALID_KEY_EXPIRY', 400);
    const challengeId = randomUUID();
    const challengeExpiresAt = new Date(Date.now() + 5 * 60_000);
    const message = ['Issue Pact agent key', `Domain: ${ctx.auth.config.authDomain}`,
      `Chain ID: ${ctx.auth.config.chainId}`, `Principal: ${agent.principal}`,
      `Agent ID: ${agent.id}`, `Grant ID: ${agent.grant_id}`, `Name: ${input.name}`,
      `Scopes: ${scopes.join(',')}`, `Key Expires: ${expiresAt.toISOString()}`,
      `Challenge: ${challengeId}`, `Challenge Expires: ${challengeExpiresAt.toISOString()}`].join('\n');
    await ctx.database.query(
      `INSERT INTO pact_key_challenges
       (id,agent_id,principal,name,scopes,expires_at,message,challenge_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [challengeId, agent.id, agent.principal, input.name, scopes, expiresAt, message,
        challengeExpiresAt]);
    return { challengeId, message, challengeExpiresAt: challengeExpiresAt.toISOString() };
  });
  app.post('/v1/agents/:id/keys', async request => {
    const agent = await ownedAgent((request.params as { id: string }).id, request.headers.authorization);
    const input = z.object({ challengeId: z.uuid(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) })
      .strict().parse(request.body);
    const pending = await ctx.database.query<ChallengeRow>(
      'SELECT * FROM pact_key_challenges WHERE id=$1 AND agent_id=$2', [input.challengeId, agent.id]);
    const challenge = pending.rows[0];
    if (!challenge) return denied('KEY_CHALLENGE_EXPIRED', 409);
    if (challenge.consumed_at || challenge.challenge_expires_at.getTime() <= Date.now() ||
        challenge.expires_at.getTime() <= Date.now() || agent.status !== 'active')
      denied('KEY_CHALLENGE_EXPIRED', 409);
    const grant = await ctx.pact.grant(BigInt(agent.grant_id));
    if (!grant.active || grant.principal.toLowerCase() !== agent.principal ||
        grant.agent.toLowerCase() !== agent.operational_address) denied('AGENT_AUTHORITY_CHANGED');
    const valid = await ctx.rpc.verifyMessage({ address: grant.principal,
      message: challenge.message, signature: input.signature as `0x${string}` });
    if (!valid) denied('KEY_SIGNATURE_INVALID');
    const key = `pk_${randomBytes(32).toString('base64url')}`;
    const keyId = randomUUID();
    const client = await ctx.database.connect();
    try {
      await client.query('BEGIN');
      const consumed = await client.query(
        `UPDATE pact_key_challenges SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL
         AND challenge_expires_at>now() RETURNING id`, [challenge.id]);
      if (consumed.rowCount !== 1) denied('KEY_CHALLENGE_USED', 409);
      await client.query(
        `INSERT INTO pact_agent_keys
         (id,agent_id,principal,grant_id,token_hash,prefix,name,scopes,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [keyId, agent.id, agent.principal, agent.grant_id, digest(key), key.slice(0, 11),
          challenge.name, challenge.scopes, challenge.expires_at]);
      await client.query(
        `INSERT INTO pact_audit_events (principal,actor,action,details)
         VALUES ($1,$2,'agent.key.issued',$3)`,
        [agent.principal, agent.principal, JSON.stringify({ agentId: agent.id, keyId,
          scopes: challenge.scopes })]);
      await client.query('COMMIT');
    } catch (cause) { await client.query('ROLLBACK'); throw cause; }
    finally { client.release(); }
    return { id: keyId, key, prefix: key.slice(0, 11), name: challenge.name,
      scopes: challenge.scopes, expiresAt: challenge.expires_at.toISOString() };
  });
  app.get('/v1/agents/:id/keys', async request => {
    const agent = await ownedAgent((request.params as { id: string }).id, request.headers.authorization);
    const result = await ctx.database.query(
      `SELECT id,prefix,name,scopes,expires_at,revoked_at,last_used_at,created_at
       FROM pact_agent_keys WHERE agent_id=$1 ORDER BY created_at DESC LIMIT 100`, [agent.id]);
    return { keys: jsonSafe(result.rows) };
  });
  app.delete('/v1/agents/:id/keys/:keyId', async request => {
    const agent = await ownedAgent((request.params as { id: string }).id, request.headers.authorization);
    const keyId = (request.params as { keyId: string }).keyId;
    if (!z.uuid().safeParse(keyId).success) denied('INVALID_KEY_ID', 400);
    const result = await ctx.database.query(
      `UPDATE pact_agent_keys SET revoked_at=now()
       WHERE id=$1 AND agent_id=$2 AND revoked_at IS NULL RETURNING id`, [keyId, agent.id]);
    if (result.rowCount !== 1) denied('KEY_NOT_FOUND', 404);
    return { status: 'revoked' };
  });

  app.get('/v1/agents/:id/credentials', async request => {
    const agent = await ownedAgent((request.params as { id: string }).id, request.headers.authorization);
    const result = await ctx.database.query(
      `SELECT id,provider,label,created_at,updated_at,revoked_at FROM pact_provider_credentials
       WHERE agent_id=$1 ORDER BY created_at DESC LIMIT 100`, [agent.id]);
    return { credentials: jsonSafe(result.rows) };
  });
  app.post('/v1/agents/:id/credentials', async request => {
    const agent = await ownedAgent((request.params as { id: string }).id, request.headers.authorization);
    if (agent.status !== 'active') denied('AGENT_DISABLED');
    if (!ctx.credentials) denied('CREDENTIAL_VAULT_UNAVAILABLE', 503);
    const input = z.object({ provider: z.enum(['github', 'openai', 'anthropic', 'custom']),
      label, secret: z.string().min(8).max(16_384) }).strict().parse(request.body);
    if (/[\r\n]/.test(input.secret)) denied('INVALID_CREDENTIAL', 400);
    const existing = await ctx.database.query<{ id: string }>(
      `SELECT id FROM pact_provider_credentials WHERE agent_id=$1 AND provider=$2
       AND revoked_at IS NULL`, [agent.id, input.provider]);
    const credentialId = existing.rows[0]?.id ?? randomUUID();
    const sealed = await ctx.credentials!.seal({ id: credentialId, principal: agent.principal,
      provider: input.provider }, input.secret);
    await ctx.database.query(
      `INSERT INTO pact_provider_credentials
       (id,agent_id,principal,provider,label,ciphertext,encrypted_key,kms_key_id,cipher_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET label=excluded.label,ciphertext=excluded.ciphertext,
         encrypted_key=excluded.encrypted_key,kms_key_id=excluded.kms_key_id,
         cipher_version=excluded.cipher_version,updated_at=now()`,
      [credentialId, agent.id, agent.principal, input.provider, input.label,
        sealed.ciphertext, sealed.encryptedKey, sealed.kmsKeyId, sealed.version]);
    await ctx.database.query(
      `INSERT INTO pact_audit_events (principal,actor,action,details)
       VALUES ($1,$2,'provider.credential.saved',$3)`,
      [agent.principal, agent.principal, JSON.stringify({ agentId: agent.id,
        credentialId, provider: input.provider })]);
    return { id: credentialId, provider: input.provider, label: input.label,
      status: existing.rows[0] ? 'rotated' : 'created' };
  });
  app.delete('/v1/agents/:id/credentials/:credentialId', async request => {
    const agent = await ownedAgent((request.params as { id: string }).id, request.headers.authorization);
    const credentialId = (request.params as { credentialId: string }).credentialId;
    if (!z.uuid().safeParse(credentialId).success) denied('INVALID_CREDENTIAL_ID', 400);
    const result = await ctx.database.query(
      `UPDATE pact_provider_credentials SET revoked_at=now(),updated_at=now()
       WHERE id=$1 AND agent_id=$2 AND revoked_at IS NULL RETURNING id`,
      [credentialId, agent.id]);
    if (result.rowCount !== 1) denied('CREDENTIAL_NOT_FOUND', 404);
    return { status: 'revoked' };
  });
}
