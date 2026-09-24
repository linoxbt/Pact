import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createPactMcp, pactHttpApi } from '../dist/server.js';

test('MCP validates input and forwards only scoped Pact calls', async () => {
  const calls = [];
  const api = { get: async path => { calls.push(['GET', path]); return { active: true }; },
    post: async (path, body) => { calls.push(['POST', path, body]); return { result: 'ALLOW' }; } };
  const server = createPactMcp(api);
  const client = new Client({ name: 'pact-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const invalid = await client.callTool({ name: 'pact_grant', arguments: { grantId: '-1' } });
    assert.equal(invalid.isError, true);
    assert.equal(calls.length, 0);
    const grant = await client.callTool({ name: 'pact_grant', arguments: { grantId: '3' } });
    assert.equal(grant.isError, undefined);
    assert.deepEqual(calls, [['GET', '/v1/grants/3']]);
  } finally { await client.close(); await server.close(); }
});

test('MCP HTTP transport rejects redirects and does not return bearer token', async () => {
  let request;
  const api = pactHttpApi('https://pact.example', 'private-token', async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ error: 'AGENT_SCOPE_DENIED' }), { status: 403 });
  });
  await assert.rejects(() => api.get('/v1/grants/1'), /AGENT_SCOPE_DENIED/);
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.Authorization, 'Bearer private-token');
});
