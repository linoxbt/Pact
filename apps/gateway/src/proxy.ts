import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthError, type Database } from '@pact/operations';
import { evaluateHttpPolicy, grantInput, httpPolicyInput, pathMatches,
  type HttpPolicyRule } from '@pact/policies';
import type { CredentialCipher, DeploymentSecretCipher } from '@pact/security';
import { forwardUpstream, type UpstreamResult } from './upstream.js';

type Key = { id: string; owner_id: string; agent_id: string; scopes: string[];
  expires_at: Date; revoked_at: Date | null; agent_status: string };
type Service = { id: string; owner_id: string; agent_id: string; base_url: string; auth_method: string;
  auth_header: string | null; status: string; environment: string };
type Endpoint = { id: string; grant_id: string; policy_id: string; method: string;
  path_pattern: string; status: string; cost_minor: string; currency: string;
  response_fields: string[] };
type Grant = { id: string; principal_address: string; name: string; status: string;
  resource_origins: string[]; actions: string[]; destination_origins: string[];
  currency: string; per_action_limit_minor: string; aggregate_limit_minor: string;
  approval_threshold_minor: string; starts_at: Date; expires_at: Date };
type Policy = { id: string; agent_id: string; name: string; rules: unknown; status: string };
type Secret = { id: string; ciphertext: string; encrypted_key: string; kms_key_id: string;
  cipher_version: number };
type Forward = (url: URL, method: string, headers: Record<string,string>, body: Buffer,
  allowLocal: boolean) => Promise<UpstreamResult>;
export type ProxyContext = { database: Database; cipher: CredentialCipher | DeploymentSecretCipher; forwarder?: Forward;
  allowLocalUpstream?: boolean };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const denial = (status: number, error: string, requestId: string) => ({ status, error, requestId });
function specificity(pattern: string): [number, number, number] {
  const parts = pattern.split('/').slice(1);
  return [parts.filter(part => part !== '*' && !part.startsWith(':')).length,
    parts.filter(part => part.startsWith(':')).length, -parts.filter(part => part === '*').length];
}
function compareSpecificity(left: string, right: string): number {
  const a = specificity(left); const b = specificity(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}
export function selectEndpoint<T extends Pick<Endpoint, 'method'|'path_pattern'>>(
  rows: T[], method: string, path: string): { endpoint: T | null; ambiguous: boolean } {
  const matches = rows.filter(row => row.method === method && pathMatches(row.path_pattern, path))
    .sort((a, b) => compareSpecificity(b.path_pattern, a.path_pattern));
  return { endpoint: matches[0] ?? null,
    ambiguous: matches.length > 1 &&
      compareSpecificity(matches[0]!.path_pattern, matches[1]!.path_pattern) === 0 };
}
function redactSecret(payload: string, secret: string): string {
  if (!secret) return payload;
  const forms = new Set([secret, JSON.stringify(secret).slice(1,-1),
    encodeURIComponent(secret), Buffer.from(secret).toString('base64'),
    Buffer.from(secret).toString('base64url')]);
  for (const form of forms) if (form.length >= 8) payload = payload.split(form).join('[REDACTED]');
  return payload;
}
export function projectProtectedResponse(body: Buffer, contentType: string, fields: string[]): string {
  if (!fields.length || !/^application\/json(?:;|$)/i.test(contentType)) return '{}';
  const parsed = JSON.parse(body.toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('UPSTREAM_RESPONSE_SHAPE_DENIED');
  const source = parsed as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.hasOwn(source, field)) safe[field] = source[field];
  }
  return JSON.stringify(safe);
}

