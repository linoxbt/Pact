import {control,remote,load,save,agentFetch,api,gateway} from './client.mjs';
import {verifyGatewayEnforcement} from '../../packages/sdk-ts/dist/verification.js';
const resources=load('resources.json');
const {agent,policy,service,key,probe}=resources;
const report={startedAt:new Date().toISOString(),railwayActor:null,agentId:agent.id,checks:[],modelRuns:[]};
const assert=(ok,message)=>{if(!ok)throw Error(message);};
async function test(name,fn){try{const evidence=await fn();report.checks.push({name,status:'passed',evidence});console.log('PASS',name);}catch(e){report.checks.push({name,status:'failed',error:e.message});console.log('FAIL',name,e.message);}save('http-report.json',report);}
const invoke=async(method,path='/read',credential=key.secret,body,approvalId)=>{
 const result=await remote('/request',{url:resources.toolBase+path,init:{method,headers:{authorization:`Bearer ${credential}`,...(method==='GET'?{}:{'x-pact-idempotency-key':crypto.randomUUID(),'content-type':'application/json'}),...(approvalId?{'x-pact-approval-id':approvalId}:{})},...(body===undefined?{}:{body})}});
 return {...result,data:JSON.parse(result.body)};
};
await test('Railway deployment health and distinct operational identity',async()=>{
 const r=await fetch('https://pact-worker-production.up.railway.app/health');const health=await r.json();assert(health.chainId===10143&&health.deployment,'wrong deployment');report.railwayActor=health;return health;});
for(const task of ['Check the upstream health.','Test a forbidden delete of the health endpoint.','Request an update of the test upstream.'])await test(`Real model tool use: ${task}`,async()=>{
 const result=await remote('/task',{task,modelUrl:resources.modelUrl,toolBase:resources.toolBase,key:key.secret});
 assert(result.turns.length===2&&result.turns[0].usage,'Missing real inference usage');
 const expected=task.includes('delete')?403:task.includes('update')?202:200;
 assert(result.observations[0]?.status===expected,'Unexpected tool outcome');report.modelRuns.push(result);return result;});
await test('Complete SDK verification with all gateway calls executed by Railway actor',async()=>{
 const result=await verifyGatewayEnforcement({apiOrigin:api,gatewayOrigin:gateway,control,fetcher:agentFetch,onStep:s=>console.log('  ',s)});
 save('sdk-verification.json',result);assert(result.passed,result.error??JSON.stringify(result.cleanupFailures));return result;});
const endpoints=(await control('/v2/endpoints')).endpoints;
const readEndpoint=endpoints.find(e=>e.service_id===service.id&&e.path_pattern===probe.path+'/read');
await test('Read secret metadata and key details never return stored secrets',async()=>{
 const detail=await control(`/v2/keys/${key.id}`),s=await control(`/v2/services/${service.id}`);
 assert(!JSON.stringify([detail,s]).includes(key.secret)&&!JSON.stringify([detail,s]).includes(probe.secret),'secret leak');
 assert(detail.last_used_at,'last-used missing');return {keyId:key.id,lastUsed:detail.last_used_at};});
for(const [label,route]of [['Endpoint',`/v2/endpoints/${readEndpoint.id}`],['Service',`/v2/services/${service.id}`],['Agent',`/v2/agents/${agent.id}`]])await test(`${label} disable prevents upstream execution`,async()=>{
 await control(route,{status:'disabled'},'PATCH');try{const result=await invoke('GET');assert(result.status===403||result.status===401,'disabled resource allowed');return {status:result.status,requestId:result.headers['x-pact-request-id']};}finally{await control(route,{status:'active'},'PATCH');}});
async function policyBoundary(name,extra,requests=1){await test(name,async()=>{
 const p=await control('/v2/policies',{agentId:agent.id,name,rules:[{id:'boundary',name,effect:'allow',methods:['GET'],paths:[probe.path+'/read'],destinations:[api],...extra}]});
 await control(`/v2/endpoints/${readEndpoint.id}`,{policyId:p.id},'PATCH');
 try{const results=[];for(let i=0;i<requests;i++)results.push(await invoke('GET'));assert(results.at(-1).status===403,'boundary allowed');if(requests>1)assert(results[0].status===200,'first allowed call failed');return results.map(r=>({status:r.status,reason:r.data.reason,requestId:r.headers['x-pact-request-id']}));}
 finally{await control(`/v2/endpoints/${readEndpoint.id}`,{policyId:policy.id},'PATCH');await control(`/v2/policies/${p.id}`,{status:'disabled'},'PATCH');}
});}
await policyBoundary('Rate limit boundary',{maxRequests:1,periodSeconds:3600},2);
const hour=new Date().getUTCHours();await policyBoundary('UTC time window boundary',{windowUtc:hour===0?{startHour:1,endHour:2}:{startHour:0,endHour:1}});
await test('OpenAPI preview and import create real endpoint records',async()=>{
 const spec={openapi:'3.0.3',info:{title:'Live import fixture',version:'1'},servers:[{url:api}],paths:{[probe.path+'/imported-'+Date.now()]:{get:{summary:'Imported read',responses:{200:{description:'OK'}}}}}};
 const preview=await control('/v2/openapi/preview',{spec});assert(preview.operations.length===1,'preview failed');
 const imported=await control(`/v2/services/${service.id}/import`,{spec,grantId:resources.grant.id,policyId:policy.id,currency:'USD'});
 assert(imported.imported.length===1,'import failed');return {endpointId:imported.imported[0].id};});
await test('Key expiry enforced',async()=>{
 const expiring=await control(`/v2/agents/${agent.id}/keys`,{name:'Expiry boundary',scopes:['proxy.read'],expiresAt:new Date(Date.now()+2500).toISOString()});
 await new Promise(r=>setTimeout(r,3000));const r=await invoke('GET','/read',expiring.secret);assert(r.status===401,'expired key allowed');return {status:r.status};});
await test('Owner-scoped dashboard, activity filters, decision detail and audit trail',async()=>{
 const dashboard=await control('/v2/dashboard');const activity=await control(`/v2/activity?agentId=${agent.id}&decision=denied`);
 assert(activity.events.length&&activity.events.every(e=>e.agent_id===agent.id&&e.decision==='denied'),'activity filter incorrect');
 const detail=await control(`/v2/activity/${activity.events[0].id}`);const audit=await control('/v2/audit');
 assert(!JSON.stringify([activity,detail,audit,dashboard]).includes(key.secret),'key leaked');
 return {eventId:activity.events[0].id,detail,auditEvents:audit.events?.length??audit};});
save('http-report.json',report);
console.log(JSON.stringify({passed:report.checks.filter(c=>c.status==='passed').length,failed:report.checks.filter(c=>c.status==='failed').length}));
if(report.checks.some(c=>c.status==='failed'))process.exitCode=1;
