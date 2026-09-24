import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService, createDatabase, migrate } from '@pact/operations';
import { createApi } from '../dist/server.js';

const url = process.env.PACT_TEST_DATABASE_URL;
const principal = '0x0000000000000000000000000000000000000011';
const agentAddress = '0x0000000000000000000000000000000000000012';

test('principal registers agent and issues a single-display scoped key', { skip: !url }, async () => {
  const database = createDatabase(url);
  const grantId = BigInt(1_000_000 + Math.floor(Math.random() * 100_000));
  const pact = { grant: async () => ({ id: grantId, principal, agent: agentAddress, active: true }) };
  const rpc = { verifyMessage: async () => true };
  const auth = new AuthService(database, rpc, pact, { authDomain: 'localhost', chainId: 31337,
    sessionTtlSeconds: 3600 });
  const ctx = { database, allowedOrigin: 'http://localhost:5173', rpc, pact, operations: {},
    credentials: { seal: async (_identity, secret) => ({ ciphertext: `encrypted-${secret.length}`,
      encryptedKey: 'wrapped-key', kmsKeyId: 'test-key', version: 1 }) },
    auth: { config: auth.config, authenticate: (header, scope) =>
      header === 'Bearer principal' ? Promise.resolve({ kind: 'principal', address: principal,
        principal, grantId: null }) : auth.authenticate(header, scope) } };
  try {
    await migrate(database);
    const app = await createApi(ctx);
    try {
      const headers = { authorization: 'Bearer principal' };
      const created = await app.inject({ method: 'POST', url: '/v1/agents', headers,
        payload: { grantId: grantId.toString(), name: 'Procurement', description: 'Bounded agent' } });
      assert.equal(created.statusCode, 200, created.body);
      const agentId = created.json().id;
      const challenge = await app.inject({ method: 'POST',
        url: `/v1/agents/${agentId}/keys/challenge`, headers,
        payload: { name: 'integration', scopes: ['read', 'quote'],
          expiresAt: new Date(Date.now() + 86_400_000).toISOString() } });
      assert.equal(challenge.statusCode, 200, challenge.body);
      const issued = await app.inject({ method: 'POST', url: `/v1/agents/${agentId}/keys`, headers,
        payload: { challengeId: challenge.json().challengeId, signature: '0x1234' } });
      assert.equal(issued.statusCode, 200, issued.body);
      assert.match(issued.json().key, /^pk_[A-Za-z0-9_-]{43}$/);
      const keyHeader = `Bearer ${issued.json().key}`;
      assert.equal((await auth.authenticate(keyHeader, 'quote')).grantId, grantId);
      await assert.rejects(auth.authenticate(keyHeader, 'prepare'), /AGENT_KEY_SCOPE_DENIED/);
      await assert.rejects(auth.authenticate(keyHeader), /AGENT_KEY_SCOPE_REQUIRED/);
      const listed = await app.inject({ method: 'GET', url: `/v1/agents/${agentId}/keys`, headers });
      assert.equal(listed.statusCode, 200);
      assert.equal(listed.body.includes(issued.json().key), false);
      const replay = await app.inject({ method: 'POST', url: `/v1/agents/${agentId}/keys`, headers,
        payload: { challengeId: challenge.json().challengeId, signature: '0x1234' } });
      assert.equal(replay.statusCode, 409);
      const revoke = await app.inject({ method: 'DELETE',
        url: `/v1/agents/${agentId}/keys/${issued.json().id}`, headers });
      assert.equal(revoke.statusCode, 200);
      await assert.rejects(auth.authenticate(keyHeader, 'read'), /expired or revoked/);
      const credential = await app.inject({ method: 'POST',
        url: `/v1/agents/${agentId}/credentials`, headers,
        payload: { provider: 'github', label: 'Repository reader', secret: 'private-provider-key' } });
      assert.equal(credential.statusCode, 200, credential.body);
      assert.equal(credential.body.includes('private-provider-key'), false);
      const visible = await app.inject({ method: 'GET',
        url: `/v1/agents/${agentId}/credentials`, headers });
      assert.equal(visible.statusCode, 200);
      assert.equal(visible.body.includes('encrypted-'), false);
      const removed = await app.inject({ method: 'DELETE',
        url: `/v1/agents/${agentId}/credentials/${credential.json().id}`, headers });
      assert.equal(removed.statusCode, 200);
    } finally { await app.close(); }
  } finally { await database.end(); }
});
