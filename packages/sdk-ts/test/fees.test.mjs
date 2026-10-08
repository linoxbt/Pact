import test from 'node:test';
import assert from 'node:assert/strict';
import {PactControlClient} from '../dist/control.js';
test('owner client attaches payment only to explicitly paid actions',async()=>{
  const calls=[],id='11111111-1111-4111-8111-111111111111';
  const client=new PactControlClient('https://pact.example','owner',async(url,options)=>{calls.push({url:String(url),...options});return new Response('{}');});
  await client.preparePayment('/v2/agents',{name:'Test',environment:'development'});
  await client.confirmPayment(id,'0x'+'ab'.repeat(32));
  await client.createAgent({name:'Test',environment:'development'},id);
  await client.createGrant({},id);await client.createPolicy({},id);await client.issueKey(id,{name:'Key',scopes:['proxy.read'],expiresAt:'2030-01-01T00:00:00Z'},id);
  assert.ok(calls.slice(0,2).every(c=>!c.headers['x-pact-payment']));
  assert.ok(calls.slice(2).every(c=>c.headers['x-pact-payment']===id));
  await assert.rejects(()=>client.createAgent({name:'Test',environment:'development'},'bad\r\nheader'));
});
