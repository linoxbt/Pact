import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createDatabase, migrate } from '@pact/operations';
import { DeploymentSecretCipher } from '@pact/security';
import { verifyGatewayEnforcement } from '@pact/sdk-ts';
import { createApi } from '../../api/dist/server.js';
import { createGateway } from '../dist/server.js';

test('verification flow executes real HTTP, records denies, and cleans up credentials',
  {skip:!process.env.PACT_TEST_DATABASE_URL}, async()=>{
    const database=createDatabase(process.env.PACT_TEST_DATABASE_URL);
    await migrate(database);
    const owner={id:randomUUID(),did:`did:privy:${randomUUID()}`,
      principalAddress:`0x${randomBytes(20).toString('hex')}`,principalStatus:'account_assigned'};
    await database.query(`INSERT INTO pact_users(id,privy_did,principal_address,principal_status)
      VALUES($1,$2,$3,'account_assigned')`,[owner.id,owner.did,owner.principalAddress]);
    const cipher=new DeploymentSecretCipher('ab'.repeat(32));
    let identity=owner;
    const api=await createApi({database,credentials:cipher,ownerAuth:{authenticate:async()=>identity},
      rpc:{},pact:{},auth:{},operations:{},allowedOrigin:'http://localhost'});
    const gateway=await createGateway({database,auth:{},pact:{},secrets:{},
      proxy:{database,cipher,allowLocalUpstream:true}});
    const previous=process.env.PACT_ALLOW_LOCAL_UPSTREAM;
    process.env.PACT_ALLOW_LOCAL_UPSTREAM='yes';
    try {
      await api.listen({host:'127.0.0.1',port:0});
      await gateway.listen({host:'127.0.0.1',port:0});
      const apiOrigin=`http://127.0.0.1:${api.server.address().port}`;
      const gatewayOrigin=`http://127.0.0.1:${gateway.server.address().port}`;
      const control=async(path,body,method)=>{
        const response=await fetch(apiOrigin+path,{method:method??(body===undefined?'GET':'POST'),
          headers:{Authorization:'Bearer test-owner',...(body===undefined?{}:{'Content-Type':'application/json'})},
          ...(body===undefined?{}:{body:JSON.stringify(body)})});
        const data=await response.json();
        assert.ok(response.ok,JSON.stringify({path,status:response.status,data}));return data;
      };
      const report=await verifyGatewayEnforcement({apiOrigin,gatewayOrigin,control});
      assert.equal(report.passed,true,JSON.stringify(report));
      assert.ok(report.requestIds.length>=10);
      const dashboard=await control('/v2/dashboard');
      assert.equal(dashboard.stats.requests,report.requestIds.length);
      assert.equal(dashboard.stats.allowed,3);
      assert.equal(dashboard.stats.pending,1);
      assert.equal(dashboard.agentStats[0].agent_id,report.agentId);
      assert.equal(dashboard.keyStats[0].active,0);
      assert.equal(dashboard.hourly.reduce((sum,row)=>sum+row.allowed+row.denied+row.pending,0),dashboard.stats.requests);
      const keyId=(await database.query('SELECT id FROM pact_integration_keys WHERE owner_id=$1 LIMIT 1',[owner.id])).rows[0].id;
      const key=await control(`/v2/keys/${keyId}`);
      assert.equal(key.agent_id,report.agentId);assert.equal(key.token_hash,undefined);
      identity={...owner,id:randomUUID()};
      const other=await control('/v2/dashboard');
      assert.equal(other.stats.requests,0);assert.deepEqual(other.recent,[]);
      assert.deepEqual(other.agentStats,[]);assert.deepEqual(other.keyStats,[]);
      assert.equal((await fetch(apiOrigin+`/v2/keys/${keyId}`,{headers:{Authorization:'Bearer other-owner'}})).status,404);
      identity=owner;
      const active=await database.query(`SELECT count(*)::int AS count FROM pact_integration_keys
        WHERE owner_id=$1 AND revoked_at IS NULL`,[owner.id]);
      assert.equal(active.rows[0].count,0);
      assert.equal((await database.query('SELECT * FROM pact_upstream_secrets WHERE owner_id=$1',[owner.id])).rowCount,0);
      const replay=await fetch(apiOrigin+`/v2/verification/upstream/${(await database.query('SELECT id FROM pact_verification_probes WHERE owner_id=$1',[owner.id])).rows[0].id}/read`);
      assert.equal(replay.status,404);
    } finally {
      process.env.PACT_ALLOW_LOCAL_UPSTREAM=previous;
      await gateway.close();await api.close();
      await database.query('DELETE FROM pact_verification_probes WHERE owner_id=$1',[owner.id]);
      await database.end();
    }
  });
