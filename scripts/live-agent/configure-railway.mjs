import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {spawnSync} from 'node:child_process';
const file=new URL('../../.secrets/live-agent/railway.json',import.meta.url);
const config=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{
 PACT_ENABLE_TEST_AGENT:'yes',PORT:'3000',PACT_TEST_AGENT_SECRET:randomBytes(32).toString('base64url'),
 PACT_TEST_AGENT_KEY:generatePrivateKey(),PACT_TEST_AGENT_EXPIRES:new Date(Date.now()+2*86400000).toISOString()};
writeFileSync(file,JSON.stringify(config),{mode:0o600});
const modelFile=new URL('../../.secrets/live-agent/model-secrets.json',import.meta.url);
if(!existsSync(modelFile))writeFileSync(modelFile,JSON.stringify({
 TEST_MODEL_SECRET:randomBytes(32).toString('base64url'),
 TEST_MODEL_EXPIRES:config.PACT_TEST_AGENT_EXPIRES,
}),{mode:0o600});
for(const [key,value] of Object.entries(config)) {
 const result=spawnSync('railway',['variable','set',key,'--stdin','--skip-deploys','--service','a358e675-4c51-4c7e-9947-f9ab41ae7064'],
 {input:value,encoding:'utf8',env:{...process.env,RAILWAY_CALLER:'skill:use-railway@1.6.1',RAILWAY_AGENT_SESSION:'pact-real-agent-20261008'}});
 if(result.status!==0)throw Error(`Railway variable update failed: ${key}`);
 console.log(`Configured ${key}`);
}
console.log('Agent address:',privateKeyToAccount(config.PACT_TEST_AGENT_KEY).address);
