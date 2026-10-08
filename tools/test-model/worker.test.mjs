import{test}from'node:test';
import assert from'node:assert/strict';
import worker from'./worker.mjs';
const secret='test-only-secret-not-an-upstream-key';
const env={TEST_MODEL_SECRET:secret,TEST_MODEL_EXPIRES:new Date(Date.now()+60000).toISOString(),AI:{run:()=>{throw Error('must not reach inference');}}};
const request=(body,authorization=`Bearer ${secret}`)=>new Request('https://model.example/plan',{method:'POST',headers:{authorization,'content-type':'application/json'},body});
test('model helper fails closed for missing authentication, invalid expiry and oversized input',async()=>{
 assert.equal((await worker.fetch(request('{}','Bearer wrong'),env)).status,401);
 assert.equal((await worker.fetch(request('{}'),{...env,TEST_MODEL_EXPIRES:'invalid'})).status,503);
 assert.equal((await worker.fetch(request('x'.repeat(9000)),env)).status,413);
 assert.equal((await worker.fetch(request('not JSON'),env)).status,400);
 assert.equal((await worker.fetch(request(JSON.stringify({task:'health',observations:'invalid'})),env)).status,400);
});
