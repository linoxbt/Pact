import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import Fastify from 'fastify';
import { createDatabase, migrate } from '@pact/operations';
import { DeploymentSecretCipher } from '@pact/security';
import { registerControlPlaneRoutes } from '../../api/dist/control-plane.js';
import { createGateway } from '../dist/server.js';
import { forwardUpstream } from '../dist/upstream.js';
import { projectProtectedResponse, selectEndpoint } from '../dist/proxy.js';

const dbUrl = process.env.PACT_TEST_DATABASE_URL;
const parse = response => { assert.ok(response.statusCode < 500, response.body); return response.json(); };
test('endpoint selection prefers specific routes and rejects equal-precedence overlaps', () => {
  const broad = { method: 'GET', path_pattern: '/*' };
  const exact = { method: 'GET', path_pattern: '/health' };
  assert.deepEqual(selectEndpoint([broad, exact], 'GET', '/health'),
    { endpoint: exact, ambiguous: false });
  const first = { method: 'GET', path_pattern: '/users/:id' };
  const second = { method: 'GET', path_pattern: '/users/:user' };
  assert.equal(selectEndpoint([first, second], 'GET', '/users/123').ambiguous, true);
});
test('authenticated upstream bodies default to empty and expose selected JSON fields only', () => {
  const body = Buffer.from(JSON.stringify({ status:'ok', credential:'provider-secret' }));
  assert.equal(projectProtectedResponse(body,'application/json',[]),'{}');
  assert.deepEqual(JSON.parse(projectProtectedResponse(body,'application/json',['status'])),{status:'ok'});
  assert.equal(projectProtectedResponse(Buffer.from('provider-secret'),'text/plain',['status']),'{}');
});
test('gateway blocks private destinations and non-TLS upstreams', async () => {
  await assert.rejects(() => forwardUpstream(new URL('https://127.0.0.1/secret'),
    'GET', {}, Buffer.alloc(0)), /UPSTREAM_ADDRESS_NOT_ALLOWED/);
  await assert.rejects(() => forwardUpstream(new URL('http://example.com/secret'),
    'GET', {}, Buffer.alloc(0)), /UPSTREAM_ORIGIN_NOT_ALLOWED/);
});
test('account-owned proxy flow enforces policy, encrypts secrets, audits and revokes keys',
  { skip: !dbUrl }, async () => {
  const database = createDatabase(dbUrl);
  const upstreamSecret = 'demo-"local"-secret';
  let upstreamCalls = 0;
  const upstream = createServer((request, response) => {
    upstreamCalls++;
    assert.equal(request.headers.authorization, `Bearer ${upstreamSecret}`);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, echoedSecret: upstreamSecret,
      encodedSecret: Buffer.from(upstreamSecret).toString('base64') }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  const owner = { id: randomUUID(), did: `did:privy:${randomUUID().replaceAll('-','')}`,
    principalAddress: `0x${randomBytes(20).toString('hex')}`, principalStatus: 'account_assigned' };
  const cipher = new DeploymentSecretCipher('ab'.repeat(32));
  const ctx = { database, credentials: cipher, ownerAuth: { authenticate: async () => owner } };
  const admin = Fastify();
  admin.setErrorHandler((cause,_request,reply) => reply.code(cause.statusCode ?? 500)
    .send({ error: cause.message }));
  registerControlPlaneRoutes(admin, ctx);
  const request = async (method, path, payload) => {
    const response = await admin.inject({ method, url: path,
      headers: { authorization: 'Bearer fake-test-owner-token' }, ...(payload === undefined ? {} : { payload }) });
    return { response, data: parse(response) };
  };
  let gateway;
  const previousLocal = process.env.PACT_ALLOW_LOCAL_UPSTREAM;
  process.env.PACT_ALLOW_LOCAL_UPSTREAM = 'yes';
  try {
    await migrate(database);
    await database.query(`INSERT INTO pact_users(id,privy_did,principal_address,principal_status)
      VALUES($1,$2,$3,'account_assigned')`, [owner.id, owner.did, owner.principalAddress.toLowerCase()]);
    assert.equal((await request('POST','/v2/account/onchain/prepare',{})).response.statusCode,409,
      'account-assigned identifiers cannot authorize Monad transactions');
    const agent = (await request('POST','/v2/agents',{ name:'Demo agent', environment:'development' })).data;
    const audit = (await request('GET','/v2/audit')).data;
    assert.ok(audit.events.some(item => item.action === 'control.pact_connected_agents.insert'
      && item.details.recordId === agent.id));
    const service = (await request('POST','/v2/services',{ agentId:agent.id,name:'Local demo',
      baseUrl:origin,authMethod:'bearer' })).data;
    const raceGrant = (await request('POST','/v2/grants',{ agentId:agent.id,name:'Concurrent narrowing',
      resourceOrigins:[origin],destinationOrigins:[origin],actions:['GET','POST'],currency:'USD',
      perActionLimitMinor:'0',aggregateLimitMinor:'0',approvalThresholdMinor:'0',
      startsAt:new Date(Date.now()-60_000).toISOString(),expiresAt:new Date(Date.now()+86_400_000).toISOString() })).data;
    const race = await Promise.all([
      request('PATCH',`/v2/grants/${raceGrant.id}`,{ actions:['GET'] }),
      request('PATCH',`/v2/grants/${raceGrant.id}`,{ actions:['POST'] }),
    ]);
    assert.deepEqual(race.map(item=>item.response.statusCode).sort(),[200,409]);
    const finalRaceGrant = (await request('GET',`/v2/grants/${raceGrant.id}`)).data;
    assert.equal(finalRaceGrant.actions.length,1,'concurrent update cannot restore authority');
    const saved = await request('PUT',`/v2/services/${service.id}/secret`,{ secret:upstreamSecret });
    assert.equal(saved.response.statusCode,200);
    const stored = await database.query('SELECT ciphertext FROM pact_upstream_secrets WHERE service_id=$1',[service.id]);
    assert.equal(stored.rows[0].ciphertext.includes(upstreamSecret),false);
    const grant = (await request('POST','/v2/grants',{ agentId:agent.id,name:'Demo grant',
      resourceOrigins:[origin],destinationOrigins:[origin],actions:['GET'],currency:'USD',
      perActionLimitMinor:'0',aggregateLimitMinor:'0',approvalThresholdMinor:'0',
      startsAt:new Date(Date.now()-60_000).toISOString(),expiresAt:new Date(Date.now()+86_400_000).toISOString() })).data;
    const policy = (await request('POST','/v2/policies',{ agentId:agent.id,name:'Read health',rules:[
      { id:'health',name:'Allow health',effect:'allow',methods:['GET'],paths:['/health'],
        destinations:[origin],maxRequests:10,periodSeconds:60 } ] })).data;
    const endpoint = (await request('POST','/v2/endpoints',{ serviceId:service.id,grantId:grant.id,
      policyId:policy.id,method:'GET',pathPattern:'/health',costMinor:'0',currency:'USD',
      responseFields:['ok','echoedSecret','encodedSecret'] })).data;
    assert.equal(endpoint.id.length,36);
    const issued = (await request('POST',`/v2/agents/${agent.id}/keys`,{
      name:'Demo integration',scopes:['proxy.read'],expiresAt:new Date(Date.now()+86_400_000).toISOString() })).data;
    assert.match(issued.secret,/^pat_[A-Za-z0-9_-]{43}$/);
    const keyRow = await database.query('SELECT token_hash FROM pact_integration_keys WHERE id=$1',[issued.id]);
    assert.equal(keyRow.rows[0].token_hash,createHash('sha256').update(issued.secret).digest('hex'));
    assert.equal((await request('GET',`/v2/agents/${agent.id}/keys`)).response.body.includes(issued.secret),false);
    gateway = await createGateway({ database, auth:{},pact:{},secrets:{},
      allowedOrigin:'http://localhost:5173',
      proxy:{ database,cipher,allowLocalUpstream:true } });
    const preflight = await gateway.inject({ method:'OPTIONS',
      url:`/v2/proxy/${agent.id}/${service.id}/health`,
      headers:{ origin:'http://localhost:5173',
        'access-control-request-method':'GET',
        'access-control-request-headers':'authorization' } });
    assert.equal(preflight.statusCode,204);
    assert.equal(preflight.headers['access-control-allow-origin'],'http://localhost:5173');
    const call = (token,method,path) => gateway.inject({ method,
      url:`/v2/proxy/${agent.id}/${service.id}${path}`,
      headers:{authorization:`Bearer ${token}`} });
    const allowed = await call(issued.secret,'GET','/health');
    assert.equal(allowed.statusCode,200,allowed.body);
    assert.equal(allowed.json().ok,true);
    assert.equal(allowed.body.includes(upstreamSecret),false);
    assert.equal(allowed.body.includes('demo-\\"local\\"-secret'),false);
    assert.equal(allowed.body.includes(Buffer.from(upstreamSecret).toString('base64')),false);
    assert.equal(allowed.body.includes('[REDACTED]'),true);
    const deniedMethod = await call(issued.secret,'POST','/health');
    const deniedPath = await call(issued.secret,'GET','/private');
    assert.equal(deniedMethod.statusCode,401,'read-only key rejects write before policy or forwarding');
    assert.equal(deniedPath.statusCode,403);
    assert.equal(upstreamCalls,1,'denied calls never reached upstream');
    const activity = (await request('GET','/v2/activity')).data;
    assert.equal(activity.events.length,2);
    assert.deepEqual(new Set(activity.events.map(item=>item.decision)),new Set(['allowed','denied']));
    assert.equal(JSON.stringify(activity).includes(upstreamSecret),false);
    const detail = (await request('GET',`/v2/activity/${activity.events.find(item=>item.decision==='allowed').id}`)).data;
    assert.equal(detail.matched_rule,'health');
    assert.equal(detail.trace.at(-1).result,'allow');
    const rotated = (await request('POST',`/v2/agents/${agent.id}/keys/${issued.id}/rotate`,{})).data;
    assert.equal((await call(issued.secret,'GET','/health')).statusCode,401);
    assert.equal((await call(rotated.secret,'GET','/health')).statusCode,200);
    await request('DELETE',`/v2/agents/${agent.id}/keys/${rotated.id}`);
    assert.equal((await call(rotated.secret,'GET','/health')).statusCode,401);
    assert.equal(upstreamCalls,2);
    const migrationSource = (await request('POST','/v2/grants',{ agentId:agent.id,
      name:'Grant to migrate',resourceOrigins:[origin],destinationOrigins:[origin],
      actions:['GET'],currency:'USD',perActionLimitMinor:'5',aggregateLimitMinor:'10',
      approvalThresholdMinor:'5',startsAt:new Date(Date.now()-60_000).toISOString(),
      expiresAt:new Date(Date.now()+86_400_000).toISOString() })).data;
    await database.query('INSERT INTO pact_grant_usage(grant_id,spent_minor) VALUES($1,3)',
      [migrationSource.id]);
    const migratingEndpoint = (await request('POST','/v2/endpoints',{ serviceId:service.id,
      grantId:migrationSource.id,policyId:policy.id,method:'GET',pathPattern:'/migration',
      costMinor:'1',currency:'USD' })).data;
    const nextPrincipal = `0x${randomBytes(20).toString('hex')}`;
    await database.query('UPDATE pact_users SET principal_address=$2 WHERE id=$1',
      [owner.id,nextPrincipal]);
    owner.principalAddress = nextPrincipal;
    const migrated = await request('POST',`/v2/grants/${migrationSource.id}/migrate`,{});
    assert.equal(migrated.response.statusCode,200);
    assert.equal(migrated.data.grant.principal_address,nextPrincipal);
    assert.equal((await database.query('SELECT spent_minor FROM pact_grant_usage WHERE grant_id=$1',
      [migrated.data.grant.id])).rows[0].spent_minor,'3');
    assert.equal((await database.query('SELECT grant_id FROM pact_endpoints WHERE id=$1',
      [migratingEndpoint.id])).rows[0].grant_id,migrated.data.grant.id);
    assert.equal((await request('GET',`/v2/grants/${migrationSource.id}`)).data.status,'revoked');
  } finally {
    if (gateway) await gateway.close();
    await admin.close();
    await database.end();
    await new Promise(resolve=>upstream.close(resolve));
    if (previousLocal===undefined) delete process.env.PACT_ALLOW_LOCAL_UPSTREAM;
    else process.env.PACT_ALLOW_LOCAL_UPSTREAM=previousLocal;
  }
});