export function registerProxy(app: FastifyInstance, ctx: ProxyContext): void {
  app.all('/v2/proxy/:agentId/:serviceId/*', async (request, reply) => {
    const started = Date.now();
    const requestId = randomUUID();
    const params = request.params as { agentId: string; serviceId: string; '*': string };
    if (!z.uuid().safeParse(params.agentId).success || !z.uuid().safeParse(params.serviceId).success)
      throw new AuthError('INVALID_PROXY_ROUTE', 400);
    const bearer = request.headers.authorization;
    const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : '';
    if (!/^pat_[A-Za-z0-9_-]{43}$/.test(token)) throw new AuthError('INVALID_INTEGRATION_KEY', 401);
    const keys = await ctx.database.query<Key>(
      `SELECT k.*,a.status AS agent_status FROM pact_integration_keys k
       JOIN pact_connected_agents a ON a.id=k.agent_id WHERE k.token_hash=$1`, [digest(token)]);
    const key = keys.rows[0];
    if (!key || key.revoked_at || key.expires_at.getTime() <= Date.now() ||
        key.agent_id !== params.agentId || key.agent_status !== 'active' ||
        !(key.scopes.includes('proxy.invoke') || (request.method === 'GET' ?
          key.scopes.includes('proxy.read') : key.scopes.includes('proxy.write'))))
      throw new AuthError('INTEGRATION_KEY_DENIED', 401);
    await ctx.database.query('UPDATE pact_integration_keys SET last_used_at=now() WHERE id=$1', [key.id]);
    const services = await ctx.database.query<Service>(
      `SELECT s.*,a.environment FROM pact_services s
       JOIN pact_connected_agents a ON a.id=s.agent_id
       WHERE s.id=$1 AND s.agent_id=$2 AND s.owner_id=$3`,
      [params.serviceId, key.agent_id, key.owner_id]);
    const service = services.rows[0];
    if (!service) throw new AuthError('SERVICE_NOT_FOUND', 404);
    const prefix = `/v2/proxy/${params.agentId}/${params.serviceId}`;
    const raw = new URL(request.raw.url ?? '/', 'http://pact.local');
    const path = raw.pathname.slice(prefix.length) || '/';
    const method = request.method.toUpperCase();
    const body = request.body === undefined ? Buffer.alloc(0) :
      Buffer.from(JSON.stringify(request.body));
    const requestHash = digest(JSON.stringify({ method, path, query: raw.search, body: digest(body.toString('base64')) }));
    const endpoints = await ctx.database.query<Endpoint>(
      'SELECT * FROM pact_endpoints WHERE service_id=$1 AND agent_id=$2', [service.id, key.agent_id]);
    const route = endpoints.rows.find(row => pathMatches(row.path_pattern, path));
    const selected = selectEndpoint(endpoints.rows, method, path);
    const endpoint = selected.endpoint;
    const record = async (decision: string, reason: string, matchedRule: string | null,
      trace: unknown, endpointId: string | null, grantId: string | null,
      policyId: string | null, approvalId: string | null) => {
      await ctx.database.query(
        `INSERT INTO pact_proxy_activity
         (id,owner_id,agent_id,service_id,endpoint_id,grant_id,policy_id,key_id,approval_id,
          method,route,decision,matched_rule,reason,trace,latency_ms)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [requestId, key.owner_id, key.agent_id, service.id, endpointId, grantId, policyId,
          key.id, approvalId, method, endpoint?.path_pattern ?? route?.path_pattern ?? '[unregistered path]',
          decision, matchedRule, reason, JSON.stringify(trace), Date.now() - started]);
    };
    if (!endpoint || selected.ambiguous) {
      const reason = selected.ambiguous ? 'AMBIGUOUS_ENDPOINT' :
        route ? 'ENDPOINT_METHOD_DENIED' : 'ENDPOINT_NOT_REGISTERED';
      await record('denied', reason, 'endpoint', [{ ruleId: 'endpoint', name: 'Registered operation',
        result: 'deny', reason }], null, null, null, null);
      return reply.code(403).send(denial(403, reason, requestId));
    }
    if (service.status !== 'active' || endpoint.status !== 'active') {
      await record('denied', 'ENDPOINT_DISABLED', 'endpoint', [{ ruleId: 'endpoint',
        name: 'Endpoint status', result: 'deny', reason: 'ENDPOINT_DISABLED' }],
        endpoint.id, endpoint.grant_id, endpoint.policy_id, null);
      return reply.code(403).send(denial(403, 'ENDPOINT_DISABLED', requestId));
    }
    const client = await ctx.database.connect();
    let decision: 'allowed'|'denied'|'pending_approval' = 'denied';
    let reason = 'POLICY_DENIED';
    let matchedRule: string | null = null;
    let trace: unknown = [];
    let approvalId: string | null = null;
    try {
      await client.query('BEGIN');
      const grants = await client.query<Grant>(
        'SELECT * FROM pact_authority_grants WHERE id=$1 AND owner_id=$2 AND agent_id=$3 FOR UPDATE',
        [endpoint.grant_id, key.owner_id, key.agent_id]);
      const policies = await client.query<Policy>(
        'SELECT * FROM pact_http_policies WHERE id=$1 AND owner_id=$2 AND agent_id=$3',
        [endpoint.policy_id, key.owner_id, key.agent_id]);
      const grant = grants.rows[0]; const policy = policies.rows[0];
      if (!grant || !policy) throw new AuthError('AUTHORITY_NOT_FOUND', 403);
      await client.query(
        `INSERT INTO pact_grant_usage(grant_id) VALUES($1) ON CONFLICT DO NOTHING`, [grant.id]);
      const grantUsage = await client.query<{ spent_minor: string }>(
        'SELECT spent_minor FROM pact_grant_usage WHERE grant_id=$1 FOR UPDATE', [grant.id]);
      const parsedPolicy = httpPolicyInput.parse({ agentId: key.agent_id, name: policy.name,
        rules: policy.rules });
      const now = new Date();
      const usage = new Map<string,{ count: number; spentMinor: bigint }>();
      const usageRows = await client.query<{ rule_id: string; period_start: string;
        request_count: number; spent_minor: string }>(
        `SELECT rule_id,period_start,request_count,spent_minor FROM pact_policy_usage
         WHERE policy_id=$1 AND period_start >= $2`,
        [policy.id, Math.floor(now.getTime() / 1000) - 86_400]);
      const usageByPeriod = new Map(usageRows.rows.map(row =>
        [`${row.rule_id}:${row.period_start}`, row]));
      for (const rule of parsedPolicy.rules) {
        const period = rule.periodSeconds ?? 86_400;
        const periodStart = Math.floor(now.getTime() / 1000 / period) * period;
        const current = usageByPeriod.get(`${rule.id}:${periodStart}`);
        usage.set(rule.id, { count: current?.request_count ?? 0,
          spentMinor: BigInt(current?.spent_minor ?? '0') });
      }
      const parsedGrant = grantInput.parse({ agentId: key.agent_id, name: grant.name,
        resourceOrigins: grant.resource_origins, actions: grant.actions,
        destinationOrigins: grant.destination_origins, currency: grant.currency,
        perActionLimitMinor: grant.per_action_limit_minor,
        aggregateLimitMinor: grant.aggregate_limit_minor,
        approvalThresholdMinor: grant.approval_threshold_minor,
        startsAt: grant.starts_at.toISOString(), expiresAt: grant.expires_at.toISOString() });
      const evaluated = evaluateHttpPolicy({ grant: { ...parsedGrant, status: grant.status,
        principalAddress: grant.principal_address,
        spentMinor: BigInt(grantUsage.rows[0]?.spent_minor ?? '0') },
        policy: { ...parsedPolicy, status: policy.status }, method, path,
        destination: service.base_url, costMinor: BigInt(endpoint.cost_minor),
        currency: endpoint.currency, now, usage: (rule: HttpPolicyRule) => usage.get(rule.id)! });
      ({ decision, reason, matchedRule, trace } = evaluated);
      const approvalHeader = request.headers['x-pact-approval-id'];
      if (decision === 'pending_approval' && typeof approvalHeader === 'string') {
        if (!z.uuid().safeParse(approvalHeader).success) throw new AuthError('INVALID_APPROVAL_ID', 400);
        const approved = await client.query<{ id: string }>(
          `UPDATE pact_proxy_approvals SET state='consumed'
           WHERE id=$1 AND owner_id=$2 AND agent_id=$3 AND endpoint_id=$4
             AND request_hash=$5 AND state='approved' AND expires_at>now() RETURNING id`,
          [approvalHeader, key.owner_id, key.agent_id, endpoint.id, requestHash]);
        if (approved.rowCount === 1) {
          decision = 'allowed'; reason = 'APPROVED_EXACT_REQUEST'; approvalId = approvalHeader;
        }
      }
      if (decision === 'pending_approval' && !approvalId) {
        approvalId = randomUUID();
        await client.query(
          `INSERT INTO pact_proxy_approvals
           (id,owner_id,agent_id,endpoint_id,request_hash,expires_at,
            grant_id,policy_id,matched_rule,cost_minor,currency)
           VALUES($1,$2,$3,$4,$5,now()+interval '15 minutes',$6,$7,$8,$9,$10)`,
          [approvalId, key.owner_id, key.agent_id, endpoint.id, requestHash,
            grant.id, policy.id, matchedRule, endpoint.cost_minor, endpoint.currency]);
      }
      if (decision === 'allowed') {
        await client.query(
          `UPDATE pact_grant_usage SET spent_minor=spent_minor+$2 WHERE grant_id=$1`,
          [grant.id, endpoint.cost_minor]);
        const rule = parsedPolicy.rules.find(item => item.id === matchedRule);
        if (rule) {
          const period = rule.periodSeconds ?? 86_400;
          const periodStart = Math.floor(now.getTime() / 1000 / period) * period;
          await client.query(
            `INSERT INTO pact_policy_usage(policy_id,rule_id,period_start,request_count,spent_minor)
             VALUES($1,$2,$3,1,$4) ON CONFLICT(policy_id,rule_id,period_start)
             DO UPDATE SET request_count=pact_policy_usage.request_count+1,
               spent_minor=pact_policy_usage.spent_minor+excluded.spent_minor`,
            [policy.id, rule.id, periodStart, endpoint.cost_minor]);
        }
      }
      await client.query(
        `INSERT INTO pact_proxy_activity
         (id,owner_id,agent_id,service_id,endpoint_id,grant_id,policy_id,key_id,approval_id,
          method,route,decision,matched_rule,reason,trace,latency_ms)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [requestId, key.owner_id, key.agent_id, service.id, endpoint.id, grant.id, policy.id,
          key.id, approvalId, method, endpoint.path_pattern, decision, matchedRule, reason,
          JSON.stringify(trace), Date.now() - started]);
      await client.query('COMMIT');
    } catch (cause) { await client.query('ROLLBACK'); throw cause; }
    finally { client.release(); }
    if (decision !== 'allowed') return reply.code(decision === 'pending_approval' ? 202 : 403)
      .send({ requestId, decision, reason, matchedRule, ...(approvalId ? { approvalId } : {}) });
    await ctx.database.query('UPDATE pact_endpoints SET last_used_at=now() WHERE id=$1', [endpoint.id]);
    let secret = '';
    try {
      const headers: Record<string,string> = { accept: 'application/json',
        ...(body.length ? { 'content-type': 'application/json' } : {}) };
      if (service.auth_method !== 'none') {
        const found = await ctx.database.query<Secret>(
          'SELECT * FROM pact_upstream_secrets WHERE service_id=$1 AND owner_id=$2',
          [service.id, key.owner_id]);
        const row = found.rows[0];
        if (!row) throw new Error('UPSTREAM_SECRET_MISSING');
        secret = await ctx.cipher.open({ id: row.id, principal: key.owner_id,
          provider: `http:${service.id}` }, { ciphertext: row.ciphertext,
          encryptedKey: row.encrypted_key, kmsKeyId: row.kms_key_id, version: row.cipher_version });
        headers[service.auth_method === 'bearer' ? 'authorization' : service.auth_header!.toLowerCase()] =
          service.auth_method === 'bearer' ? `Bearer ${secret}` : secret;
      }
      const target = new URL(path + raw.search, service.base_url);
      if (target.origin !== new URL(service.base_url).origin)
        throw new Error('UPSTREAM_ORIGIN_CHANGED');
      const result = await (ctx.forwarder ?? forwardUpstream)(target, method, headers, body,
        Boolean(ctx.allowLocalUpstream && service.environment === 'development'));
      if (!/^(application\/json|text\/plain)(;|$)/i.test(result.contentType))
        throw new Error('UPSTREAM_CONTENT_TYPE_DENIED');
      let payload = service.auth_method === 'none' ? result.body.toString('utf8') :
        projectProtectedResponse(result.body, result.contentType, endpoint.response_fields);
      payload = redactSecret(payload, secret);
      await ctx.database.query(
        `UPDATE pact_proxy_activity SET upstream_status=$2,latency_ms=$3,reason='UPSTREAM_RESPONDED'
         WHERE id=$1`, [requestId, result.status, Date.now() - started]);
      return reply.code(result.status).header('X-Pact-Request-Id', requestId)
        .type(service.auth_method === 'none' ? result.contentType : 'application/json').send(payload);
    } catch (cause) {
      const code = cause instanceof Error && /^[A-Z0-9_]+$/.test(cause.message) ? cause.message :
        'UPSTREAM_UNAVAILABLE';
      await ctx.database.query(
        `UPDATE pact_proxy_activity SET latency_ms=$2,reason=$3 WHERE id=$1`,
        [requestId, Date.now() - started, code]);
      return reply.code(502).send({ error: code, requestId });
    }
  });
}
