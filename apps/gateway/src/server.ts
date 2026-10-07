import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { clientHttpError, enforceIngress, AuthError, type AuthService, type Database } from '@pact/operations';
import { canonicalGatewayPolicy, hashGatewayPolicy, type GatewayPolicy } from '@pact/policies';
import type { PactClient } from '@pact/sdk-ts';
import type { SecretProvider } from '@pact/security';
import { registerProxy, type ProxyContext } from './proxy.js';

export type GatewayContext = Readonly<{
  database: Database;
  pact: PactClient;
  auth: AuthService;
  secrets: SecretProvider;
  fetcher?: typeof fetch;
  proxy?: ProxyContext;
  allowedOrigin?: string;
}>;

type PolicyRow = { policy_hash: string; policy: GatewayPolicy };
const slug = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

export async function createGateway(ctx: GatewayContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie'],
    serializers: { req: request => ({ method: request.method,
      route: request.routeOptions?.url ?? '[unmatched]'  }) } },
    bodyLimit: 256 * 1024, connectionTimeout: 15_000, requestTimeout: 15_000 });
  app.addHook('onRequest', async request => {
    if (request.method !== 'OPTIONS' && request.url !== '/health')
      await enforceIngress(ctx.database, request.ip, request.headers.authorization);
  });
  await app.register(helmet);
  if (ctx.allowedOrigin) await app.register(cors, { origin: ctx.allowedOrigin,
    methods: ['GET','POST','PUT','PATCH','DELETE'],
    allowedHeaders: ['Authorization','Content-Type','X-Pact-Approval-Id','X-Pact-Idempotency-Key'],
    exposedHeaders: ['X-Pact-Request-Id'] });
  app.setErrorHandler((cause, _request, reply) => {
    if (cause instanceof AuthError) {
      if (cause.statusCode === 429) reply.header('Retry-After','60');
      return reply.code(cause.statusCode).send({ error: cause.message });
    }
    const clientError = clientHttpError(cause);
    if (clientError) return reply.code(clientError.status).send({ error: clientError.code });
    app.log.error({ name: cause instanceof Error ? cause.name : 'UnknownError' }, 'Request failed');
    return reply.code(502).send({ error: 'UPSTREAM_UNAVAILABLE' });
  });
  app.get('/health', async () => ({ status: 'ok' }));
  if (ctx.proxy) registerProxy(app, ctx.proxy);
  app.get('/ready', async (_request, reply) => {
    try {
      await ctx.database.query('SELECT 1');
      return { status: 'ready' };
    } catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  app.get('/v1/providers/github/repos/:owner/:repo', async (request, reply) => {
    const session = await ctx.auth.authenticate(request.headers.authorization, 'provider.read');
    if (session.kind !== 'agent' || session.grantId === null) throw new AuthError('AGENT_ONLY', 403);
    const { owner, repo } = request.params as { owner: string; repo: string };
    if (!slug.test(owner) || !slug.test(repo)) throw new AuthError('INVALID_REPOSITORY', 400);
    const grant = await ctx.pact.grant(session.grantId);
    if (!grant.active || grant.agent.toLowerCase() !== session.address.toLowerCase())
      throw new AuthError('AGENT_AUTHORITY_CHANGED', 403);
    const record = await ctx.database.query<PolicyRow>(
      'SELECT policy_hash,policy FROM pact_gateway_policies WHERE grant_id=$1', [session.grantId.toString()]);
    const row = record.rows[0];
    if (!row) throw new AuthError('POLICY_NOT_FOUND', 403);
    const policy = canonicalGatewayPolicy(row.policy);
    if (hashGatewayPolicy(policy).toLowerCase() !== grant.policyHash.toLowerCase() ||
        row.policy_hash.toLowerCase() !== grant.policyHash.toLowerCase())
      throw new AuthError('POLICY_HASH_MISMATCH', 403);
    if (BigInt(policy.expiresAt) <= BigInt(Math.floor(Date.now() / 1000)))
      throw new AuthError('POLICY_EXPIRED', 403);
    const repository = `${owner}/${repo}`.toLowerCase();
    if (!policy.repositories.includes(repository)) throw new AuthError('REPOSITORY_DENIED', 403);
    const token = await ctx.secrets.githubToken(session.principal, session.grantId);
    const periodStart = Math.floor(Date.now() / 1000 / policy.periodSeconds) * policy.periodSeconds;
    const capacity = await ctx.database.query(
      `INSERT INTO pact_gateway_usage (grant_id,period_start,request_count) VALUES ($1,$2,1)
       ON CONFLICT (grant_id,period_start) DO UPDATE SET request_count=pact_gateway_usage.request_count+1
       WHERE pact_gateway_usage.request_count<$3 RETURNING request_count`,
      [session.grantId.toString(), periodStart, policy.maxRequests]);
    if (capacity.rowCount !== 1) throw new AuthError('REQUEST_BUDGET_EXCEEDED', 429);
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const response = await (ctx.fetcher ?? fetch)(endpoint, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'User-Agent': 'Pact-Gateway/0.1' },
    });
    if (!response.ok) {
      app.log.warn({ status: response.status, grantId: session.grantId.toString() }, 'provider request failed');
      return reply.code(response.status === 404 ? 404 : 502).send({ error: 'PROVIDER_REQUEST_FAILED' });
    }
    const size = Number(response.headers.get('content-length') ?? 0);
    if (size > 1_000_000) throw new Error('Provider response too large');
    if (!response.body) throw new Error('Provider response body missing');
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      const part = Buffer.from(chunk);
      bytes += part.length;
      if (bytes > 1_000_000) throw new Error('Provider response too large');
      chunks.push(part);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    const result = { fullName: data.full_name, description: data.description,
      url: data.html_url, stars: data.stargazers_count, forks: data.forks_count,
      updatedAt: data.updated_at, private: data.private };
    await ctx.database.query(
      `INSERT INTO pact_audit_events (principal,actor,action,ref_hash,details)
       VALUES ($1,$2,'github.repository.read',$3,$4)`,
      [session.principal.toLowerCase(), session.address.toLowerCase(), grant.policyHash,
        JSON.stringify({ repository, status: response.status, billing: 'zero_cost_provider_read' })]);
    return { repository: result, accounting: { provider: 'github', billedAmount: '0',
      attestation: 'gateway_log_only' } };
  });
  return app;
}
