import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const project='0fd7f850-661f-41d9-b924-e3ede54c3097';
const environment='41195367-81d8-4ed6-9cbf-9567b2c5e48f';
const manifest=JSON.parse(readFileSync('deployments/monad-testnet.json','utf8'));
if(manifest.chainId!==10143)throw Error('This script configures testnet only');
const cli=args=>execFileSync('railway',args,{encoding:'utf8',env:{...process.env,
  RAILWAY_CALLER:'skill:use-railway@1.6.1',RAILWAY_AGENT_SESSION:'pact-remediation-20261007'}});
const services={api:'be3ea156-1b20-4328-a7c8-dca0e78f7f6f',gateway:'4352c10c-eb72-4ccb-8ff2-e326880ce114',
  worker:'a358e675-4c51-4c7e-9947-f9ab41ae7064',indexer:'9e0a4d52-a2f2-4bcf-a601-162c7b80ec05'};
const common={PACT_CHAIN_ID:'10143',PACT_ENVIRONMENT:'staging',PACT_REGISTRY:manifest.registry,
  PACT_LEDGER:manifest.ledger,PACT_ACCOUNT:manifest.account,PACT_MANAGER:manifest.manager,
  PACT_VAULT:manifest.vault,PACT_RECEIPTS:manifest.receipts,PACT_ACCOUNT_FACTORY:manifest.accountFactory};
for(const [name,id] of Object.entries(services)) {
  const scope=['--project',project,'--environment',environment,'--service',id];
  const values={...common,...(name==='indexer'?{PACT_INDEXER_START_BLOCK:manifest.startBlock}:{}),
    ...(name==='worker'?{PACT_ENABLE_RUNNER:'yes',PACT_VAULT_MASTER_KEY:'${{pact-api.PACT_VAULT_MASTER_KEY}}'}:{})};
  cli(['variable','set',...scope,'--skip-deploys',...Object.entries(values).map(([k,v])=>`${k}=${v}`)]);
  const actual=JSON.parse(cli(['variable','list',...scope,'--json']));
  for(const [key,value] of Object.entries(values)) {
    if(key==='PACT_VAULT_MASTER_KEY') {if(!actual[key])throw Error('Worker vault reference missing');}
    else if(actual[key]!==value)throw Error(`${name}: read-back mismatch for ${key}`);
  }
  console.log(`${name}: testnet contract settings verified; deployment still required`);
}
