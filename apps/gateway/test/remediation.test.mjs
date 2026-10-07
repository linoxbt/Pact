import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID, randomBytes, createHash} from 'node:crypto';
import {createDatabase, migrate, enforceRequestLimit} from '@pact/operations';
import {DeploymentSecretCipher} from '@pact/security';
import {createApi} from '../../api/dist/server.js';
import {createGateway} from '../dist/server.js';

const databaseUrl = process.env.PACT_TEST_DATABASE_URL;
async function fixture() {
  const database = createDatabase(databaseUrl);
  await migrate(database);
  const owner = {id:randomUUID(),did:`did:privy:${randomUUID()}`,
    principalAddress:`0x${randomBytes(20).toString('hex')}`,principalStatus:'account_assigned'};
  await database.query(`INSERT INTO pact_users(id,privy_did,principal_address,principal_status)
    VALUES($1,$2,$3,'account_assigned')`,[owner.id,owner.did,owner.principalAddress]);
  const cipher = new DeploymentSecretCipher('ab'.repeat(32));
  const admin = await createApi({database,allowedOrigin:'http://localhost:5173',credentials:cipher,ownerAuth:{authenticate:async()=>owner},
    auth:{},pact:{},rpc:{},operations:{}});
  const call = async(method,url,payload) => {
    const response = await admin.inject({method,url,payload});
    assert.ok(response.statusCode<500,response.body);
    return {status:response.statusCode,data:response.json()};
  };
  const agent = (await call('POST','/v2/agents',{name:'Regression agent',environment:'staging'})).data;
  const service = (await call('POST','/v2/services',{agentId:agent.id,name:'Regression service',
    baseUrl:'https://example.com',authMethod:'bearer'})).data;
  return {database,owner,cipher,admin,call,agent,service,
    close:async()=>{await admin.close();await database.end();}};
}

test('concurrent initial credential writes preserve decryptable identity', {skip:!databaseUrl}, async()=>{
  const f=await fixture();
  try {
    const writes=await Promise.all(Array.from({length:8},(_,i)=>f.call('PUT',
      `/v2/services/${f.service.id}/secret`,{secret:`dummy-secret-${i}`})));
    assert.ok(writes.every(x=>x.status===200));
    const row=(await f.database.query('SELECT * FROM pact_upstream_secrets WHERE service_id=$1',[f.service.id])).rows[0];
    const value=await f.cipher.open({id:row.id,principal:f.owner.id,provider:`http:${f.service.id}`},
      {ciphertext:row.ciphertext,encryptedKey:row.encrypted_key,kmsKeyId:row.kms_key_id,version:row.cipher_version});
    assert.match(value,/^dummy-secret-[0-7]$/);
  } finally {await f.close();}
});

async function authority(f, rules, count=1, options={}) {
  const method=options.method??'GET';
  await f.call('PUT',`/v2/services/${f.service.id}/secret`,{secret:'dummy-provider-token'});
  const policy=(await f.call('POST','/v2/policies',{agentId:f.agent.id,name:'Regression policy',rules})).data;
  const endpoints=[];
  for(let i=0;i<count;i++) {
    const grant=(await f.call('POST','/v2/grants',{agentId:f.agent.id,name:`Grant ${i}`,
      resourceOrigins:['https://EXAMPLE.com:443/'],destinationOrigins:['https://example.com/'],actions:[method],
      allowedRecipients:options.recipients??[],
      currency:'USD',perActionLimitMinor:'10',aggregateLimitMinor:'100',approvalThresholdMinor:'10',
      startsAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()})).data;
    endpoints.push((await f.call('POST','/v2/endpoints',{serviceId:f.service.id,grantId:grant.id,
      policyId:policy.id,method,pathPattern:`/test${i}`,costMinor:'0',currency:'USD',
      economicConstraints:options.economicConstraints??null})).data);
  }
  const key=(await f.call('POST',`/v2/agents/${f.agent.id}/keys`,{name:'Regression key',scopes:['proxy.read','proxy.write'],
    expiresAt:new Date(Date.now()+3600000).toISOString()})).data;
  let forwarded=0;
  const gateway=await createGateway({database:f.database,auth:{},pact:{},secrets:{},
    proxy:{database:f.database,cipher:f.cipher,forwarder:async()=>{
      forwarded++;return {status:200,contentType:'application/json',body:Buffer.from('{}')};
    }}});
  const proxy=(path,headers={})=>gateway.inject({method:'GET',url:`/v2/proxy/${f.agent.id}/${f.service.id}${path}`,
    headers:{authorization:`Bearer ${key.secret}`,...headers}});
  return {policy,endpoints,key,gateway,proxy,forwarded:()=>forwarded};
}
const rule={id:'shared',name:'Shared rule',effect:'allow',methods:['GET'],paths:['/*'],
  destinations:['https://example.com'],maxRequests:1,periodSeconds:86400};

