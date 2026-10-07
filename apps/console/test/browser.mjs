// Real Console + API + PostgreSQL. Only Privy authentication is substituted;
// this is not evidence of a successful hosted Privy sign-in.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'vite';
import {createDatabase,migrate} from '../../../packages/operations/dist/index.js';
import {DeploymentSecretCipher} from '../../../packages/security/dist/index.js';
import {createApi} from '../../api/dist/server.js';
import {createGateway} from '../../gateway/dist/server.js';
import {createServer as httpServer} from 'node:http';

const database=createDatabase(process.env.PACT_TEST_DATABASE_URL);
process.env.PACT_ALLOW_LOCAL_UPSTREAM='yes';
await migrate(database);
const owners=[];
for(const label of ['one','two']) {
  const owner={id:randomUUID(),did:`did:privy:browser-${label}`,principalAddress:`0x${randomBytes(20).toString('hex')}`,principalStatus:'account_assigned'};
  await database.query(`INSERT INTO pact_users(id,privy_did,principal_address,principal_status) VALUES($1,$2,$3,'account_assigned')
    ON CONFLICT(privy_did) DO UPDATE SET principal_address=excluded.principal_address RETURNING id`,[owner.id,owner.did,owner.principalAddress])
    .then(r=>owner.id=r.rows[0].id);
  owners.push(owner);
}
const cipher=new DeploymentSecretCipher('ab'.repeat(32));
const api=await createApi({database,allowedOrigin:'http://127.0.0.1:4198',credentials:{
  seal:async(identity,value)=>{if(value==='browser-failure-secret')throw Error('INJECTED_VAULT_FAILURE');return cipher.seal(identity,value);},
  open:(...args)=>cipher.open(...args)},
  ownerAuth:{authenticate:async header=>{
    const token=header?.replace('Bearer ','');const sub=JSON.parse(Buffer.from(token.split('.')[1],'base64').toString()).sub;
    return owners.find(owner=>owner.did===sub);}},auth:{},pact:{},rpc:{},operations:{}});
let failPolicyRead=false;
api.addHook('onRequest',async(request,reply)=>{if(failPolicyRead && request.method==='GET' && request.url==='/v2/policies')return reply.code(503).send({error:'INJECTED_OUTAGE'});});
await api.listen({host:'127.0.0.1',port:4197});
let upstreamCalls=0;
const upstream=httpServer((request,response)=>{
  upstreamCalls++;
  assert.equal(request.headers.authorization,'Bearer browser-upstream-secret');
  response.writeHead(200,{'content-type':'application/json'});
  response.end(JSON.stringify({status:'healthy',secret:'browser-upstream-secret'}));
});
await new Promise(resolve=>upstream.listen(4195,'127.0.0.1',resolve));
const gateway=await createGateway({database,auth:{},pact:{},secrets:{},allowedOrigin:'http://127.0.0.1:4198',
  proxy:{database,cipher:new DeploymentSecretCipher('ab'.repeat(32)),allowLocalUpstream:true}});
await gateway.listen({host:'127.0.0.1',port:4196});
const root=resolve(import.meta.dirname,'..');
const vite=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:4198,strictPort:true},
  resolve:{alias:{'@privy-io/react-auth':resolve(root,'test/browser/privy.ts')}},
  define:{'import.meta.env.VITE_PACT_API_URL':JSON.stringify('http://127.0.0.1:4197'),
    'import.meta.env.VITE_PACT_GATEWAY_URL':JSON.stringify('http://127.0.0.1:4196')}});
