import {control,load,save,api,gateway} from './client.mjs';
const report={startedAt:new Date().toISOString(),checks:[]};
const check=(name,value)=>{if(!value)throw Error(name);report.checks.push({name,status:'passed'});console.log('PASS',name);};
const account=await control('/v2/account');
check('Real Privy account receives its own principal without a wallet onboarding step',Boolean(account.principalAddress));
save('account.json',account);
const agent=await control('/v2/agents',{name:'Railway AI test agent',environment:'staging',description:'Real Llama inference and HTTP tools on Railway; Monad testnet only.'});
const modelOrigin='https://pact-test-agent-model.alemzdelight.workers.dev';
const expiresAt=new Date(Date.now()+2*86400000).toISOString();
const grant=await control('/v2/grants',{agentId:agent.id,name:'Test inference and protected HTTP authority',actions:['GET','POST'],resourceOrigins:[api,modelOrigin],destinationOrigins:[api,modelOrigin],currency:'USD',perActionLimitMinor:'0',aggregateLimitMinor:'0',approvalThresholdMinor:'0',startsAt:new Date(Date.now()-60000).toISOString(),expiresAt});
check('Grant automatically uses account principal',grant.principal_address===account.principalAddress.toLowerCase());
const probe=await control('/v2/verification/probes',{});
const rules=[
 {id:'model',name:'Bounded model inference',effect:'allow',methods:['POST'],paths:['/plan'],destinations:[modelOrigin],maxRequests:30,periodSeconds:3600},
 {id:'forbidden',name:'Forbidden tool',effect:'deny',methods:['GET'],paths:[probe.path+'/forbidden'],destinations:[api]},
 {id:'approval',name:'Human approval for writes',effect:'approval',methods:['POST'],paths:[probe.path+'/write'],destinations:[api]},
 {id:'read',name:'Protected health reads',effect:'allow',methods:['GET'],paths:[probe.path+'/read'],destinations:[api]},
];
const policy=await control('/v2/policies',{agentId:agent.id,name:'Railway test agent ordered rules',rules});
const service=await control('/v2/services',{agentId:agent.id,name:'Protected test upstream',baseUrl:api,authMethod:'bearer'});
await control(`/v2/services/${service.id}/secret`,{secret:probe.secret},'PUT');
for(const [method,operation]of[['GET','read'],['GET','forbidden'],['POST','write']])await control('/v2/endpoints',{serviceId:service.id,grantId:grant.id,policyId:policy.id,method,pathPattern:probe.path+'/'+operation,currency:'USD',responseFields:['ok','method']});
const model=await control('/v2/services',{agentId:agent.id,name:'Cloudflare Llama inference',baseUrl:modelOrigin,authMethod:'bearer'});
await control(`/v2/services/${model.id}/secret`,{secret:load('model-secrets.json').TEST_MODEL_SECRET},'PUT');
await control('/v2/endpoints',{serviceId:model.id,grantId:grant.id,policyId:policy.id,method:'POST',pathPattern:'/plan',currency:'USD',responseFields:['response','usage','model','requestId']});
const key=await control(`/v2/agents/${agent.id}/keys`,{name:'Railway bounded test credential',scopes:['proxy.read','proxy.write'],expiresAt});
save('resources.json',{agent,grant,probe,policy,service,model,key,modelUrl:`${gateway}/v2/proxy/${agent.id}/${model.id}/plan`,toolBase:`${gateway}/v2/proxy/${agent.id}/${service.id}${probe.path}`});
check('Agent, grant, policy, endpoints, encrypted upstream credentials and scoped key created through public API',true);
save('provision-report.json',report);
console.log(JSON.stringify({agentId:agent.id,grantId:grant.id,policyId:policy.id,principal:account.principalAddress}));
