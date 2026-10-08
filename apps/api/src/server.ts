import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { encodeFunctionData, type Address, type Hex, type PublicClient } from 'viem';
import { CommitmentLedgerAbi, ObligationManagerAbi, PactAccountAbi,
  ReceiptRegistryAbi, PactAccountFactoryAbi } from '@pact/abis';
import { clientHttpError, enforceIngress, AuthError, AuthService, OperationStore, jsonSafe, type Database,
  type OwnerAuthService } from '@pact/operations';
import { hashObligationTerms, hashTransferIntent } from '@pact/schemas';
import { canonicalGatewayPolicy, gatewayPolicySchema, hashGatewayPolicy,
  policyApprovalPayload } from '@pact/policies';
import { PactClient } from '@pact/sdk-ts';
import { z, ZodError } from 'zod';
import { address, bytes32, hex, id, obligationTerms, operationKey, transferIntent } from './validation.js';
import { registerApprovalRoutes } from './approvals.js';
import { registerEvidenceRoutes } from './evidence.js';
import { registerAgentRoutes } from './agents.js';
import { registerRunRoutes } from './runs.js';
import { registerBillingRoutes, type BillingConfig } from './billing.js';
import type { CredentialCipher, DeploymentSecretCipher, EvidenceStore } from '@pact/security';
import { registerControlPlaneRoutes } from './control-plane.js';
import { registerVerificationRoutes } from './verification.js';
import {registerActionFees,type ActionFees} from './action-fees.js';
import { registerDashboardRoutes } from './dashboard.js';

export type ApiContext = Readonly<{
  database: Database;
  rpc: PublicClient;
  pact: PactClient;
  auth: AuthService;
  operations: OperationStore;
  allowedOrigin: string | string[];
  evidence?: EvidenceStore;
  credentials?: CredentialCipher | DeploymentSecretCipher;
  customModelEndpoints?: string[];
  billing?: BillingConfig;
  actionFees?: ActionFees;
  ownerAuth?: OwnerAuthService;
  accountFactory?: `0x${string}`;
}>;

const body = async <T>(requestBody: unknown, schema: z.ZodType<T>): Promise<T> => schema.parse(requestBody);
const respond = (value: unknown) => jsonSafe(value);
const error = (statusCode: number, code: string): never => { throw new AuthError(code, statusCode); };
const requireAgent = async (ctx: ApiContext, header: string | undefined, grantId: bigint,
  scope: string = 'prepare') => {
  const session = await ctx.auth.authenticate(header, scope);
  if (session.kind !== 'agent' || session.grantId !== grantId) error(403, 'AGENT_SCOPE_DENIED');
  return session;
};
const requireGrantReader = async (ctx: ApiContext, header: string | undefined, grantId: bigint) => {
  const session = await ctx.auth.authenticate(header, 'read');
  const grant = await ctx.pact.grant(grantId);
  if (grant.principal.toLowerCase() !== session.principal.toLowerCase() ||
      (session.kind === 'agent' && session.grantId !== grantId)) error(403, 'GRANT_SCOPE_DENIED');
  return { session, grant };
};