await vite.listen();
const profile=await mkdtemp(join(tmpdir(),'pact-console-test-'));
const chrome=spawn(process.env.CHROME_PATH??'/snap/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage',
  '--remote-debugging-port=9369',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
let ws;
try {
  let targets;
  for(let i=0;i<100;i++){try{targets=await fetch('http://127.0.0.1:9369/json').then(r=>r.json());break;}catch{await new Promise(r=>setTimeout(r,100));}}
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let sequence=0;const pending=new Map();
  ws.addEventListener('message',e=>{const message=JSON.parse(e.data);if(message.id){pending.get(message.id)(message);pending.delete(message.id);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,m=>m.error?reject(m.error):resolve(m.result));ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const waitFor=async expression=>{for(let i=0;i<100;i++){if(await evaluate(`Boolean(${expression})`))return;await new Promise(r=>setTimeout(r,100));}throw Error(`Timed out: ${expression}`);};
  const click=async label=>{await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(label)} && !b.disabled)`);return evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})?.click()`);};
  const input=(label,value)=>evaluate(`(()=>{const e=[...document.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent===${JSON.stringify(label)}).querySelector('input,textarea,select');Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await call('Page.navigate',{url:'http://127.0.0.1:4198/test/browser/index.html'});
  await waitFor(`document.body.innerText.includes('Connect an agent. Keep control.')`);
  await waitFor(`document.body.innerText.includes('Register a service') && !document.body.innerText.includes('Loading your workspace')`);
  await click('Agents');await waitFor(`document.body.innerText.includes('Agent name')`);
  const name=`Browser agent ${randomUUID()}`;
  await input('Agent name',name);await click('Review agent');await waitFor(`document.querySelector('[role="dialog"]')`);
  await click('Confirm change');await waitFor(`document.body.innerText.includes(${JSON.stringify(name)})`);
  const rows=await database.query('SELECT id,name FROM pact_connected_agents WHERE owner_id=$1 AND name=$2',[owners[0].id,name]);
  assert.equal(rows.rowCount,1);
  failPolicyRead=true;await click('Retry loading');
  await waitFor(`document.body.innerText.includes('Temporarily unavailable: Policies')`);
  assert.ok(await evaluate(`document.body.innerText.includes(${JSON.stringify(name)})`));
  failPolicyRead=false;
  const agentId=rows.rows[0].id;
  const seed=async(url,payload)=>{
    const result=await api.inject({method:'POST',url,payload,headers:{authorization:`Bearer test.${Buffer.from(JSON.stringify({sub:owners[0].did})).toString('base64')}.test`}});
    assert.ok(result.statusCode<300,result.body);return result.json();
  };
  const origin='http://127.0.0.1:4195';
  const service=await seed('/v2/services',{agentId,name:'Browser upstream',baseUrl:origin,authMethod:'bearer'});
  const token=`test.${Buffer.from(JSON.stringify({sub:owners[0].did})).toString('base64')}.test`;
  assert.equal((await api.inject({method:'PUT',url:`/v2/services/${service.id}/secret`,headers:{authorization:`Bearer ${token}`},payload:{secret:'browser-upstream-secret'}})).statusCode,200);
  const grant=await seed('/v2/grants',{agentId,name:'Browser grant',resourceOrigins:[origin],destinationOrigins:[origin],
    actions:['GET'],currency:'USD',perActionLimitMinor:'0',aggregateLimitMinor:'0',approvalThresholdMinor:'0',
    startsAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()});
  const policy=await seed('/v2/policies',{agentId,name:'Browser policy',rules:[{id:'read',name:'Allow health',effect:'allow',methods:['GET'],paths:['/health'],destinations:[origin]}]});
  await seed('/v2/endpoints',{serviceId:service.id,grantId:grant.id,policyId:policy.id,method:'GET',pathPattern:'/health',costMinor:'0',currency:'USD',responseFields:['status']});
  await click('Retry loading');await click('API keys');await input('Agent',agentId);
  await click('Review and issue');await waitFor(`document.querySelector('[role="dialog"]')`);await click('Confirm change');
  await waitFor(`document.querySelector('.cpSecret code')`);
  const send=path=>evaluate(`(async()=>{window.browserKey=window.browserKey||document.querySelector('.cpSecret code').textContent;const r=await fetch('http://127.0.0.1:4196/v2/proxy/${agentId}/${service.id}${path}',{headers:{Authorization:'Bearer '+window.browserKey}});return {status:r.status,body:await r.text()};})()`);
  const allowed=await send('/health');assert.equal(allowed.status,200);assert.equal(allowed.body.includes('browser-upstream-secret'),false);
  assert.equal((await send('/forbidden')).status,403);assert.equal(upstreamCalls,1);
  await click('Live Activity');await waitFor(`document.querySelectorAll('.cpActivityRow').length>=2`);
  await waitFor(`[...document.querySelectorAll('.cpDecision')].some(e=>e.textContent==='allowed') && [...document.querySelectorAll('.cpDecision')].some(e=>e.textContent==='denied')`);
  await api.inject({method:'PATCH',url:`/v2/policies/${policy.id}`,headers:{authorization:`Bearer ${token}`},payload:{
    rules:[{id:'read',name:'Approve health',effect:'approval',methods:['GET'],paths:['/health'],destinations:[origin]}]}});
  await click('Approvals');
  const pendingApproval=await send('/health');assert.equal(pendingApproval.status,202);
  const approvalId=JSON.parse(pendingApproval.body).approvalId;
  await waitFor(`document.body.innerText.includes('${approvalId}')`);
  const row=`[...document.querySelectorAll('.cpListRow')].find(row=>row.textContent.includes('${approvalId}'))`;
  assert.equal(await evaluate(`${row}.querySelector('.cpPrimary').disabled`),true);
  await evaluate(`${row}.querySelector('button').click()`);
  await waitFor(`document.querySelector('pre')?.textContent.includes('/health')`);
  await evaluate(`${row}.querySelector('.cpPrimary').click()`);await click('Confirm change');
  await waitFor(`${row}?.textContent.includes('approved')`);
  await database.query("UPDATE pact_proxy_approvals SET expires_at=now()-interval '1 second' WHERE id=$1",[approvalId]);
  await waitFor(`${row}?.textContent.includes('expired')`);
  await click('API keys');await click('Revoke');await waitFor(`document.querySelector('[role="dialog"]')`);await click('Confirm change');
  await waitFor(`document.body.innerText.includes('revoked')`);
  assert.equal((await send('/health')).status,401);assert.equal(upstreamCalls,1);
  await click('Endpoints');await input('Agent',agentId);await input('Service name','Credential failure recovery');
  await input('Base URL','https://failure.example.com');await input('Upstream authentication','bearer');
  await waitFor(`document.body.innerText.includes('Upstream secret')`);await input('Upstream secret','browser-failure-secret');
  await click('Review service');await click('Confirm change');
  await waitFor(`document.body.innerText.includes('Service registered; credential setup failed')`);
  assert.ok(await evaluate(`document.body.innerText.includes('Replacement upstream secret')`));
  assert.equal((await database.query('SELECT count(*)::int count FROM pact_services WHERE agent_id=$1 AND name=$2',
    [agentId,'Credential failure recovery'])).rows[0].count,1);
  await evaluate(`document.querySelector('[aria-label="Collapse sidebar"]').click()`);
  assert.equal(await evaluate(`localStorage.getItem('pact:sidebar-collapsed')`),'true');
  await click('Account');await waitFor(`document.body.innerText.includes(${JSON.stringify(owners[0].principalAddress)})`);
  await click('Sign out');await waitFor(`document.body.innerText.includes('Connect an agent. Keep control.')`);
  await click('Agents');await waitFor(`document.body.innerText.includes('Agent name')`);
  assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(name)})`),false);
  await click('Account');await waitFor(`document.body.innerText.includes(${JSON.stringify(owners[1].principalAddress)})`);
  assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(owners[0].principalAddress)})`),false);
  console.log('PASS: real Console/API/database/gateway/upstream; registration, key issue, allow/deny, redaction, live activity, approval inspection/polling/expiry, revoke, partial-service recovery, independent workspace loads, sidebar persistence, account isolation (Privy identity mocked locally)');
} finally {
  ws?.close();chrome.kill('SIGTERM');await vite.close();await api.close();await gateway.close();
  upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));await database.end();
  await new Promise(r=>chrome.exitCode!==null?r():chrome.once('exit',r));
  await rm(profile,{recursive:true,force:true});
}
