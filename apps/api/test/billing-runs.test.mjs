import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { encodeAbiParameters, encodeEventTopics, erc20Abi } from 'viem';
import { createDatabase, migrate, modelChargeMicro } from '@pact/operations';
import { createApi } from '../dist/server.js';

const url = process.env.PACT_TEST_DATABASE_URL;
const principal = `0x${randomBytes(20).toString('hex')}`;
const agentAddress = '0x0000000000000000000000000000000000000012';
const token = '0x0000000000000000000000000000000000000013';
const treasury = '0x0000000000000000000000000000000000000014';
const blockHash = `0x${'ab'.repeat(32)}`;

test('testnet deposit is finalized and single-use; funded runs reserve credit once',
  { skip: !url }, async () => {
    const database = createDatabase(url);
    const grantId = BigInt(2_000_000 + Math.floor(Math.random() * 100_000));
    const txHash = `0x${randomBytes(32).toString('hex')}`;
    const rpc = { getTransactionReceipt: async () => ({ status: 'success',
      blockNumber: 100n, blockHash,
      logs: [{ address: token, data: encodeAbiParameters([{ type: 'uint256' }], [1_000_000n]),
        topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer',
          args: { from: principal, to: treasury } }) }] }),
      getBlockNumber: async () => 110n, getBlock: async () => ({ hash: blockHash }) };
    const pact = { grant: async () => ({ id: grantId, principal, agent: agentAddress, active: true }) };
    const auth = { config: { authDomain: 'localhost', chainId: 31337, finalityBlocks: 5 },
      authenticate: async header => {
        if (header !== 'Bearer principal') throw Error('bad token');
        return { kind: 'principal', address: principal, principal, grantId: null };
      } };
    try {
      await migrate(database);
      const app = await createApi({ database, rpc, pact, auth, operations: {},
        allowedOrigin: 'http://localhost:5173', billing: { token, treasury,
          prices: { 'openai:test-model': { input: 1_000_000, output: 1_000_000 } } } });
      try {
        const headers = { authorization: 'Bearer principal' };
        const created = await app.inject({ method: 'POST', url: '/v1/agents', headers,
          payload: { grantId: grantId.toString(), name: 'Billing test agent' } });
        assert.equal(created.statusCode, 200, created.body);
        const agentId = created.json().id;
        const credited = await app.inject({ method: 'POST', url: '/v1/billing/deposits', headers,
          payload: { txHash } });
        assert.equal(credited.statusCode, 200, credited.body);
        assert.equal(credited.json().amountMicro, '1000000');
        const replay = await app.inject({ method: 'POST', url: '/v1/billing/deposits', headers,
          payload: { txHash } });
        assert.equal(replay.statusCode, 409);
        const configured = await app.inject({ method: 'PUT',
          url: `/v1/agents/${agentId}/config`, headers,
          payload: { provider: 'openai', model: 'test-model', instructions: 'Be safe',
            maxOutputTokens: 128, fundingMode: 'pact' } });
        assert.equal(configured.statusCode, 200, configured.body);
        const first = await app.inject({ method: 'POST', url: `/v1/agents/${agentId}/runs`,
          headers, payload: { input: 'hello', idempotencyKey: 'billing-test-123' } });
        assert.equal(first.statusCode, 200, first.body);
        const second = await app.inject({ method: 'POST', url: `/v1/agents/${agentId}/runs`,
          headers, payload: { input: 'hello', idempotencyKey: 'billing-test-123' } });
        assert.equal(second.json().id, first.json().id);
        const balance = await app.inject({ method: 'GET', url: '/v1/billing/balance', headers });
        assert.equal(balance.json().balanceMicro,
          (1_000_000n - BigInt(first.json().reservedMicro)).toString());
      } finally { await app.close(); }
    } finally { await database.end(); }
  });

test('model charge rounds up after the 20 percent markup', () => {
  assert.equal(modelChargeMicro(1, 0, { input: 1_000_000, output: 0 }), 2n);
  assert.equal(modelChargeMicro(1_000_000, 0, { input: 1_000_000, output: 0 }), 1_200_000n);
});
