import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

const uint = z.string().regex(/^(0|[1-9]\d*)$/);
const positive = uint.refine(value => BigInt(value) > 0n);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const intent = z.object({ grantId: positive, agent: address, token: address, to: address,
  amount: positive, nonce: uint, deadline: positive, policyHash: bytes32 }).strict();
const terms = z.object({ grantId: positive, reservationId: positive, provider: address,
  verifier: address, arbitrator: address, token: address, amount: positive,
  deliverBy: positive, verifyBy: positive, challengePeriod: positive,
  specificationHash: bytes32 }).strict();
const key = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);

export type PactApi = { get(path: string): Promise<unknown>; post(path: string, body: unknown): Promise<unknown> };

/** All authority checks happen in the API against the live onchain grant. */
export function createPactMcp(api: PactApi): McpServer {
  const server = new McpServer({ name: 'pact', version: '0.1.0' }, {
    instructions: 'Pact tools use the session grant only. Quote before preparing an action. A prepared call is not executed; the authorized wallet must sign and submit it. Check the operation state for finality. Never describe a pending operation as settled.',
  });
  const result = async (call: () => Promise<unknown>) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await call()) }] }; }
    catch (cause) { return { content: [{ type: 'text' as const,
      text: cause instanceof Error ? cause.message : 'Pact request failed' }], isError: true }; }
  };
  server.registerTool('pact_grant', { description: 'Read live grant authority and remaining capacity',
    inputSchema: z.object({ grantId: positive }) }, ({ grantId }) =>
    result(() => api.get(`/v1/grants/${grantId}`)));
  server.registerTool('pact_my_authority', {
    description: 'Read this agent credential’s live grant, capacity and allowed API scopes',
    inputSchema: z.object({}),
  }, () => result(() => api.get('/v1/agent/me')));
  server.registerTool('pact_quote_transfer', { description: 'Evaluate a proposed transfer without executing it',
    inputSchema: z.object({ intent }) }, ({ intent: value }) =>
    result(() => api.post('/v1/transfers/quote', value)));
  server.registerTool('pact_prepare_transfer_reservation', {
    description: 'Prepare a grant-bounded reservation transaction for the authorized wallet',
    inputSchema: z.object({ intent, idempotencyKey: key }),
  }, ({ intent: value, idempotencyKey }) => result(() => api.post(
    '/v1/transfers/prepare-reservation', { intent: value, idempotencyKey })));
  server.registerTool('pact_prepare_transfer_execution', {
    description: 'Verify a reservation and prepare the controlled transfer call for wallet signing',
    inputSchema: z.object({ intent, reservationId: positive, approval: z.string().regex(/^0x[0-9a-fA-F]*$/).optional(),
      idempotencyKey: key }),
  }, ({ intent: value, reservationId, approval, idempotencyKey }) => result(() => api.post(
    '/v1/transfers/prepare-execution', { intent: value, reservationId, approval, idempotencyKey })));
  server.registerTool('pact_operation', { description: 'Check a prepared or submitted action and its finality state',
    inputSchema: z.object({ operationId: z.uuid() }) }, ({ operationId }) =>
    result(() => api.get(`/v1/operations/${operationId}`)));
  server.registerTool('pact_mark_submitted', {
    description: 'Attach a wallet-submitted transaction hash to a prepared operation; this does not mark it confirmed',
    inputSchema: z.object({ operationId: z.uuid(), txHash: bytes32 }),
  }, ({ operationId, txHash }) => result(() => api.post(
    `/v1/operations/${operationId}/submitted`, { txHash })));
  server.registerTool('pact_receipt', { description: 'Read an onchain anchored obligation receipt and its verification result',
    inputSchema: z.object({ obligationId: positive }) }, ({ obligationId }) =>
    result(() => api.get(`/v1/receipts/${obligationId}`)));
  server.registerTool('pact_next_obligation_reservation_id', {
    description: 'Read the next expected liability reservation ID before signing obligation terms',
    inputSchema: z.object({}),
  }, () => result(() => api.get('/v1/obligations/next-reservation-id')));
  server.registerTool('pact_prepare_obligation_reservation', {
    description: 'Prepare an exact liability reservation for signed obligation terms',
    inputSchema: z.object({ terms, idempotencyKey: key }),
  }, ({ terms: value, idempotencyKey }) => result(() => api.post(
    '/v1/obligations/prepare-reservation', { terms: value, idempotencyKey })));
  server.registerTool('pact_prepare_obligation_create', {
    description: 'Verify principal and provider signatures and prepare obligation creation for wallet signing',
    inputSchema: z.object({ terms, principalSignature: z.string().regex(/^0x[0-9a-fA-F]+$/),
      providerSignature: z.string().regex(/^0x[0-9a-fA-F]+$/), idempotencyKey: key }),
  }, ({ terms: value, principalSignature, providerSignature, idempotencyKey }) => result(() => api.post(
    '/v1/obligations/prepare-create', { terms: value, principalSignature, providerSignature, idempotencyKey })));
  server.registerTool('pact_obligation', { description: 'Read an obligation within the session grant',
    inputSchema: z.object({ obligationId: positive }) }, ({ obligationId }) =>
    result(() => api.get(`/v1/obligations/${obligationId}`)));
  server.registerTool('pact_request_approval', {
    description: 'Create a principal inbox request for an exact transfer with a live reservation',
    inputSchema: z.object({ intent, reservationId: positive }),
  }, ({ intent: value, reservationId }) => result(() => api.post(
    '/v1/approvals/requests', { intent: value, reservationId })));
  server.registerTool('pact_approvals', { description: 'List approval requests visible to this scoped session',
    inputSchema: z.object({}) }, () => result(() => api.get('/v1/approvals')));
  server.registerTool('pact_approval', { description: 'Read one approval request and its state',
    inputSchema: z.object({ requestId: z.uuid() }) }, ({ requestId }) =>
    result(() => api.get(`/v1/approvals/${requestId}`)));
  server.registerTool('pact_run_agent', {
    description: 'Queue a bounded managed text task for a registered agent; requires runs.trigger scope and a vaulted provider key',
    inputSchema: z.object({ agentId: z.uuid(), input: z.string().min(1).max(32_000),
      idempotencyKey: key }),
  }, ({ agentId, input, idempotencyKey }) => result(() => api.post(
    `/v1/agents/${agentId}/runs`, { input, idempotencyKey })));
  server.registerTool('pact_run', { description: 'Read a managed agent run and its output or failure',
    inputSchema: z.object({ agentId: z.uuid(), runId: z.uuid() }) }, ({ agentId, runId }) =>
    result(() => api.get(`/v1/agents/${agentId}/runs/${runId}`)));
  return server;
}

export function pactHttpApi(baseUrl: string, token: string, fetcher: typeof fetch = fetch): PactApi {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('HTTPS required');
  if (url.username || url.password || url.search || url.hash) throw new Error('Invalid API URL');
  if (!token || /[\r\n]/.test(token)) throw new Error('PACT_SESSION_TOKEN required');
  const invoke = async (method: string, path: string, body?: unknown) => {
    const response = await fetcher(new URL(path, url), { method, redirect: 'error',
      signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json() as unknown;
    if (!response.ok) throw new Error(`Pact API ${response.status}: ${
      typeof data === 'object' && data && 'error' in data ? String(data.error) : 'request_failed'}`);
    return data;
  };
  return { get: path => invoke('GET', path), post: (path, body) => invoke('POST', path, body) };
}