export async function createApi(ctx: ApiContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie'],
    serializers: { req: request => ({ method: request.method,
      route: request.routeOptions?.url ?? '[unmatched]'  }) } },
    bodyLimit: 256 * 1024, connectionTimeout: 15_000, requestTimeout: 15_000 });
  app.addHook('onRequest', async request => {
    if (request.method !== 'OPTIONS' && request.url !== '/health')
      await enforceIngress(ctx.database, request.ip, request.headers.authorization);
  });
  await app.register(helmet);
  await app.register(cors, { origin: ctx.allowedOrigin, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'x-idempotency-key', 'x-pact-evidence-type', 'x-pact-payment'] });
  app.setErrorHandler((cause, _request, reply) => {
    if (cause instanceof Error && 'code' in cause && cause.code === 'P0001' &&
        cause.message === 'RESOURCE_QUOTA_EXCEEDED')
      return reply.code(409).send({error:'RESOURCE_QUOTA_EXCEEDED',message:'This workspace has reached its 1,000-record limit for this resource. Contact the operator to archive records or adjust the quota.'});
    if (cause instanceof ZodError) return reply.code(400).send({ error: 'INVALID_INPUT', issues: cause.issues });
    if (cause instanceof AuthError) {
      if (cause.statusCode === 429) reply.header('Retry-After','60');
      return reply.code(cause.statusCode).send({ error: cause.message });
    }
    const clientError = clientHttpError(cause);
    if (clientError) return reply.code(clientError.status).send({ error: clientError.code });
    if (cause instanceof SyntaxError && 'statusCode' in cause && cause.statusCode === 400)
      return reply.code(400).send({ error: 'INVALID_JSON' });
    app.log.error({ name: cause instanceof Error ? cause.name : 'UnknownError' }, 'Request failed');
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/v1/config', async request => {
    const input=z.object({principal:address.optional()}).strict().parse(request.query);
    const chainId=await ctx.rpc.getChainId();
    if (!input.principal) return respond({chainId,registry:ctx.pact.addresses.registry,
      account:null,accountPrincipal:null,accountFactory:ctx.accountFactory??null,accountMode:'per_user'});
    let account: Address='0x0000000000000000000000000000000000000000';
    if (ctx.accountFactory) {
      account=await ctx.rpc.readContract({address:ctx.accountFactory!,abi:PactAccountFactoryAbi,
        functionName:'accountOf',args:[input.principal]});
    }
    // Historical wallet-backed accounts remain accessible only for their explicitly requested owner.
    if (account==='0x0000000000000000000000000000000000000000' &&
        ctx.pact.addresses.account!=='0x0000000000000000000000000000000000000000') {
      const legacyPrincipal=await ctx.rpc.readContract({address:ctx.pact.addresses.account,
        abi:PactAccountAbi,functionName:'principal'});
      if (legacyPrincipal.toLowerCase()===input.principal.toLowerCase()) account=ctx.pact.addresses.account;
    }
    if (account==='0x0000000000000000000000000000000000000000') error(409,'DEPLOY_ACCOUNT_FIRST');
    const accountPrincipal=await ctx.rpc.readContract({address:account,abi:PactAccountAbi,functionName:'principal'});
    if (accountPrincipal.toLowerCase()!==input.principal.toLowerCase()) error(409,'ACCOUNT_OWNER_MISMATCH');
    return respond({chainId,registry:ctx.pact.addresses.registry,account,accountPrincipal,accountMode:'per_user'});
  });
  app.get('/v1/agent/me', async request => {
    const session = await ctx.auth.authenticate(request.headers.authorization, 'read');
    if (session.kind !== 'agent' || session.grantId === null) error(403, 'AGENT_ONLY');
    const grantId = session.grantId!;
    return respond({ address: session.address, principal: session.principal,
      grantId, credential: session.credential, scopes: session.scopes ?? null,
      grant: await ctx.pact.grant(grantId), capacity: await ctx.pact.capacity(grantId) });
  });
  app.get('/ready', async (_request, reply) => {
    try {
      await ctx.database.query('SELECT 1');
      const chainId = await ctx.rpc.getChainId();
      if (chainId !== ctx.auth.config.chainId) return reply.code(503).send({ status: 'wrong_chain' });
      return { status: 'ready', chainId };
    } catch { return reply.code(503).send({ status: 'unavailable' }); }
  });

  app.post('/v1/auth/challenge', async request => {
    const input = await body(request.body, z.object({ address, grantId: id.optional() }).strict());
    return ctx.auth.challenge(input.address, input.grantId);
  });
  app.post('/v1/auth/session', async request => {
    const input = await body(request.body, z.object({ nonce: z.uuid(), signature: hex }).strict());
    return ctx.auth.session(input.nonce, input.signature);
  });
  app.post('/v1/auth/logout', async request => {
    await ctx.auth.revoke(request.headers.authorization);
    return { status: 'revoked' };
  });

  app.get('/v1/grants/:id', async request => {
    const grantId = id.parse((request.params as { id: string }).id);
    const { grant } = await requireGrantReader(ctx, request.headers.authorization, grantId);
    return respond({ grant, capacity: await ctx.pact.capacity(grantId) });
  });
  app.get('/v1/public/grants/:id', async request => {
    const grantId = id.parse((request.params as { id: string }).id);
    const grant = await ctx.pact.grant(grantId);
    const stored = await ctx.database.query<{ policy_hash: string; policy: { publicAuthority?: boolean } }>(
      'SELECT policy_hash,policy FROM pact_gateway_policies WHERE grant_id=$1', [grantId.toString()]);
    if (!stored.rows[0]?.policy.publicAuthority ||
        stored.rows[0].policy_hash.toLowerCase() !== grant.policyHash.toLowerCase() ||
        hashGatewayPolicy(stored.rows[0].policy).toLowerCase() !== grant.policyHash.toLowerCase() ||
        BigInt((stored.rows[0].policy as { expiresAt: string }).expiresAt) <= (await ctx.rpc.getBlock()).timestamp)
      error(404, 'GRANT_NOT_PUBLIC');
    return respond({ grant, capacity: await ctx.pact.capacity(grantId),
      disclosure: 'principal_signed_public_authority' });
  });
  app.get('/v1/grants', async request => {
    const session = await ctx.auth.authenticate(request.headers.authorization);
    if (session.kind !== 'principal') error(403, 'PRINCIPAL_ONLY');
    const result = await ctx.database.query(
      `SELECT args,block_number,tx_hash FROM pact_chain_events
       WHERE event_name='GrantCreated' AND lower(args->>'principal')=$1
       ORDER BY block_number DESC LIMIT 100`, [session.principal.toLowerCase()]);
    return respond({ grants: result.rows, source: 'indexer_projection' });
  });

  app.post('/v1/policies', async request => {
    const session = await ctx.auth.authenticate(request.headers.authorization);
    if (session.kind !== 'principal') error(403, 'PRINCIPAL_ONLY');
    const input = await body(request.body, z.object({ grantId: id,
      policy: gatewayPolicySchema, signature: hex, signatureDeadline: id }).strict());
    const grant = await ctx.pact.grant(input.grantId);
    if (grant.principal.toLowerCase() !== session.principal.toLowerCase()) error(403, 'GRANT_SCOPE_DENIED');
    const policy = canonicalGatewayPolicy(input.policy);
    const policyHash = hashGatewayPolicy(policy);
    if (policyHash.toLowerCase() !== grant.policyHash.toLowerCase()) error(403, 'POLICY_HASH_MISMATCH');
    const block = await ctx.rpc.getBlock();
    if (input.signatureDeadline <= block.timestamp || BigInt(policy.expiresAt) <= block.timestamp)
      error(400, 'POLICY_EXPIRED');
    const payload = policyApprovalPayload(await ctx.rpc.getChainId(), ctx.pact.addresses.registry,
      input.grantId, policyHash, input.signatureDeadline);
    const verified = await ctx.rpc.verifyTypedData({ address: session.principal,
      signature: input.signature, ...payload });
    if (!verified) error(403, 'POLICY_SIGNATURE_INVALID');
    const saved = await ctx.database.query(
      `INSERT INTO pact_gateway_policies
       (grant_id,principal,policy_hash,policy,signature,signature_deadline)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (grant_id) DO UPDATE SET signature=excluded.signature,
         signature_deadline=excluded.signature_deadline
       WHERE pact_gateway_policies.policy_hash=excluded.policy_hash RETURNING grant_id`,
      [input.grantId.toString(), session.principal.toLowerCase(), policyHash,
        JSON.stringify(policy), input.signature, input.signatureDeadline.toString()]);
    if (saved.rowCount !== 1) error(409, 'POLICY_CONFLICT');
    return respond({ grantId: input.grantId, policyHash, policy });
  });
  app.get('/v1/policies/:grantId', async request => {
    const grantId = id.parse((request.params as { grantId: string }).grantId);
    await requireGrantReader(ctx, request.headers.authorization, grantId);
    const result = await ctx.database.query(
      'SELECT policy_hash,policy FROM pact_gateway_policies WHERE grant_id=$1', [grantId.toString()]);
    if (!result.rows[0]) error(404, 'POLICY_NOT_FOUND');
    return respond(result.rows[0]);
  });

  app.post('/v1/transfers/quote', async request => {
    const intent = await body(request.body, transferIntent);
    await requireAgent(ctx, request.headers.authorization, intent.grantId, 'quote');
    return respond(await (await ctx.pact.forGrant(intent.grantId)).previewTransfer(intent));
  });
  app.post('/v1/transfers/prepare-reservation', async request => {
    const input = await body(request.body, z.object({ intent: transferIntent, idempotencyKey: operationKey }).strict());
    const session = await requireAgent(ctx, request.headers.authorization, input.intent.grantId);
    const grantPact = await ctx.pact.forGrant(input.intent.grantId);
    const { quote, decision } = await grantPact.previewTransfer(input.intent);
    if (decision.result === 'DENY') error(403, decision.reason);
    const block = await ctx.rpc.getBlock();
    const grant = await ctx.pact.grant(input.intent.grantId);
    const expiry = [input.intent.deadline, grant.expiresAt, block.timestamp + 3600n]
      .reduce((smallest, value) => value < smallest ? value : smallest);
    if (expiry <= block.timestamp) error(400, 'INTENT_EXPIRED');
    const call = await grantPact.prepareReserveTransfer(input.intent, expiry);
    const actionHash = hashTransferIntent(await ctx.rpc.getChainId(), grantPact.addresses.account, input.intent);
    const operation = await ctx.operations.prepare({ principal: session.principal, actor: session.address,
      kind: 'transfer-reservation', idempotencyKey: input.idempotencyKey, actionHash,
      targetAddress: call.address, expectedEvent: 'Reserved', grantId: input.intent.grantId });
    return respond({ operation, decision, quote, expiresAt: expiry, to: call.address,
      data: encodeFunctionData(call), value: '0' });
  });
  app.post('/v1/transfers/prepare-execution', async request => {
    const input = await body(request.body, z.object({ intent: transferIntent, reservationId: id,
      approval: hex.optional(), idempotencyKey: operationKey }).strict());
    const session = await requireAgent(ctx, request.headers.authorization, input.intent.grantId);
    const grantPact = await ctx.pact.forGrant(input.intent.grantId);
    const proof = await grantPact.verifyTransfer(input.intent, input.reservationId, input.approval);
    if (!proof.valid) error(403, proof.reason);
    let simulation;
    try { simulation = await grantPact.simulateExecuteTransfer(input.intent,input.reservationId,input.approval); }
    catch { error(409,'EXECUTION_SIMULATION_FAILED'); }
    const call = grantPact.prepareExecuteTransfer(input.intent, input.reservationId, input.approval);
    const actionHash = hashTransferIntent(await ctx.rpc.getChainId(), grantPact.addresses.account, input.intent);
    const operation = await ctx.operations.prepare({ principal: session.principal, actor: session.address,
      kind: 'transfer-execution', idempotencyKey: input.idempotencyKey, actionHash,
      targetAddress: call.address, expectedEvent: 'TransferExecuted', grantId: input.intent.grantId,
      reservationId: input.reservationId });
    return respond({ operation, proof, simulation, to: call.address, data: encodeFunctionData(call), value: '0' });
  });
  app.post('/v1/transfers/approval-payload', async request => {
    const input = await body(request.body, z.object({ intent: transferIntent, reservationId: id }).strict());
    const { session } = await requireGrantReader(ctx, request.headers.authorization, input.intent.grantId);
    if (session.kind !== 'principal') error(403, 'PRINCIPAL_ONLY');
    const grantPact = await ctx.pact.forGrant(input.intent.grantId);
    const proof = await grantPact.verifyTransfer(input.intent, input.reservationId);
    if (proof.reason !== 'APPROVAL_REQUIRED') error(403, proof.reason === 'OK' ? 'APPROVAL_NOT_REQUIRED' : proof.reason);
    return respond({ payload: await grantPact.transferApprovalPayload(input.intent, input.reservationId),
      intent: input.intent, reservationId: input.reservationId });
  });

  app.get('/v1/obligations/next-reservation-id', async request => {
    const session = await ctx.auth.authenticate(request.headers.authorization, 'read');
    if (session.kind !== 'agent') error(403, 'AGENT_ONLY');
    const nextId = await ctx.rpc.readContract({ address: ctx.pact.addresses.ledger,
      abi: CommitmentLedgerAbi, functionName: 'nextReservationId' });
    return respond({ nextReservationId: nextId });
  });
  app.post('/v1/obligations/prepare-reservation', async request => {
    const input = await body(request.body, z.object({ terms: obligationTerms,
      idempotencyKey: operationKey }).strict());
    const session = await requireAgent(ctx, request.headers.authorization, input.terms.grantId);
    const grant = await ctx.pact.grant(input.terms.grantId);
    const capacity = await ctx.pact.capacity(input.terms.grantId);
    const block = await ctx.rpc.getBlock();
    if (!grant.active || input.terms.token.toLowerCase() !== grant.token.toLowerCase() ||
        input.terms.provider.toLowerCase() !== grant.recipient.toLowerCase() ||
        input.terms.amount > grant.ceiling - capacity.allocated - capacity.reserved -
          capacity.committed - capacity.spent || input.terms.deliverBy > grant.expiresAt ||
        input.terms.deliverBy <= block.timestamp) error(403, 'TERMS_OUT_OF_BOUNDS');
    const expiry = [grant.expiresAt, block.timestamp + 3600n]
      .reduce((smallest, value) => value < smallest ? value : smallest);
    const call = await ctx.pact.prepareReserveObligation(input.terms, expiry);
    const actionHash = hashObligationTerms(await ctx.rpc.getChainId(), ctx.pact.addresses.manager, input.terms);
    const operation = await ctx.operations.prepare({ principal: session.principal, actor: session.address,
      kind: 'obligation-reservation', idempotencyKey: input.idempotencyKey, actionHash,
      targetAddress: call.address, expectedEvent: 'Reserved', grantId: input.terms.grantId });
    return respond({ operation, expiresAt: expiry, to: call.address,
      data: encodeFunctionData(call), value: '0' });
  });
  app.post('/v1/obligations/prepare-create', async request => {
    const input = await body(request.body, z.object({ terms: obligationTerms,
      principalSignature: hex, providerSignature: hex, idempotencyKey: operationKey }).strict());
    const session = await requireAgent(ctx, request.headers.authorization, input.terms.grantId);
    const proof = await ctx.pact.verifyObligation(input.terms);
    if (!proof.valid) error(403, proof.reason);
    const payload = await ctx.pact.obligationSignaturePayload(input.terms);
    const grant = await ctx.pact.grant(input.terms.grantId);
    const [principalValid, providerValid] = await Promise.all([
      ctx.rpc.verifyTypedData({ address: grant.principal, signature: input.principalSignature, ...payload }),
      ctx.rpc.verifyTypedData({ address: input.terms.provider, signature: input.providerSignature, ...payload }),
    ]);
    if (!principalValid || !providerValid) error(403, 'TERMS_SIGNATURE_INVALID');
    const call = ctx.pact.prepareCreateObligation(input.terms, input.principalSignature, input.providerSignature);
    const actionHash = hashObligationTerms(await ctx.rpc.getChainId(), ctx.pact.addresses.manager, input.terms);
    const operation = await ctx.operations.prepare({ principal: session.principal, actor: session.address,
      kind: 'obligation-create', idempotencyKey: input.idempotencyKey, actionHash,
      targetAddress: call.address, expectedEvent: 'ObligationCreated', grantId: input.terms.grantId });
    return respond({ operation, proof, to: call.address, data: encodeFunctionData(call), value: '0' });
  });
  app.get('/v1/obligations/:id', async request => {
    const obligationId = id.parse((request.params as { id: string }).id);
    const session = await ctx.auth.authenticate(request.headers.authorization, 'read');
    const obligation = await ctx.rpc.readContract({ address: ctx.pact.addresses.manager,
      abi: ObligationManagerAbi, functionName: 'obligations', args: [obligationId] });
    const grantId = obligation[0];
    const grant = await ctx.pact.grant(grantId);
    if (grant.principal.toLowerCase() !== session.principal.toLowerCase() ||
        (session.kind === 'agent' && session.grantId !== grantId)) error(403, 'OBLIGATION_SCOPE_DENIED');
    return respond({ id: obligationId, obligation });
  });
  app.get('/v1/receipts/:id', async request => {
    const obligationId = id.parse((request.params as { id: string }).id);
    const receipt = await ctx.rpc.readContract({ address: ctx.pact.addresses.receipts,
      abi: ReceiptRegistryAbi, functionName: 'getReceipt', args: [obligationId] });
    const verification = await ctx.pact.verifyReceipt(obligationId);
    return respond({ id: obligationId, receipt, verification, evidenceTrust: 'named_verifier_attestation' });
  });

  app.post('/v1/operations/:id/submitted', async request => {
    const session = await ctx.auth.authenticate(request.headers.authorization, 'prepare');
    const input = await body(request.body, z.object({ txHash: bytes32 }).strict());
    const operation = await ctx.operations.get((request.params as { id: string }).id, session.principal);
    if (!operation || operation.actor.toLowerCase() !== session.address.toLowerCase() ||
        (session.kind === 'agent' && operation.grantId !== session.grantId))
      throw new AuthError('OPERATION_NOT_FOUND', 404);
    return respond(await ctx.operations.markSubmitted(operation.id, session.principal, input.txHash));
  });
  app.get('/v1/operations/:id', async request => {
    const session = await ctx.auth.authenticate(request.headers.authorization, 'read');
    const operation = await ctx.operations.get((request.params as { id: string }).id, session.principal);
    if (!operation || (session.kind === 'agent' && (operation.actor.toLowerCase() !== session.address.toLowerCase() ||
        operation.grantId !== session.grantId)))
      error(404, 'OPERATION_NOT_FOUND');
    return respond(operation);
  });
  app.get('/v1/operations', async request => {
    const session = await ctx.auth.authenticate(request.headers.authorization, 'read');
    const result = await ctx.database.query(
      `SELECT id,principal,actor,kind,action_hash,grant_id,tx_hash,state,error_code,created_at,updated_at
       FROM pact_operations WHERE principal=$1 AND ($2::text='principal' OR (actor=$3 AND grant_id=$4))
       ORDER BY created_at DESC LIMIT 100`,
      [session.principal.toLowerCase(), session.kind, session.address.toLowerCase(),
        session.grantId?.toString() ?? null]);
    return respond({ operations: result.rows });
  });
  registerApprovalRoutes(app, ctx);
  registerEvidenceRoutes(app, ctx);
  registerAgentRoutes(app, ctx);
  registerRunRoutes(app, ctx);
  registerBillingRoutes(app, ctx);
  if (ctx.ownerAuth) {
    registerControlPlaneRoutes(app, ctx);
    registerVerificationRoutes(app, ctx);
    registerDashboardRoutes(app, ctx);
    registerActionFees(app,ctx);
  }
  return app;
}
