import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { encodeFunctionData, zeroAddress } from 'viem';
import { PactAccountFactoryAbi } from '@pact/abis';
import { AuthError, jsonSafe, type Owner } from '@pact/operations';
import { endpointPath, grantInput, httpMethod, httpPolicyInput, upstreamOrigin } from '@pact/policies';
import type { ApiContext } from './server.js';

const uuid = z.uuid();
const label = z.string().trim().min(2).max(100);
const methodSchema = httpMethod;
const money = z.string().regex(/^(0|[1-9]\d*)$/);
const fail = (code: string, status = 400): never => { throw new AuthError(code, status); };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const pageSize = 30;
const ownerId = (header: string | undefined, ctx: ApiContext) => ctx.ownerAuth!.authenticate(header);
const audit = async (ctx: ApiContext, owner: Owner, action: string, details: Record<string, unknown>) => {
  await ctx.database.query(
    `INSERT INTO pact_audit_events(principal,actor,action,details) VALUES($1,$2,$3,$4)`,
    [owner.principalAddress ?? owner.did, owner.did, action, JSON.stringify(details)]);
};
const requirePrincipal = (owner: Owner) => {
  if (!owner.principalAddress || owner.principalStatus !== 'verified')
    fail('VERIFY_ACCOUNT_ADDRESS_FIRST', 409);
  return owner.principalAddress!;
};
type IdRow = { id: string; owner_id: string; agent_id?: string; status?: string;
  [key: string]: unknown };
const getOwned = async (ctx: ApiContext, table: string, id: string, owner: Owner): Promise<IdRow> => {
  if (!uuid.safeParse(id).success) fail('INVALID_ID');
  // Table names come exclusively from this module's fixed call sites.
  const result = await ctx.database.query<IdRow>(
    `SELECT * FROM ${table} WHERE id=$1 AND owner_id=$2`, [id, owner.id]);
  if (!result.rows[0]) fail('NOT_FOUND', 404);
  return result.rows[0]!;
};
const keyScopes = z.array(z.enum(['proxy.read','proxy.write'])).min(1).max(2);
const originAllowed = (input: string, environment: string) => {
  const url = new URL(input);
  if (url.protocol === 'https:' && url.port === '' && url.hostname !== 'localhost' &&
      !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && !url.hostname.endsWith('.local')) return;
  if (environment === 'development' && process.env.PACT_ALLOW_LOCAL_UPSTREAM === 'yes' &&
      url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)) return;
  fail('UPSTREAM_ORIGIN_NOT_ALLOWED');
};