test('owner collections paginate without losing tied timestamps and enforce durable quotas',{skip:!databaseUrl},async()=>{
  const f=await fixture();
  try {
    const time=new Date();
    for(let i=0;i<1000;i++) {
      if(i===999) break; // the fixture already registered one agent
      await f.database.query(`INSERT INTO pact_connected_agents(id,owner_id,name,environment,created_at)
        VALUES($1,$2,$3,'development',$4::timestamptz+interval '123 microseconds')`,[randomUUID(),f.owner.id,`Paged ${i}`,time]);
    }
    const seen=new Set();let cursor;
    do {
      const page=await f.call('GET',`/v2/agents${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`);
      assert.equal(page.status,200);
      for(const agent of page.data.agents) {assert.equal(seen.has(agent.id),false);seen.add(agent.id);}
      cursor=page.data.nextCursor;
    } while(cursor);
    assert.equal(seen.size,1000);
    const excess=await f.call('POST','/v2/agents',{name:'Too many',environment:'development'});
    assert.equal(excess.status,409);assert.equal(excess.data.error,'RESOURCE_QUOTA_EXCEEDED');
    await f.database.query(`INSERT INTO pact_proxy_activity(id,owner_id,agent_id,method,route,decision,reason,trace,created_at)
      SELECT value::uuid,$2,$3,'GET','/test','denied','TEST','[]'::jsonb,$4::timestamptz+interval '123 microseconds'
      FROM unnest($1::text[]) value`,[Array.from({length:75},()=>randomUUID()),f.owner.id,f.agent.id,time]);
    const events=new Set();cursor=null;
    do {
      const page=(await f.call('GET',`/v2/activity${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`)).data;
      for(const event of page.events) {assert.equal(events.has(event.id),false);events.add(event.id);}
      cursor=page.nextCursor;
    }while(cursor);
    assert.equal(events.size,75,'microsecond timestamp ties must survive the activity cursor');
  } finally {await f.close();}
});

test('shared policy quota is atomic across different grants', {skip:!databaseUrl}, async()=>{
  const f=await fixture();let a;
  try {
    a=await authority(f,[rule],8);
    const responses=await Promise.all(a.endpoints.map((_,i)=>a.proxy(`/test${i}`)));
    assert.equal(responses.filter(r=>r.statusCode===200).length,1);
    assert.equal(responses.filter(r=>r.statusCode===403).length,7);
    assert.equal(a.forwarded(),1);
    const usage=(await f.database.query('SELECT request_count FROM pact_policy_usage WHERE policy_id=$1',[a.policy.id])).rows;
    assert.equal(usage.reduce((n,r)=>n+r.request_count,0),1);
  } finally {await a?.gateway.close();await f.close();}
});

test('approval binds policy version and endpoint authority; fresh approval executes once', {skip:!databaseUrl}, async()=>{
  const f=await fixture();let a;
  try {
    a=await authority(f,[{...rule,effect:'approval',maxRequests:100}]);
    const pending=await a.proxy('/test0');assert.equal(pending.statusCode,202);
    const id=pending.json().approvalId;
    const stored=(await f.database.query('SELECT sealed_intent FROM pact_proxy_approvals WHERE id=$1',[id])).rows[0];
    assert.ok(stored.sealed_intent.ciphertext);
    assert.equal(JSON.stringify(stored).includes('/test0'),false);
    const details=await f.call('GET',`/v2/approvals/${id}/intent`);
    assert.equal(details.data.intent.path,'/test0');
    assert.equal(details.data.intent.destination,'https://example.com');
    assert.equal((await f.call('POST',`/v2/approvals/${id}/decision`,{decision:'approved'})).status,200);
    await f.call('PATCH',`/v2/policies/${a.policy.id}`,{rules:[{...rule,effect:'approval',maxRequests:99}]});
    const stale=await a.proxy('/test0',{'x-pact-approval-id':id});
    assert.equal(stale.statusCode,202);assert.equal(a.forwarded(),0);
    const fresh=stale.json().approvalId;
    await f.call('POST',`/v2/approvals/${fresh}/decision`,{decision:'approved'});
    assert.equal((await a.proxy('/test0',{'x-pact-approval-id':fresh})).statusCode,200);
    assert.equal((await a.proxy('/test0',{'x-pact-approval-id':fresh})).statusCode,202);
    assert.equal(a.forwarded(),1);
    const retryHeaders={'x-pact-idempotency-key':randomUUID()};
    const retriable=await a.proxy('/test0',retryHeaders);
    await f.call('POST',`/v2/approvals/${retriable.json().approvalId}/decision`,{decision:'approved'});
    retryHeaders['x-pact-approval-id']=retriable.json().approvalId;
    assert.equal((await a.proxy('/test0',retryHeaders)).statusCode,200);
    assert.equal((await a.proxy('/test0',retryHeaders)).statusCode,409,'retry must not create another approval');
    const other=(await f.call('POST','/v2/policies',{agentId:f.agent.id,name:'Other authority',
      rules:[{...rule,effect:'approval',maxRequests:100}]})).data;
    await f.call('PATCH',`/v2/endpoints/${a.endpoints[0].id}`,{policyId:other.id});
    assert.equal((await a.proxy('/test0',{'x-pact-approval-id':id})).statusCode,202);
    assert.equal(a.forwarded(),2);
  } finally {await a?.gateway.close();await f.close();}
});

