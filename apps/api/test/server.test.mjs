import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../dist/server.js';
import { hashGatewayPolicy } from '@pact/policies';

const principal = '0x0000000000000000000000000000000000000001';
const agent = '0x0000000000000000000000000000000000000002';
const token = '0x0000000000000000000000000000000000000003';
const recipient = '0x0000000000000000000000000000000000000004';
const account = '0x0000000000000000000000000000000000000005';
const ledger = '0x0000000000000000000000000000000000000006';
const manager = '0x0000000000000000000000000000000000000007';
const policyHash = `0x${'11'.repeat(32)}`;
const intent = { grantId: '1', agent, token, to: recipient, amount: '100', nonce: '1',
  deadline: '2000000000', policyHash };

function fixture() {
  const ctx = {
    allowedOrigin: 'http://localhost:3000',
    database: { query: async () => ({ rows: [] }) },
    rpc: { getChainId: async () => 31337, getBlock: async () => ({ timestamp: 1_800_000_000n }) },
    auth: { config: { chainId: 31337 },
      authenticate: async header => {
        if (!header) throw Object.assign(new Error('Bearer token required'), { statusCode: 401 });
        return { kind: 'agent', grantId: 1n, principal, address: agent };
      } },
    pact: { addresses: { account, ledger, manager },
      grant: async () => ({ principal, agent, account, token, recipient, ceiling: 1000n,
        expiresAt: 2_000_000_100n, active: true }),
      previewTransfer: async action => ({ quote: { cashNow: action.amount, grossLiability: action.amount },
        decision: { result: 'ALLOW', reason: 'OK' } }),
      prepareReserveTransfer: async (action, expiry) => ({ address: ledger,
        abi: [{ type: 'function', name: 'reserve', stateMutability: 'nonpayable',
          inputs: [{ name: 'grantId', type: 'uint256' }, { name: 'intentHash', type: 'bytes32' },
            { name: 'amount', type: 'uint256' }, { name: 'expiresAt', type: 'uint64' }],
          outputs: [{ type: 'uint256' }] }], functionName: 'reserve',
        args: [action.grantId, `0x${'22'.repeat(32)}`, action.amount, expiry] }) },
    operations: { prepare: async input => ({ id: 'op-1', ...input, state: 'prepared' }) },
  };
  ctx.pact.forGrant = async () => ctx.pact;
  return ctx;
}

test('agent quote is scoped to its authenticated grant', async () => {
  const app = await createApi(fixture());
  try {
    const allowed = await app.inject({ method: 'POST', url: '/v1/transfers/quote',
      headers: { authorization: 'Bearer fake' }, payload: intent });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json().quote.grossLiability, '100');
    const denied = await app.inject({ method: 'POST', url: '/v1/transfers/quote',
      headers: { authorization: 'Bearer fake' }, payload: { ...intent, grantId: '2' } });
    assert.equal(denied.statusCode, 403);
  } finally { await app.close(); }
});

test('reservation response contains a wallet transaction and pending operation', async () => {
  const app = await createApi(fixture());
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/transfers/prepare-reservation',
      headers: { authorization: 'Bearer fake' },
      payload: { intent, idempotencyKey: 'demo-request-001' } });
    assert.equal(response.statusCode, 200);
    const value = response.json();
    assert.equal(value.to, ledger);
    assert.match(value.data, /^0x[0-9a-f]+$/);
    assert.equal(value.operation.state, 'prepared');
    assert.equal(value.expiresAt, '1800003600');
  } finally { await app.close(); }
});

test('public grant requires matching signed disclosure policy', async () => {
  const ctx = fixture();
  const policy = { version: 1, provider: 'github', operation: 'repository.read',
    repositories: ['owner/repo'], maxRequests: 10, periodSeconds: 3600,
    expiresAt: '2000000000', publicAuthority: true };
  const hash = hashGatewayPolicy(policy);
  ctx.pact.grant = async () => ({ ...await fixture().pact.grant(), id: 1n, policyHash: hash });
  ctx.pact.capacity = async () => ({ allocated: 0n, reserved: 0n, committed: 0n, spent: 0n });
  ctx.database.query = async () => ({ rows: [{ policy_hash: hash, policy: { ...policy, publicAuthority: false } }] });
  const app = await createApi(ctx);
  try {
    const hidden = await app.inject({ method: 'GET', url: '/v1/public/grants/1' });
    assert.equal(hidden.statusCode, 404);
    ctx.database.query = async () => ({ rows: [{ policy_hash: hash, policy }] });
    const shown = await app.inject({ method: 'GET', url: '/v1/public/grants/1' });
    assert.equal(shown.statusCode, 200);
    assert.equal(shown.json().disclosure, 'principal_signed_public_authority');
  } finally { await app.close(); }
});

test('principal approval payload requires a live exact reservation', async () => {
  const ctx = fixture();
  ctx.auth.authenticate = async () => ({ kind: 'principal', grantId: null, principal, address: principal });
  ctx.pact.verifyTransfer = async () => ({ valid: false, reason: 'APPROVAL_REQUIRED' });
  ctx.pact.transferApprovalPayload = async () => ({ primaryType: 'TransferApproval', message: { reservationId: 7n } });
  const app = await createApi(ctx);
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/transfers/approval-payload',
      headers: { authorization: 'Bearer fake' }, payload: { intent, reservationId: '7' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().payload.message.reservationId, '7');
    ctx.pact.verifyTransfer = async () => ({ valid: false, reason: 'RESERVATION_MISMATCH' });
    const denied = await app.inject({ method: 'POST', url: '/v1/transfers/approval-payload',
      headers: { authorization: 'Bearer fake' }, payload: { intent, reservationId: '7' } });
    assert.equal(denied.statusCode, 403);
  } finally { await app.close(); }
});
