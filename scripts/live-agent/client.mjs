import {readFileSync,writeFileSync} from 'node:fs';
export const api='https://pact-api-production-2ab9.up.railway.app';
export const gateway='https://pact-gateway-production-ec3f.up.railway.app';
export const actor='https://pact-worker-production.up.railway.app';
export const secretFile=name=>new URL(`../../.secrets/live-agent/${name}`,import.meta.url);
export const load=name=>JSON.parse(readFileSync(secretFile(name),'utf8'));
export const save=(name,data)=>writeFileSync(secretFile(name),JSON.stringify(data,null,2),{mode:0o600});
export async function control(path,body,method=body===undefined?'GET':'POST') {
 const token=load('privy-session.json').token;
 const r=await fetch(api+path,{method,headers:{authorization:`Bearer ${token}`,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 const data=await r.json();if(!r.ok)throw Error(`${method} ${path} ${r.status} ${JSON.stringify(data)}`);return data;
}
export async function remote(path,body) {
 const secret=load('railway.json').PACT_TEST_AGENT_SECRET;
 const r=await fetch(actor+path,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
 const result=await r.json();if(!r.ok)throw Error(`Agent ${path} ${r.status} ${JSON.stringify(result)}`);return result;
}
export async function agentFetch(url,init) {
 const result=await remote('/request',{url,init});
 return new Response(result.body,{status:result.status,headers:Object.fromEntries(Object.entries(result.headers).filter(([,v])=>v!==null))});
}