test('ingress quota atomically rejects excess callers and expires by window', {skip:!databaseUrl}, async()=>{
  const f=await fixture();
  try {
    const scope=`regression:${randomUUID()}`;
    const attempts=await Promise.allSettled(Array.from({length:10},()=>enforceRequestLimit(f.database,scope,3)));
    assert.equal(attempts.filter(x=>x.status==='fulfilled').length,3);
    for(const item of attempts.filter(x=>x.status==='rejected')) assert.equal(item.reason.statusCode,429);
    await f.database.query("UPDATE pact_ingress_limits SET period_start=period_start-interval '2 minutes' WHERE bucket=$1",[createHash('sha256').update(scope).digest('hex')]);
    await enforceRequestLimit(f.database,scope,3);
    const malformed=await f.admin.inject({method:'POST',url:'/v2/agents',headers:{'content-type':'application/json'},payload:'{broken'});
    assert.equal(malformed.statusCode,400);
    const unsupported=await f.admin.inject({method:'POST',url:'/v2/agents',headers:{'content-type':'application/xml'},payload:'<x/>'});
    assert.equal(unsupported.statusCode,415);
  } finally {await f.close();}
});

test('idempotency prevents concurrent redispatch and duplicate quota consumption', {skip:!databaseUrl}, async()=>{
  const f=await fixture();let a;
  try {
    a=await authority(f,[{...rule,maxRequests:100}],2);
    const headers={'x-pact-idempotency-key':randomUUID()};
    const results=await Promise.all([a.proxy('/test0',headers),a.proxy('/test0',headers)]);
    assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
    assert.equal(a.forwarded(),1);
    assert.equal((await a.proxy('/test1',headers)).json().error,'IDEMPOTENCY_KEY_CONFLICT');
    const activity=(await f.call('GET','/v2/activity')).data.events;
    assert.equal(activity[0].execution_state,'responded');
    const usage=(await f.database.query('SELECT request_count FROM pact_policy_usage WHERE policy_id=$1',[a.policy.id])).rows;
    assert.equal(usage.reduce((n,r)=>n+r.request_count,0),1);
  } finally {await a?.gateway.close();await f.close();}
});

test('economic operations bind request minor units, currency and allowed recipient before forwarding',{skip:!databaseUrl},async()=>{
  const f=await fixture();let a;
  try {
    a=await authority(f,[{...rule,methods:['POST'],maxRequests:100}],1,{method:'POST',recipients:['vendor-123'],
      economicConstraints:{amountPath:'amount',currencyPath:'currency',recipientPath:'recipient'}});
    const send=payload=>a.gateway.inject({method:'POST',url:`/v2/proxy/${f.agent.id}/${f.service.id}/test0`,
      headers:{authorization:`Bearer ${a.key.secret}`,'x-pact-idempotency-key':randomUUID()},payload});
    const payload={amount:'10',currency:'USD',recipient:'vendor-123'};
    assert.equal((await send({...payload,amount:'11'})).statusCode,403);
    assert.equal((await send({...payload,amount:10})).statusCode,403);
    assert.equal((await send({...payload,currency:'EUR'})).statusCode,403);
    assert.equal((await send({...payload,recipient:'attacker'})).statusCode,403);
    assert.equal(a.forwarded(),0);
    const before=(await f.database.query('SELECT count(*)::int AS n FROM pact_audit_events WHERE actor=$1',[f.owner.did])).rows[0].n;
    assert.equal((await send(payload)).statusCode,200);
    assert.equal(a.forwarded(),1);
    assert.equal((await f.database.query('SELECT spent_minor FROM pact_grant_usage WHERE grant_id=$1',[a.endpoints[0].grant_id])).rows[0].spent_minor,'10');
    const after=(await f.database.query('SELECT count(*)::int AS n FROM pact_audit_events WHERE actor=$1',[f.owner.did])).rows[0].n;
    assert.equal(after,before,'usage writes do not create configuration audit events');
  } finally {await a?.gateway.close();await f.close();}
});

test('OpenAPI imports a base path and local reference and rejects remote references',{skip:!databaseUrl},async()=>{
  const f=await fixture();
  try {
    const spec={openapi:'3.0.3',info:{title:'Example'},servers:[{url:'https://example.com/v1'}],
      paths:{'/users/{id}':{$ref:'#/components/pathItems/Users'}},
      components:{pathItems:{Users:{get:{summary:'Read user'}}}}};
    const preview=await f.call('POST','/v2/openapi/preview',{spec});
    assert.equal(preview.status,200);assert.equal(preview.data.operations[0].pathPattern,'/v1/users/:id');
    spec.paths['/users/{id}'].$ref='https://untrusted.example/spec.json';
    assert.equal((await f.call('POST','/v2/openapi/preview',{spec})).status,400);
  } finally {await f.close();}
});