export function registerControlPlaneRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/v2/account', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const onchainAccount = owner.principalAddress && ctx.accountFactory ?
      await ctx.rpc.readContract({ address: ctx.accountFactory, abi: PactAccountFactoryAbi,
        functionName: 'accountOf', args: [owner.principalAddress] }) : null;
    return { id: owner.id, principalAddress: owner.principalAddress,
      verificationStatus: owner.principalStatus,
      onchainAccount: onchainAccount === zeroAddress ? null : onchainAccount,
      onchainStatus: !ctx.accountFactory ? 'factory_unconfigured' :
        onchainAccount && onchainAccount !== zeroAddress ? 'deployed' : 'not_deployed',
      note: 'Gateway grants are account-owned. Onchain spending requires a separately authorized transaction.' };
  });
  app.post('/v2/account/onchain/prepare', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const principal = requirePrincipal(owner);
    if (!ctx.accountFactory) fail('ACCOUNT_FACTORY_UNCONFIGURED', 503);
    const current = await ctx.rpc.readContract({ address: ctx.accountFactory!,
      abi: PactAccountFactoryAbi, functionName: 'accountOf', args: [principal] });
    if (current !== zeroAddress) fail('ACCOUNT_ALREADY_DEPLOYED', 409);
    await audit(ctx, owner, 'account.onchain.deployment_prepared', { principal,
      factory: ctx.accountFactory });
    return { from: principal, to: ctx.accountFactory,
      data: encodeFunctionData({ abi: PactAccountFactoryAbi, functionName: 'createAccount' }),
      chainId: await ctx.rpc.getChainId(),
      explanation: 'Your account wallet must sign and fund this Monad transaction.' };
  });
  app.post('/v2/account/address/challenge', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const { address } = z.object({ address: z.string() }).strict().parse(request.body);
    return ctx.ownerAuth!.challenge(owner, address);
  });
  app.post('/v2/account/address/verify', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const { challengeId, signature } = z.object({ challengeId: uuid,
      signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }).strict().parse(request.body);
    const result = await ctx.ownerAuth!.verifyAddress(owner, challengeId, signature);
    await audit(ctx, owner, 'account.principal.verified', { previousAddress: owner.principalAddress,
      newAddress: result.principalAddress, legacyGrantsRetained: true });
    return result;
  });
  app.get('/v2/account/principal-history', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const rows = await ctx.database.query(
      `SELECT previous_address,new_address,changed_at FROM pact_principal_history
       WHERE user_id=$1 ORDER BY id DESC LIMIT 100`, [owner.id]);
    return { changes: jsonSafe(rows.rows) };
  });

  const agentInput = z.object({ name: label, environment: z.enum(['development','staging','production']),
    description: z.string().max(1000).default('') }).strict();
  app.post('/v2/agents', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    requirePrincipal(owner);
    const input = agentInput.parse(request.body);
    const id = randomUUID();
    const saved = await ctx.database.query(
      `INSERT INTO pact_connected_agents(id,owner_id,name,environment,description)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [id, owner.id, input.name, input.environment, input.description]);
    await audit(ctx, owner, 'agent.created', { agentId: id, environment: input.environment });
    return jsonSafe(saved.rows[0]);
  });
  app.get('/v2/agents', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const rows = await ctx.database.query(
      `SELECT * FROM pact_connected_agents WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100`, [owner.id]);
    return { agents: jsonSafe(rows.rows) };
  });
  app.get('/v2/agents/:id', async request => jsonSafe(await getOwned(ctx, 'pact_connected_agents',
    (request.params as { id: string }).id, await ownerId(request.headers.authorization, ctx))));
  app.patch('/v2/agents/:id', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const agent = await getOwned(ctx, 'pact_connected_agents', (request.params as { id: string }).id, owner);
    const input = agentInput.partial().extend({ status: z.enum(['active','disabled']).optional() })
      .strict().parse(request.body);
    if (!Object.keys(input).length) fail('EMPTY_UPDATE');
    const result = await ctx.database.query(
      `UPDATE pact_connected_agents SET name=COALESCE($2,name),environment=COALESCE($3,environment),
       description=COALESCE($4,description),status=COALESCE($5,status),updated_at=now()
       WHERE id=$1 RETURNING *`,
      [agent.id, input.name ?? null, input.environment ?? null, input.description ?? null,
        input.status ?? null]);
    await audit(ctx, owner, 'agent.updated', { agentId: agent.id, fields: Object.keys(input) });
    return jsonSafe(result.rows[0]);
  });

  app.post('/v2/grants', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const principal = requirePrincipal(owner);
    const input = grantInput.parse(request.body);
    await getOwned(ctx, 'pact_connected_agents', input.agentId, owner);
    const id = randomUUID();
    const result = await ctx.database.query(
      `INSERT INTO pact_authority_grants
       (id,owner_id,agent_id,principal_address,name,resource_origins,actions,destination_origins,
        currency,per_action_limit_minor,aggregate_limit_minor,approval_threshold_minor,starts_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [id, owner.id, input.agentId, principal.toLowerCase(), input.name, input.resourceOrigins,
        input.actions, input.destinationOrigins, input.currency, input.perActionLimitMinor,
        input.aggregateLimitMinor, input.approvalThresholdMinor, input.startsAt, input.expiresAt]);
    await audit(ctx, owner, 'grant.created', { grantId: id, agentId: input.agentId,
      principal, bounds: input, kind: 'offchain_http_only' });
    return jsonSafe({ ...result.rows[0] as object, authorityType: 'offchain_http_only' });
  });
  app.get('/v2/grants', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const rows = await ctx.database.query(
      `SELECT g.*,COALESCE(u.spent_minor,0)::text AS spent_minor FROM pact_authority_grants g
       LEFT JOIN pact_grant_usage u ON u.grant_id=g.id WHERE g.owner_id=$1
       ORDER BY g.created_at DESC LIMIT 100`, [owner.id]);
    return { grants: jsonSafe(rows.rows), authorityType: 'offchain_http_only' };
  });
  app.get('/v2/grants/:id', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const row = await getOwned(ctx, 'pact_authority_grants', (request.params as { id: string }).id, owner);
    return jsonSafe({ ...row, authorityType: 'offchain_http_only' });
  });
  app.patch('/v2/grants/:id', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const old = await getOwned(ctx, 'pact_authority_grants', (request.params as { id: string }).id, owner);
    if (old.status !== 'active') fail('GRANT_REVOKED', 409);
    const input = z.object({ actions: z.array(methodSchema).min(1).optional(),
      resourceOrigins: z.array(upstreamOrigin).min(1).optional(),
      destinationOrigins: z.array(upstreamOrigin).min(1).optional(),
      perActionLimitMinor: money.optional(), aggregateLimitMinor: money.optional(),
      approvalThresholdMinor: money.optional(), expiresAt: z.iso.datetime({ offset: true }).optional(),
      status: z.literal('revoked').optional() }).strict().parse(request.body);
    if (!Object.keys(input).length) fail('EMPTY_UPDATE');
    const subset = (next: string[] | undefined, current: unknown) =>
      !next || next.every(value => (current as string[]).includes(value));
    if (!subset(input.actions, old.actions) || !subset(input.resourceOrigins, old.resource_origins) ||
        !subset(input.destinationOrigins, old.destination_origins) ||
        (input.perActionLimitMinor && BigInt(input.perActionLimitMinor) > BigInt(old.per_action_limit_minor as string)) ||
        (input.aggregateLimitMinor && BigInt(input.aggregateLimitMinor) > BigInt(old.aggregate_limit_minor as string)) ||
        (input.approvalThresholdMinor && BigInt(input.approvalThresholdMinor) > BigInt(old.approval_threshold_minor as string)) ||
        (input.expiresAt && Date.parse(input.expiresAt) > new Date(old.expires_at as string).getTime()))
      fail('GRANT_CHANGES_MUST_NARROW_AUTHORITY', 409);
    const rows = await ctx.database.query(
      `UPDATE pact_authority_grants SET actions=COALESCE($2,actions),
       resource_origins=COALESCE($3,resource_origins),destination_origins=COALESCE($4,destination_origins),
       per_action_limit_minor=COALESCE($5,per_action_limit_minor),
       aggregate_limit_minor=COALESCE($6,aggregate_limit_minor),
       approval_threshold_minor=COALESCE($7,approval_threshold_minor),
       expires_at=COALESCE($8,expires_at),status=COALESCE($9,status),version=version+1,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [old.id, input.actions ?? null, input.resourceOrigins ?? null, input.destinationOrigins ?? null,
        input.perActionLimitMinor ?? null, input.aggregateLimitMinor ?? null,
        input.approvalThresholdMinor ?? null, input.expiresAt ?? null, input.status ?? null]);
    await audit(ctx, owner, 'grant.narrowed', { grantId: old.id, changes: input });
    return jsonSafe(rows.rows[0]);
  });

  app.post('/v2/policies', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const input = httpPolicyInput.parse(request.body);
    await getOwned(ctx, 'pact_connected_agents', input.agentId, owner);
    const id = randomUUID();
    const rows = await ctx.database.query(
      `INSERT INTO pact_http_policies(id,owner_id,agent_id,name,rules) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [id, owner.id, input.agentId, input.name, JSON.stringify(input.rules)]);
    await audit(ctx, owner, 'policy.created', { policyId: id, rules: input.rules });
    return jsonSafe(rows.rows[0]);
  });
  app.get('/v2/policies', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const rows = await ctx.database.query(
      `SELECT * FROM pact_http_policies WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100`, [owner.id]);
    return { policies: jsonSafe(rows.rows) };
  });
  app.get('/v2/policies/:id', async request => jsonSafe(await getOwned(ctx, 'pact_http_policies',
    (request.params as { id: string }).id, await ownerId(request.headers.authorization, ctx))));
  app.patch('/v2/policies/:id', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const policy = await getOwned(ctx, 'pact_http_policies', (request.params as { id: string }).id, owner);
    const input = z.object({ name: label.optional(), rules: httpPolicyInput.shape.rules.optional(),
      status: z.enum(['active','disabled']).optional() }).strict().parse(request.body);
    if (!Object.keys(input).length) fail('EMPTY_UPDATE');
    if (input.rules) httpPolicyInput.parse({ agentId: policy.agent_id, name: input.name ?? policy.name,
      rules: input.rules });
    const rows = await ctx.database.query(
      `UPDATE pact_http_policies SET name=COALESCE($2,name),rules=COALESCE($3,rules),
       status=COALESCE($4,status),version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
      [policy.id, input.name ?? null, input.rules ? JSON.stringify(input.rules) : null,
        input.status ?? null]);
    await audit(ctx, owner, 'policy.updated', { policyId: policy.id, changes: input });
    return jsonSafe(rows.rows[0]);
  });

  const serviceInput = z.object({ agentId: uuid, name: label, baseUrl: upstreamOrigin,
    authMethod: z.enum(['none','bearer','header']).default('none'),
    authHeader: z.string().regex(/^[A-Za-z0-9-]{1,80}$/).optional() }).strict();
  app.post('/v2/services', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const input = serviceInput.parse(request.body);
    const agent = await getOwned(ctx, 'pact_connected_agents', input.agentId, owner);
    originAllowed(input.baseUrl, agent.environment as string);
    if (input.authMethod === 'header' && !input.authHeader) fail('AUTH_HEADER_REQUIRED');
    if (input.authMethod !== 'header' && input.authHeader) fail('AUTH_HEADER_UNEXPECTED');
    if (input.authHeader?.toLowerCase() === 'host' ||
        input.authHeader?.toLowerCase() === 'content-length') fail('UNSAFE_AUTH_HEADER');
    const id = randomUUID();
    const rows = await ctx.database.query(
      `INSERT INTO pact_services(id,owner_id,agent_id,name,base_url,auth_method,auth_header)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, owner.id, input.agentId, input.name, input.baseUrl,
        input.authMethod, input.authHeader ?? null]);
    await audit(ctx, owner, 'service.created', { serviceId: id, baseUrl: input.baseUrl });
    return jsonSafe(rows.rows[0]);
  });
  app.get('/v2/services', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const rows = await ctx.database.query(
      `SELECT s.*, EXISTS(SELECT 1 FROM pact_upstream_secrets x WHERE x.service_id=s.id)
       AS has_secret FROM pact_services s WHERE s.owner_id=$1 ORDER BY created_at DESC LIMIT 100`, [owner.id]);
    return { services: jsonSafe(rows.rows) };
  });
  app.get('/v2/services/:id', async request => jsonSafe(await getOwned(ctx, 'pact_services',
    (request.params as { id: string }).id, await ownerId(request.headers.authorization, ctx))));
  app.patch('/v2/services/:id', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const service = await getOwned(ctx, 'pact_services', (request.params as { id: string }).id, owner);
    const input = z.object({ name: label.optional(), status: z.enum(['active','disabled']).optional() })
      .strict().parse(request.body);
    if (!Object.keys(input).length) fail('EMPTY_UPDATE');
    const rows = await ctx.database.query(
      `UPDATE pact_services SET name=COALESCE($2,name),status=COALESCE($3,status),updated_at=now()
       WHERE id=$1 RETURNING *`, [service.id, input.name ?? null, input.status ?? null]);
    await audit(ctx, owner, 'service.updated', { serviceId: service.id, changes: input });
    return jsonSafe(rows.rows[0]);
  });
  app.put('/v2/services/:id/secret', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const service = await getOwned(ctx, 'pact_services', (request.params as { id: string }).id, owner);
    if (service.auth_method === 'none') fail('SERVICE_DOES_NOT_USE_SECRET');
    const cipher = ctx.credentials;
    if (!cipher) throw new AuthError('CREDENTIAL_VAULT_UNAVAILABLE', 503);
    const { secret } = z.object({ secret: z.string().min(8).max(16_384) }).strict().parse(request.body);
    if (/[\r\n]/.test(secret)) fail('INVALID_SECRET');
    const existing = await ctx.database.query<{ id: string }>(
      'SELECT id FROM pact_upstream_secrets WHERE service_id=$1', [service.id]);
    const id = existing.rows[0]?.id ?? randomUUID();
    const sealed = await cipher.seal({ id, principal: owner.id, provider: `http:${service.id}` }, secret);
    await ctx.database.query(
      `INSERT INTO pact_upstream_secrets
       (id,service_id,owner_id,ciphertext,encrypted_key,kms_key_id,cipher_version)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(service_id) DO UPDATE SET ciphertext=excluded.ciphertext,
        encrypted_key=excluded.encrypted_key,kms_key_id=excluded.kms_key_id,
        cipher_version=excluded.cipher_version,updated_at=now()`,
      [id, service.id, owner.id, sealed.ciphertext, sealed.encryptedKey,
        sealed.kmsKeyId, sealed.version]);
    await audit(ctx, owner, 'service.secret.rotated', { serviceId: service.id, secretId: id });
    return { status: existing.rows[0] ? 'rotated' : 'stored' };
  });
  app.delete('/v2/services/:id/secret', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const service = await getOwned(ctx, 'pact_services', (request.params as { id: string }).id, owner);
    await ctx.database.query('DELETE FROM pact_upstream_secrets WHERE service_id=$1', [service.id]);
    await audit(ctx, owner, 'service.secret.revoked', { serviceId: service.id });
    return { status: 'revoked' };
  });

  const endpointInput = z.object({ serviceId: uuid, grantId: uuid, policyId: uuid,
    method: httpMethod, pathPattern: endpointPath,
    description: z.string().max(500).default(''), costMinor: money.default('0'),
    currency: z.string().regex(/^[A-Z]{3,12}$/) }).strict();
  const createEndpoint = async (owner: Owner, input: z.infer<typeof endpointInput>) => {
    const service = await getOwned(ctx, 'pact_services', input.serviceId, owner);
    const grant = await getOwned(ctx, 'pact_authority_grants', input.grantId, owner);
    const policy = await getOwned(ctx, 'pact_http_policies', input.policyId, owner);
    if (service.agent_id !== grant.agent_id || service.agent_id !== policy.agent_id ||
        grant.status !== 'active' || policy.status !== 'active' ||
        input.currency !== grant.currency ||
        !(grant.actions as string[]).includes(input.method) ||
        !(grant.resource_origins as string[]).includes(service.base_url as string) ||
        !(grant.destination_origins as string[]).includes(service.base_url as string) ||
        BigInt(input.costMinor) > BigInt(grant.per_action_limit_minor as string))
      fail('ENDPOINT_OUTSIDE_AUTHORITY', 409);
    const id = randomUUID();
    const rows = await ctx.database.query(
      `INSERT INTO pact_endpoints
       (id,service_id,agent_id,owner_id,grant_id,policy_id,method,path_pattern,
        description,cost_minor,currency)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [id, service.id, service.agent_id, owner.id, grant.id, policy.id, input.method,
        input.pathPattern, input.description, input.costMinor, input.currency]);
    await audit(ctx, owner, 'endpoint.created', { endpointId: id, serviceId: service.id,
      method: input.method, pathPattern: input.pathPattern });
    return jsonSafe(rows.rows[0]);
  };
  app.post('/v2/endpoints', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    return createEndpoint(owner, endpointInput.parse(request.body));
  });
  app.get('/v2/endpoints', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const rows = await ctx.database.query(
      `SELECT e.*,s.name AS service_name,s.base_url,a.name AS agent_name,
       p.name AS policy_name FROM pact_endpoints e
       JOIN pact_services s ON s.id=e.service_id
       JOIN pact_connected_agents a ON a.id=e.agent_id
       JOIN pact_http_policies p ON p.id=e.policy_id
       WHERE e.owner_id=$1 ORDER BY e.created_at DESC LIMIT 100`, [owner.id]);
    return { endpoints: jsonSafe(rows.rows) };
  });
  app.get('/v2/endpoints/:id', async request => jsonSafe(await getOwned(ctx, 'pact_endpoints',
    (request.params as { id: string }).id, await ownerId(request.headers.authorization, ctx))));
  app.patch('/v2/endpoints/:id', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const endpoint = await getOwned(ctx, 'pact_endpoints', (request.params as { id: string }).id, owner);
    const input = z.object({ description: z.string().max(500).optional(),
      status: z.enum(['active','disabled']).optional(), policyId: uuid.optional() }).strict().parse(request.body);
    if (!Object.keys(input).length) fail('EMPTY_UPDATE');
    if (input.policyId) {
      const policy = await getOwned(ctx, 'pact_http_policies', input.policyId, owner);
      if (policy.agent_id !== endpoint.agent_id || policy.status !== 'active')
        fail('POLICY_AGENT_MISMATCH', 409);
    }
    const rows = await ctx.database.query(
      `UPDATE pact_endpoints SET description=COALESCE($2,description),status=COALESCE($3,status),
       policy_id=COALESCE($4,policy_id),updated_at=now() WHERE id=$1 RETURNING *`,
      [endpoint.id, input.description ?? null, input.status ?? null, input.policyId ?? null]);
    await audit(ctx, owner, 'endpoint.updated', { endpointId: endpoint.id, changes: input });
    return jsonSafe(rows.rows[0]);
  });
  const openApiInput = z.object({ openapi: z.string().regex(/^3\./),
    info: z.object({ title: z.string() }).passthrough(),
    servers: z.array(z.object({ url: z.string() }).passthrough()).min(1),
    paths: z.record(z.string(), z.record(z.string(), z.unknown())) }).passthrough();
  const parseOpenApi = (spec: unknown) => {
    const doc = openApiInput.parse(spec);
    const baseUrl = upstreamOrigin.parse(doc.servers[0]!.url);
    const operations: Array<{ method: string; pathPattern: string; description: string }> = [];
    for (const [route, methods] of Object.entries(doc.paths)) {
      const pathPattern = endpointPath.parse(route.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1'));
      for (const [verb, raw] of Object.entries(methods)) {
        const method = verb.toUpperCase();
        if (!httpMethod.safeParse(method).success) continue;
        const entry = raw && typeof raw === 'object' ? raw as { summary?: unknown; description?: unknown } : {};
        operations.push({ method, pathPattern,
          description: String(entry.summary ?? entry.description ?? '').slice(0, 500) });
      }
    }
    if (!operations.length || operations.length > 50) fail('OPENAPI_OPERATION_COUNT_INVALID');
    return { name: doc.info.title.slice(0, 100), baseUrl, operations };
  };
  app.post('/v2/openapi/preview', async request => {
    await ownerId(request.headers.authorization, ctx);
    const { spec } = z.object({ spec: z.unknown() }).strict().parse(request.body);
    return parseOpenApi(spec);
  });
  app.post('/v2/services/:id/import', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const service = await getOwned(ctx, 'pact_services', (request.params as { id: string }).id, owner);
    const { spec, grantId, policyId, currency } = z.object({ spec: z.unknown(),
      grantId: uuid, policyId: uuid, currency: z.string().regex(/^[A-Z]{3,12}$/) }).strict().parse(request.body);
    const parsed = parseOpenApi(spec);
    if (parsed.baseUrl !== service.base_url) fail('OPENAPI_ORIGIN_MISMATCH', 409);
    const grant = await getOwned(ctx, 'pact_authority_grants', grantId, owner);
    const policy = await getOwned(ctx, 'pact_http_policies', policyId, owner);
    if (service.agent_id !== grant.agent_id || service.agent_id !== policy.agent_id ||
        grant.status !== 'active' || policy.status !== 'active' || currency !== grant.currency ||
        !(grant.resource_origins as string[]).includes(service.base_url as string) ||
        !(grant.destination_origins as string[]).includes(service.base_url as string) ||
        !parsed.operations.every(operation => (grant.actions as string[]).includes(operation.method)))
      fail('ENDPOINT_OUTSIDE_AUTHORITY', 409);
    const client = await ctx.database.connect();
    try {
      await client.query('BEGIN');
      const imported = [];
      for (const operation of parsed.operations) {
        const input = endpointInput.parse({ serviceId: service.id, grantId, policyId, currency, ...operation });
        const id = randomUUID();
        const row = await client.query(
          `INSERT INTO pact_endpoints
           (id,service_id,agent_id,owner_id,grant_id,policy_id,method,path_pattern,
            description,cost_minor,currency)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [id, service.id, service.agent_id, owner.id, grantId, policyId, input.method,
            input.pathPattern, input.description, input.costMinor, currency]);
        imported.push(row.rows[0]);
        await client.query(
          `INSERT INTO pact_audit_events(principal,actor,action,details) VALUES($1,$2,$3,$4)`,
          [owner.principalAddress ?? owner.did, owner.did, 'endpoint.created',
            JSON.stringify({ endpointId: id, serviceId: service.id, method: input.method,
              pathPattern: input.pathPattern, source: 'openapi' })]);
      }
      await client.query('COMMIT');
      return { imported: jsonSafe(imported) };
    } catch (cause) { await client.query('ROLLBACK'); throw cause; }
    finally { client.release(); }
  });

  const issueKey = async (owner: Owner, agentId: string, input: { name: string; scopes: string[];
    expiresAt: string }, rotatedFrom: string | null = null) => {
    const agent = await getOwned(ctx, 'pact_connected_agents', agentId, owner);
    if (agent.status !== 'active') fail('AGENT_DISABLED', 409);
    const expires = new Date(input.expiresAt);
    if (expires.getTime() <= Date.now() || expires.getTime() > Date.now() + 90 * 86_400_000)
      fail('INVALID_KEY_EXPIRY');
    const secret = `pat_${randomBytes(32).toString('base64url')}`;
    const id = randomUUID();
    const client = await ctx.database.connect();
    try {
      await client.query('BEGIN');
      if (rotatedFrom) {
        const revoked = await client.query(
          `UPDATE pact_integration_keys SET revoked_at=now()
           WHERE id=$1 AND owner_id=$2 AND agent_id=$3 AND revoked_at IS NULL RETURNING id`,
          [rotatedFrom, owner.id, agent.id]);
        if (revoked.rowCount !== 1) fail('KEY_ALREADY_REVOKED', 409);
      }
      await client.query(
        `INSERT INTO pact_integration_keys
         (id,owner_id,agent_id,token_hash,prefix,name,scopes,expires_at,rotated_from)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, owner.id, agent.id, hash(secret), secret.slice(0, 12), input.name,
          input.scopes, expires, rotatedFrom]);
      await client.query('COMMIT');
    } catch (cause) { await client.query('ROLLBACK'); throw cause; }
    finally { client.release(); }
    await audit(ctx, owner, rotatedFrom ? 'integration_key.rotated' : 'integration_key.issued',
      { agentId: agent.id, keyId: id, rotatedFrom, scopes: input.scopes, expiresAt: input.expiresAt });
    return { id, secret, prefix: secret.slice(0, 12), name: input.name,
      scopes: input.scopes, expiresAt: input.expiresAt, displayOnce: true };
  };
  app.post('/v2/agents/:id/keys', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const input = z.object({ name: label, scopes: keyScopes,
      expiresAt: z.iso.datetime({ offset: true }) }).strict().parse(request.body);
    return issueKey(owner, (request.params as { id: string }).id, input);
  });
  app.get('/v2/agents/:id/keys', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const agent = await getOwned(ctx, 'pact_connected_agents', (request.params as { id: string }).id, owner);
    const rows = await ctx.database.query(
      `SELECT id,prefix,name,scopes,expires_at,last_used_at,revoked_at,rotated_from,created_at
       FROM pact_integration_keys WHERE owner_id=$1 AND agent_id=$2 ORDER BY created_at DESC LIMIT 100`,
      [owner.id, agent.id]);
    return { keys: jsonSafe(rows.rows) };
  });
  app.get('/v2/keys/summary', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const rows = await ctx.database.query<{ active: string }>(
      `SELECT count(*) FILTER (WHERE revoked_at IS NULL AND expires_at>now())::text AS active
       FROM pact_integration_keys WHERE owner_id=$1`, [owner.id]);
    return { active: Number(rows.rows[0]?.active ?? 0) };
  });
  app.post('/v2/agents/:id/keys/:keyId/rotate', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const agent = await getOwned(ctx, 'pact_connected_agents', (request.params as { id: string }).id, owner);
    const old = await getOwned(ctx, 'pact_integration_keys', (request.params as { keyId: string }).keyId, owner);
    if (old.agent_id !== agent.id || old.revoked_at) fail('KEY_NOT_ACTIVE', 409);
    const expiresAt = new Date(old.expires_at as string);
    if (expiresAt.getTime() <= Date.now()) fail('KEY_EXPIRED', 409);
    return issueKey(owner, agent.id, { name: old.name as string, scopes: old.scopes as string[],
      expiresAt: expiresAt.toISOString() }, old.id);
  });
  app.delete('/v2/agents/:id/keys/:keyId', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const agent = await getOwned(ctx, 'pact_connected_agents', (request.params as { id: string }).id, owner);
    const keyId = uuid.parse((request.params as { keyId: string }).keyId);
    const result = await ctx.database.query(
      `UPDATE pact_integration_keys SET revoked_at=now()
       WHERE id=$1 AND agent_id=$2 AND owner_id=$3 AND revoked_at IS NULL RETURNING id`,
      [keyId, agent.id, owner.id]);
    if (result.rowCount !== 1) fail('KEY_NOT_ACTIVE', 404);
    await audit(ctx, owner, 'integration_key.revoked', { agentId: agent.id, keyId });
    return { status: 'revoked' };
  });

  app.get('/v2/activity', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const input = z.object({ agentId: uuid.optional(), decision: z.enum(['allowed','denied','pending_approval']).optional(),
      search: z.string().max(100).optional(), cursor: z.string().max(300).optional() })
      .strict().parse(request.query);
    let cursorTime: string | null = null; let cursorId: string | null = null;
    if (input.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as [string,string];
        if (!z.iso.datetime().safeParse(decoded[0]).success || !uuid.safeParse(decoded[1]).success)
          fail('INVALID_CURSOR');
        [cursorTime, cursorId] = decoded;
      } catch { fail('INVALID_CURSOR'); }
    }
    const rows = await ctx.database.query<{ id: string; created_at: Date }>(
      `SELECT v.*,a.name AS agent_name,s.name AS service_name,p.name AS policy_name
       FROM pact_proxy_activity v JOIN pact_connected_agents a ON a.id=v.agent_id
       LEFT JOIN pact_services s ON s.id=v.service_id
       LEFT JOIN pact_http_policies p ON p.id=v.policy_id
       WHERE v.owner_id=$1 AND v.created_at>now()-interval '30 days'
       AND ($2::uuid IS NULL OR v.agent_id=$2)
       AND ($3::text IS NULL OR v.decision=$3)
       AND ($4::text IS NULL OR v.route ILIKE '%'||$4||'%' OR a.name ILIKE '%'||$4||'%'
         OR v.reason ILIKE '%'||$4||'%')
       AND ($5::timestamptz IS NULL OR (v.created_at,v.id)<($5,$6::uuid))
       ORDER BY v.created_at DESC,v.id DESC LIMIT $7`,
      [owner.id, input.agentId ?? null, input.decision ?? null, input.search ?? null,
        cursorTime, cursorId, pageSize + 1]);
    const hasMore = rows.rows.length > pageSize;
    const page = rows.rows.slice(0, pageSize);
    const last = page.at(-1);
    return { events: jsonSafe(page), nextCursor: hasMore && last ?
      Buffer.from(JSON.stringify([last.created_at.toISOString(), last.id])).toString('base64url') : null,
      retentionDays: 30, disclosure: 'private_gateway_log_not_onchain_receipt' };
  });
  app.get('/v2/activity/:id', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const record = await getOwned(ctx, 'pact_proxy_activity', (request.params as { id: string }).id, owner);
    return jsonSafe({ ...record, disclosure: 'private_gateway_log_not_onchain_receipt' });
  });
  app.get('/v2/approvals', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    await ctx.database.query(
      `UPDATE pact_proxy_approvals SET state='expired' WHERE owner_id=$1 AND state='pending'
       AND expires_at<=now()`, [owner.id]);
    const rows = await ctx.database.query(
      `SELECT x.*,a.name AS agent_name,e.method,e.path_pattern FROM pact_proxy_approvals x
       JOIN pact_connected_agents a ON a.id=x.agent_id
       JOIN pact_endpoints e ON e.id=x.endpoint_id
       WHERE x.owner_id=$1 ORDER BY x.created_at DESC LIMIT 100`, [owner.id]);
    return { approvals: jsonSafe(rows.rows) };
  });
  app.post('/v2/approvals/:id/decision', async request => {
    const owner = await ownerId(request.headers.authorization, ctx);
    const approval = await getOwned(ctx, 'pact_proxy_approvals',
      (request.params as { id: string }).id, owner);
    const { decision } = z.object({ decision: z.enum(['approved','rejected']) }).strict().parse(request.body);
    const result = await ctx.database.query(
      `UPDATE pact_proxy_approvals SET state=$2,decided_at=now()
       WHERE id=$1 AND owner_id=$3 AND state='pending' AND expires_at>now() RETURNING *`,
      [approval.id, decision, owner.id]);
    if (!result.rows[0]) fail('APPROVAL_NOT_PENDING', 409);
    await audit(ctx, owner, `proxy_approval.${decision}`, { approvalId: approval.id });
    return jsonSafe(result.rows[0]);
  });
}
