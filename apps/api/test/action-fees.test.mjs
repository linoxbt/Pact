import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createDatabase,migrate} from '@pact/operations';
import {createApi} from '../dist/server.js';
import {ACTION_FEE_WEI,loadActionFees} from '../dist/action-fees.js';
import {createPublicClient,createWalletClient,createTestClient,http,defineChain} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {spawn} from 'node:child_process';

const url=process.env.PACT_TEST_DATABASE_URL;
test('fee configuration uses native MON and fails closed on invalid treasury',()=>{
  assert.equal(ACTION_FEE_WEI,5000000000000000000n);
  assert.equal(loadActionFees({},10143),undefined);
  assert.throws(()=>loadActionFees({PACT_ACTION_FEES_ENABLED:'yes'},10143));
  assert.throws(()=>loadActionFees({PACT_ACTION_FEES_ENABLED:'yes',PACT_ACTION_FEE_TREASURY:'0x'+'11'.repeat(20)},1));
});
test('native MON payments: real EVM transfer, finality, exact intent, owner isolation, atomic creation and replay protection',{skip:!url,timeout:120000},async()=>{
  const port=18943,transport=http(`http://127.0.0.1:${port}`);
  const chain=defineChain({id:10143,name:'Local Monad fee test',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:[`http://127.0.0.1:${port}`]}}});
  const process=spawn('anvil',['--port',String(port),'--chain-id','10143','--silent'],{stdio:'ignore'});
  let spawnError;process.on('error',cause=>spawnError=cause);
  const rpc=createPublicClient({chain,transport}),evm=createTestClient({chain,transport,mode:'anvil'});
  const payer=privateKeyToAccount(generatePrivateKey()),treasury=privateKeyToAccount(generatePrivateKey()),other=privateKeyToAccount(generatePrivateKey());
  const wallet=createWalletClient({chain,transport,account:payer});
  const db=createDatabase(url);let app;
  const owner={id:randomUUID(),did:`did:privy:fees-${randomUUID()}`,principalAddress:payer.address,principalStatus:'verified'};
  const stranger={id:randomUUID(),did:`did:privy:fees-${randomUUID()}`,principalAddress:other.address,principalStatus:'verified'};
  try{
    let ready=false;for(let i=0;i<50;i++){if(spawnError)throw spawnError;try{await rpc.getChainId();ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
    assert.ok(ready,'Anvil must start; this test does not substitute a mocked RPC');
    await evm.setBalance({address:payer.address,value:1000n*10n**18n});await migrate(db);
    for(const o of [owner,stranger])await db.query('INSERT INTO pact_users(id,privy_did,principal_address,principal_status) VALUES($1,$2,$3,$4)',[o.id,o.did,o.principalAddress,o.principalStatus]);
    const ctx={database:db,rpc,pact:{},auth:{config:{chainId:10143,finalityBlocks:5}},operations:{},allowedOrigin:'http://localhost:5173',actionFees:{treasury:treasury.address,chainId:10143},ownerAuth:{authenticate:async h=>h==='Bearer other'?stranger:owner}};
    app=await createApi(ctx);
    const call=(path,body,extra={},method=body===undefined?'GET':'POST')=>app.inject({url:path,method,headers:{authorization:'Bearer owner',...extra},...(body===undefined?{}:{payload:body})});
    const prepare=async(path,body)=>{const r=await call('/v2/fees/prepare',{path,body});assert.equal(r.statusCode,200,r.body);return r.json();};
    const transfer=async(intent,override={})=>wallet.sendTransaction({to:intent.treasury,value:BigInt(intent.amount_wei),data:intent.tx_data,...override});
    const confirm=async(intent,hash)=>call(`/v2/fees/payments/${intent.id}/confirm`,{txHash:hash});
    const paid=async(path,body)=>{const p=await prepare(path,body),hash=await transfer(p);await evm.mine({blocks:6});const r=await confirm(p,hash);assert.equal(r.statusCode,200,r.body);return p;};
    const agentBody={name:'Paid native agent',environment:'development'};
    assert.equal((await call('/v2/agents',agentBody)).statusCode,402);
    assert.equal((await call('/v2/fees/prepare',{path:'/v2/agents',body:{...agentBody,name:''}})).statusCode,400);
    const p=await prepare('/v2/agents',agentBody);
    assert.equal((await prepare('/v2/agents',agentBody)).id,p.id,'prepare is retry-safe before payment');
    assert.equal((await call('/v2/agents',agentBody,{'x-pact-payment':p.id})).statusCode,402);
    assert.equal((await call(`/v2/fees/payments/${p.id}/confirm`,{txHash:'0x'+'11'.repeat(32)},{authorization:'Bearer other'})).statusCode,404);
    const wrongValue=await transfer(p,{value:1n});await evm.mine({blocks:6});assert.equal((await confirm(p,wrongValue)).json().error,'PAYMENT_TRANSFER_MISMATCH');
    const wrongTo=await transfer(p,{to:other.address});await evm.mine({blocks:6});assert.equal((await confirm(p,wrongTo)).statusCode,400);
    const wrongData=await transfer(p,{data:'0x'});await evm.mine({blocks:6});assert.equal((await confirm(p,wrongData)).statusCode,400);
    const tx=await transfer(p);assert.equal((await confirm(p,tx)).json().error,'PAYMENT_NOT_FINAL');
    await evm.mine({blocks:6});assert.equal((await confirm(p,tx)).statusCode,200);
    assert.equal((await confirm(p,tx)).statusCode,200,'confirmation idempotent');
    assert.equal((await call('/v2/agents',{...agentBody,name:'Changed'}, {'x-pact-payment':p.id})).statusCode,402);
    assert.equal((await call('/v2/agents',agentBody, {'x-pact-payment':p.id,authorization:'Bearer other'})).statusCode,402);
    const concurrent=await Promise.all([call('/v2/agents',agentBody,{'x-pact-payment':p.id}),call('/v2/agents',agentBody,{'x-pact-payment':p.id})]);
    assert.deepEqual(concurrent.map(x=>x.statusCode).sort(),[200,409]);
    const agent=concurrent.find(x=>x.statusCode===200).json();
    const p2=await prepare('/v2/agents',{name:'Other agent',environment:'staging'});
    assert.equal((await confirm(p2,tx)).statusCode,400,'transaction data binds the exact payment ID');
    // Failure after consuming the payment inside a DB transaction must roll back consumption.
    const rollbackBody={name:'Retry after database rollback',environment:'development'},rollback=await paid('/v2/agents',rollbackBody);
    await db.query(`CREATE OR REPLACE FUNCTION pact_test_fee_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name='Retry after database rollback' THEN RAISE EXCEPTION 'TEST_FAILURE'; END IF; RETURN NEW; END $$`);
    await db.query('CREATE TRIGGER pact_test_fee_failure BEFORE INSERT ON pact_connected_agents FOR EACH ROW EXECUTE FUNCTION pact_test_fee_failure()');
    try{assert.equal((await call('/v2/agents',rollbackBody,{'x-pact-payment':rollback.id})).statusCode,500);assert.equal((await db.query('SELECT consumed_at FROM pact_action_payments WHERE id=$1',[rollback.id])).rows[0].consumed_at,null);}
    finally{await db.query('DROP TRIGGER pact_test_fee_failure ON pact_connected_agents');await db.query('DROP FUNCTION pact_test_fee_failure()');}
    assert.equal((await call('/v2/agents',rollbackBody,{'x-pact-payment':rollback.id})).statusCode,200);
    const inputs=[['/v2/grants',{agentId:agent.id,name:'Paid grant',resourceOrigins:['https://example.com'],destinationOrigins:['https://example.com'],actions:['GET'],currency:'USD',perActionLimitMinor:'0',aggregateLimitMinor:'0',approvalThresholdMinor:'0',startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}],['/v2/policies',{agentId:agent.id,name:'Paid policy',rules:[{id:'read',name:'Read',effect:'allow',methods:['GET'],paths:['/health'],destinations:['https://example.com'],maxRequests:60,periodSeconds:60}]}],[`/v2/agents/${agent.id}/keys`,{name:'Paid key',scopes:['proxy.read'],expiresAt:new Date(Date.now()+86400000).toISOString()}]];
    for(const [path,body] of inputs){assert.equal((await call(path,body)).statusCode,402);const fee=await paid(path,body);const r=await call(path,body,{'x-pact-payment':fee.id});assert.equal(r.statusCode,200,r.body);
      if(path.endsWith('/keys')){assert.ok(r.json().secret);assert.equal((await call(`${path}/${r.json().id}/rotate`,{})).statusCode,200,'rotation remains free');}
    }
    assert.equal((await call(`/v2/agents/${agent.id}`,{description:'Editing is free'}, {},'PATCH')).statusCode,200);
    const history=(await call('/v2/fees/payments')).json().payments;
    assert.equal(history.filter(x=>x.consumed_at).length,5);assert.ok(history.every(x=>x.owner_id===owner.id));
    assert.deepEqual((await call('/v2/fees/payments',undefined,{authorization:'Bearer other'})).json().payments,[]);
    assert.ok(await rpc.getBalance({address:treasury.address})>=25n*10n**18n,'Treasury received actual native currency on local EVM');
  }finally{await app?.close();await db.end();process.kill('SIGTERM');}
});
