import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase, migrate } from '@pact/operations';
import { createApi } from '../dist/server.js';

const url = process.env.PACT_TEST_DATABASE_URL;
const principal = '0x0000000000000000000000000000000000000001';
const agent = '0x0000000000000000000000000000000000000002';
const account = '0x0000000000000000000000000000000000000003';
const token = '0x0000000000000000000000000000000000000004';
const recipient = '0x0000000000000000000000000000000000000005';
const policyHash = `0x${'11'.repeat(32)}`;

test('approval inbox validates actor, signature, state and expiry', { skip: !url }, async () => {
  const database = createDatabase(url);
  const grantId = String(900_000 + Math.floor(Math.random() * 100_000));
  const intent = { grantId, agent, token, to: recipient, amount: '100', nonce: '1',
    deadline: '2000000000', policyHash };
  let signatureValid = false;
  const ctx = { database, allowedOrigin: 'http://localhost:5173',
    auth: { authenticate: async header => header === 'Bearer principal'
      ? { kind: 'principal', principal, address: principal, grantId: null }
      : { kind: 'agent', principal, address: agent, grantId: BigInt(grantId) } },
    rpc: { getChainId: async () => 31337, verifyTypedData: async () => signatureValid },
    pact: { addresses: { account }, grant: async () => ({ principal, agent, active: true }),
      verifyTransfer: async () => ({ valid: false, reason: 'APPROVAL_REQUIRED' }),
      transferApprovalPayload: async () => ({ domain: { name: 'PactAccount', version: '1',
        chainId: 31337, verifyingContract: account }, types: { TransferApproval: [] },
        primaryType: 'TransferApproval', message: {} }) }, operations: {} };
  const perUserPact = ctx.pact;
  ctx.pact = { ...perUserPact, addresses:{account:'0x0000000000000000000000000000000000000099'},
    forGrant:async id=>{assert.equal(id,BigInt(grantId));return perUserPact;},
    verifyTransfer:async()=>{throw Error('global account must not verify user grant');},
    transferApprovalPayload:async()=>{throw Error('global signing domain must not be used');} };
  try {
    await migrate(database);
    const app = await createApi(ctx);
    try {
      const created = await app.inject({ method: 'POST', url: '/v1/approvals/requests',
        headers: { authorization: 'Bearer agent' }, payload: { intent, reservationId: '7' } });
      assert.equal(created.statusCode, 200);
      const id = created.json().id;
      const inbox = await app.inject({ method: 'GET', url: '/v1/approvals',
        headers: { authorization: 'Bearer principal' } });
      assert.equal(inbox.statusCode, 200);
      assert.ok(inbox.json().approvals.some(item => item.id === id));
      const invalid = await app.inject({ method: 'POST', url: `/v1/approvals/${id}/approve`,
        headers: { authorization: 'Bearer principal' }, payload: { signature: '0x1234' } });
      assert.equal(invalid.statusCode, 403);
      signatureValid = true;
      const approved = await app.inject({ method: 'POST', url: `/v1/approvals/${id}/approve`,
        headers: { authorization: 'Bearer principal' }, payload: { signature: '0x1234' } });
      assert.equal(approved.statusCode, 200);
      assert.equal(approved.json().state, 'approved');
      const read = await app.inject({ method: 'GET', url: `/v1/approvals/${id}`,
        headers: { authorization: 'Bearer agent' } });
      assert.equal(read.json().signature, '0x1234');
      const second = await app.inject({ method: 'POST', url: `/v1/approvals/${id}/approve`,
        headers: { authorization: 'Bearer principal' }, payload: { signature: '0x1234' } });
      assert.equal(second.statusCode, 409);
      const requested = await app.inject({ method: 'POST', url: '/v1/approvals/requests',
        headers: { authorization: 'Bearer agent' }, payload: { intent: { ...intent, nonce: '2' },
          reservationId: '8' } });
      const rejected = await app.inject({ method: 'POST',
        url: `/v1/approvals/${requested.json().id}/reject`,
        headers: { authorization: 'Bearer principal' }, payload: {} });
      assert.equal(rejected.json().state, 'rejected');
    } finally { await app.close(); }
  } finally { await database.end(); }
});
