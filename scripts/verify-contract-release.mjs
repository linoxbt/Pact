import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createPublicClient,http} from 'viem';

const manifest=JSON.parse(readFileSync(process.argv[2] ?? 'deployments/monad-testnet.json','utf8'));
const rpc=createPublicClient({transport:http(process.env.PACT_RPC_URL)});
assert.equal(await rpc.getChainId(),manifest.chainId);
const contracts={CommitmentLedger:'ledger',AuthorityRegistry:'registry',PactAccount:'account',
  PactAccountFactory:'accountFactory',ObligationManager:'manager',SettlementVault:'vault',ReceiptRegistry:'receipts'};
const artifacts={};
for(const [name,field] of Object.entries(contracts)) {
  const artifact=JSON.parse(readFileSync(`packages/contracts/out/${name}.sol/${name}.json`,'utf8'));
  artifacts[name]=artifact;
  const actual=await rpc.getCode({address:manifest[field]});
  assert.ok(actual && actual!=='0x',`${name} code missing`);
  const expected=artifact.deployedBytecode.object;
  const mask=value=>{
    const bytes=Buffer.from(value.replace(/^0x/,''),'hex');
    for(const refs of Object.values(artifact.deployedBytecode.immutableReferences ?? {}))
      for(const {start,length} of refs) bytes.fill(0,start,start+length);
    return bytes.toString('hex');
  };
  assert.equal(mask(actual),mask(expected),`${name} runtime mismatch`);
  console.log(`${name}: compiled runtime verified (immutable slots checked below)`);
}
const links={CommitmentLedger:{registry:'registry',obligationManager:'manager'},
  AuthorityRegistry:{ledger:'ledger'},PactAccount:{principal:'principal',registry:'registry',ledger:'ledger'},
  PactAccountFactory:{registry:'registry',ledger:'ledger'},
  ObligationManager:{registry:'registry',ledger:'ledger',vault:'vault',receipts:'receipts'},
  SettlementVault:{manager:'manager'},ReceiptRegistry:{manager:'manager'}};
for(const [name,fields] of Object.entries(links)) for(const [getter,target] of Object.entries(fields)) {
  const abi=artifacts[name].abi;
  const actualGetter=abi.some(x=>x.type==='function' && x.name===getter)?getter:
    getter==='manager'?'obligationManager':getter;
  const value=await rpc.readContract({address:manifest[contracts[name]],abi,functionName:actualGetter});
  assert.equal(value.toLowerCase(),manifest[target].toLowerCase(),`${name}.${actualGetter}`);
}
const timeout=await rpc.readContract({address:manifest.manager,abi:artifacts.ObligationManager.abi,functionName:'ARBITRATION_TIMEOUT'});
assert.ok(timeout>0n);
console.log(JSON.stringify({chainId:manifest.chainId,manager:manifest.manager,arbitrationTimeoutSeconds:timeout.toString(),verified:true}));
