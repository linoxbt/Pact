import{execFileSync}from'node:child_process';
import{load,save}from'./client.mjs';
// Requires temporary registered SSH access; database stays on Railway's private network.
const hashes=[...load('chain-report.json').transactions,...load('obligation-report.json').transactions].map(t=>t.hash);
const code=`
import {createDatabase,loadCoreConfig} from './packages/operations/dist/index.js';
const db=createDatabase(loadCoreConfig().databaseUrl);
const client=await db.connect();
try {
 await client.query('BEGIN READ ONLY');
 const events=await client.query('SELECT tx_hash,event_name,block_number FROM pact_chain_events WHERE chain_id=10143 AND tx_hash=ANY($1::text[]) ORDER BY block_number',[${JSON.stringify(hashes)}]);
 const accounts=await client.query('SELECT address,principal FROM pact_indexed_accounts WHERE chain_id=10143 AND address=$1',[${JSON.stringify(load('chain-report.json').pactAccount.toLowerCase())}]);
 await client.query('COMMIT');
 console.log(JSON.stringify({indexedEvents:events.rows,accounts:accounts.rows}));
}finally{client.release();await db.end();}`;
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const raw=execFileSync('railway',['ssh','--identity-file','/root/.ssh/pact-live-check','--service','be3ea156-1b20-4328-a7c8-dca0e78f7f6f','--',`node --input-type=module -e ${quote(code)}`],{encoding:'utf8',env:{...process.env,RAILWAY_CALLER:'skill:use-railway@1.6.1',RAILWAY_AGENT_SESSION:'pact-real-agent-20261008'}});
const report=JSON.parse(raw.trim());report.checkedAt=new Date().toISOString();
report.passed=report.indexedEvents.some(e=>e.event_name==='ReceiptFinalized')&&report.accounts.length===1;
save('operations-report.json',report);console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
