import{test}from'node:test';
import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{generatePrivateKey}from'viem/accounts';
test('Railway actor rejects unauthenticated calls, arbitrary egress and mainnet calldata',async()=>{
 const child=spawn(process.execPath,['scripts/live-agent/server.mjs'],{env:{PATH:process.env.PATH,PORT:'39871',PACT_TEST_AGENT_KEY:generatePrivateKey(),PACT_TEST_AGENT_SECRET:'local-test-only',PACT_TEST_AGENT_EXPIRES:new Date(Date.now()+60000).toISOString()},stdio:['ignore','pipe','pipe']});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),15000);
 try{
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',()=>reject(Error('Actor failed startup')));});
  const invoke=(path,body,authorized=true)=>fetch('http://127.0.0.1:39871'+path,{method:'POST',headers:{'content-type':'application/json',...(authorized?{authorization:'Bearer local-test-only'}:{})},body:JSON.stringify(body)});
  assert.equal((await invoke('/request',{},false)).status,401);
  assert.equal((await invoke('/request',{url:'http://169.254.169.254/latest',init:{method:'GET'}})).status,422);
  assert.equal((await invoke('/transaction',{to:'0x0000000000000000000000000000000000000001',data:'0x'})).status,422);
 }finally{clearTimeout(timeout);child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
});
