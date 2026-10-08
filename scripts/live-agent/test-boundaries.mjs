import{control,load,save,remote,api,gateway}from'./client.mjs';
const r=load('resources.json'),report={checks:[]};
const check=(name,value,evidence)=>{if(!value)throw Error(name);report.checks.push({name,status:'passed',evidence});save('boundaries-report.json',report);console.log('PASS',name);};
const expiry=new Date(Date.now()+1800000).toISOString();
const grant=await control('/v2/grants',{agentId:r.agent.id,name:'Precise economic boundary tests',resourceOrigins:[api],destinationOrigins:[api],actions:['GET','POST','PUT','PATCH','DELETE'],allowedRecipients:['test-payee'],currency:'USD',perActionLimitMinor:'10',aggregateLimitMinor:'20',approvalThresholdMinor:'10',startsAt:new Date(Date.now()-60000).toISOString(),expiresAt:expiry});
const path=r.probe.path+'/economic-'+Date.now();
const rule={id:'budget',name:'Fifteen minor units per hour',effect:'allow',methods:['POST'],paths:[path],destinations:[api],maxSpendMinor:'15',currency:'USD',maxRequests:100,periodSeconds:3600};
const policy=await control('/v2/policies',{agentId:r.agent.id,name:'Exact economic boundaries',rules:[rule]});
const endpoint=await control('/v2/endpoints',{serviceId:r.service.id,grantId:grant.id,policyId:policy.id,method:'POST',pathPattern:path,currency:'USD',economicConstraints:{amountPath:'amount',currencyPath:'currency',recipientPath:'recipient'},responseFields:['ok','method']});
async function invoke(amount,currency='USD',recipient='test-payee',idempotencyKey=crypto.randomUUID()){
 const response=await remote('/request',{url:`${gateway}/v2/proxy/${r.agent.id}/${r.service.id}${path}`,init:{method:'POST',headers:{authorization:`Bearer ${r.key.secret}`,'content-type':'application/json','x-pact-idempotency-key':idempotencyKey},body:{amount,currency,recipient}}});
 return {status:response.status,...JSON.parse(response.body),requestId:response.headers['x-pact-request-id']??JSON.parse(response.body).requestId};
}
try{
 const first=await invoke('6');check('Dynamic request amount within exact minor-unit budget',first.status===200,first);
 for(const [name,args]of [['Per-action spending limit',['11']],['Currency bound',['1','EUR']],['Recipient bound',['1','USD','intruder']],['Reject floating-point amounts',[1.5]],['Policy aggregate spending bound',['10']]]){const result=await invoke(...args);check(name,result.status===403,result);}
 const idempotency=crypto.randomUUID(),before=await control(`/v2/verification/probes/${r.probe.id}`);
 const second=await invoke('4','USD','test-payee',idempotency),retry=await invoke('4','USD','test-payee',idempotency);
 const after=await control(`/v2/verification/probes/${r.probe.id}`);
 check('Write retry does not duplicate upstream execution',second.status===200&&retry.status===409&&after.requests===before.requests+1,{second,retry,upstreamDelta:after.requests-before.requests});
 await control(`/v2/policies/${policy.id}`,{rules:[{...rule,maxSpendMinor:'100'}]},'PATCH');
 const exact=await invoke('10');check('Exact grant aggregate boundary accepted',exact.status===200,exact);
 const beyond=await invoke('1');check('Grant aggregate budget rejects next request',beyond.status===403,beyond);
 const widened=await fetch(api+`/v2/grants/${grant.id}`,{method:'PATCH',headers:{authorization:`Bearer ${load('privy-session.json').token}`,'content-type':'application/json'},body:JSON.stringify({aggregateLimitMinor:'100'})});
 check('Grant editing cannot expand existing authority',widened.status===409||widened.status===400,{status:widened.status});
 const old=await control(`/v2/grants/${r.grant.id}`),migration=await control(`/v2/grants/${r.grant.id}/migrate`,{});
 const oldAfter=await control(`/v2/grants/${r.grant.id}`);
 check('Explicit principal migration revokes original and preserves its historic owner',oldAfter.status==='revoked'&&oldAfter.principal_address===old.principal_address,{oldGrant:old.id,migration});
 // Migration is intentionally last: follow the reissued authority for any later demo calls.
 const grants=(await control('/v2/grants')).grants;
 const replacement=grants.find(g=>g.id!==old.id&&g.agent_id===r.agent.id&&g.name===old.name&&g.status==='active');
 if(replacement){r.grant=replacement;save('resources.json',r);}
}finally{
 await control(`/v2/grants/${grant.id}`,{status:'revoked'},'PATCH');
 await control(`/v2/endpoints/${endpoint.id}`,{status:'disabled'},'PATCH');
 await control(`/v2/policies/${policy.id}`,{status:'disabled'},'PATCH');
}
