import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalGatewayPolicy, hashGatewayPolicy } from '../dist/index.js';

test('gateway policy hash is canonical and binds limits', () => {
  const policy = { version: 1, provider: 'github', operation: 'repository.read',
    repositories: ['OpenAI/Pact', 'acme/repo', 'openai/pact'],
    maxRequests: 10, periodSeconds: 3600, expiresAt: '2000000000' };
  assert.deepEqual(canonicalGatewayPolicy(policy).repositories, ['acme/repo', 'openai/pact']);
  assert.equal(hashGatewayPolicy(policy), hashGatewayPolicy({ ...policy,
    repositories: ['acme/repo', 'OPENAI/PACT'] }));
  assert.notEqual(hashGatewayPolicy(policy), hashGatewayPolicy({ ...policy, maxRequests: 11 }));
});
