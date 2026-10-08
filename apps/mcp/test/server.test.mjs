import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createPactMcp, pactHttpApi, pactGatewayApi } from '../dist/server.js';

test('gateway tool preserves policy denial reason',async()=>{
  const proxy=pactGatewayApi('https://pact.example','pat_'+'a'.repeat(43),async()=>
    Response.json({reason:'RULE_DENIED'},{status:403}));
  await assert.rejects(()=>proxy('00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002','GET','/health'),/RULE_DENIED/);
});

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

test('gateway-only MCP advertises only its usable authority and proxy tools',async()=>{
  const server=createPactMcp({legacy:false,get:async()=>{throw Error('legacy');},post:async()=>{throw Error('legacy');},
    authority:async()=>({agentId:'agent'}),proxy:async()=>({ok:true})});
  const client=new Client({name:'gateway-test',version:'1.0.0'});
  const [ct,st]=InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);await client.connect(ct);
    assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),['pact_http_authority','pact_proxy_request']);
    assert.equal((await client.callTool({name:'pact_http_authority',arguments:{}})).isError,undefined);
  } finally {await client.close();await server.close();}
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
