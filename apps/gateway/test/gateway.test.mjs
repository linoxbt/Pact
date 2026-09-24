import assert from 'node:assert/strict';
import test from 'node:test';
import { hashGatewayPolicy } from '@pact/policies';
import { createGateway } from '../dist/server.js';

const policy = { version: 1, provider: 'github', operation: 'repository.read',
  repositories: ['openai/pact'], maxRequests: 2, periodSeconds: 3600,
  expiresAt: '2000000000' };
const policyHash = hashGatewayPolicy(policy);
const agent = '0x0000000000000000000000000000000000000001';
const principal = '0x0000000000000000000000000000000000000002';

function fixture() {
  let fetchCount = 0;
  let quota = 0;
  const ctx = {
    auth: { authenticate: async () => ({ kind: 'agent', grantId: 1n, address: agent, principal }) },
    pact: { grant: async () => ({ active: true, agent, policyHash }) },
    secrets: { githubToken: async () => 'super-private-token' },
    database: { query: async sql => {
      if (sql.includes('SELECT policy_hash')) return { rows: [{ policy_hash: policyHash, policy }] };
      if (sql.includes('INSERT INTO pact_gateway_usage')) {
        quota++;
        return { rowCount: quota <= policy.maxRequests ? 1 : 0 };
      }
      return { rows: [], rowCount: 1 };
    } },
    fetcher: async (url, options) => {
      fetchCount++;
      assert.equal(url, 'https://api.github.com/repos/OpenAI/Pact');
      assert.equal(options.headers.Authorization, 'Bearer super-private-token');
      assert.equal(options.redirect, 'error');
      return new Response(JSON.stringify({ full_name: 'OpenAI/Pact', description: 'Pact',
        html_url: 'https://github.com/OpenAI/Pact', stargazers_count: 7, forks_count: 2,
        updated_at: '2026-09-23T00:00:00Z', private: false }),
      { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  return { ctx, getFetchCount: () => fetchCount };
}

test('gateway enforces repository allowlist, quota and secret isolation', async () => {
  const { ctx, getFetchCount } = fixture();
  const app = await createGateway(ctx);
  try {
    const denied = await app.inject({ url: '/v1/providers/github/repos/other/repo',
      headers: { authorization: 'Bearer agent' } });
    assert.equal(denied.statusCode, 403);
    assert.equal(getFetchCount(), 0);
    const first = await app.inject({ url: '/v1/providers/github/repos/OpenAI/Pact',
      headers: { authorization: 'Bearer agent' } });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().accounting.attestation, 'gateway_log_only');
    assert.equal(first.body.includes('super-private-token'), false);
    const second = await app.inject({ url: '/v1/providers/github/repos/OpenAI/Pact',
      headers: { authorization: 'Bearer agent' } });
    assert.equal(second.statusCode, 200);
    const limited = await app.inject({ url: '/v1/providers/github/repos/OpenAI/Pact',
      headers: { authorization: 'Bearer agent' } });
    assert.equal(limited.statusCode, 429);
    assert.equal(getFetchCount(), 2);
  } finally { await app.close(); }
});
