import {readFileSync} from 'node:fs';
import {createPublicClient,createWalletClient,http,defineChain,encodeFunctionData,decodeEventLog,keccak256,toHex,parseEther} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import * as abi from '../../packages/abis/dist/index.js';
import {control,remote,load,save,secretFile} from './client.mjs';
const chain=defineChain({id:10143,name:'Monad Testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:['https://testnet-rpc.monad.xyz']}}});
const rpc=createPublicClient({chain,transport:http()});
if(await rpc.getChainId()!==10143)throw Error('Not testnet');
const owner=privateKeyToAccount(readFileSync(secretFile('owner.key'),'utf8').trim());
const deployer=privateKeyToAccount(readFileSync(new URL('../../.secrets/monad-testnet-deployer.key',import.meta.url),'utf8').trim());
const agent=privateKeyToAccount(load('railway.json').PACT_TEST_AGENT_KEY);
const wallet=account=>createWalletClient({chain,account,transport:http()});
const manifest=JSON.parse(readFileSync(new URL('../../deployments/monad-testnet.json',import.meta.url),'utf8'));
const report={chainId:10143,owner:owner.address,agent:agent.address,startedAt:new Date().toISOString(),checks:[],transactions:[]};
const persist=()=>save('chain-report.json',report);
const pass=(name,evidence)=>{report.checks.push({name,status:'passed',evidence});persist();console.log('PASS',name);};
async function tx(account,args,label){
 const gas=await rpc.estimateGas({account,...args});const gasPrice=await rpc.getGasPrice();
 if(gas*gasPrice>parseEther('0.2'))throw Error('Per-transaction test budget exceeded');
 const hash=await wallet(account).sendTransaction({...args,gas:args.value?100000n:gas+gas/5n,gasPrice});
 const receipt=await rpc.waitForTransactionReceipt({hash,timeout:60000});
 report.transactions.push({label,hash,status:receipt.status,block:receipt.blockNumber.toString(),gasCostWei:(receipt.gasUsed*receipt.effectiveGasPrice).toString()});persist();
 if(receipt.status!=='success')throw Error(`Reverted: ${label} ${hash}`);
 return receipt;
}
async function contract(account,address,contractAbi,functionName,args,label){return tx(account,{to:address,data:encodeFunctionData({abi:contractAbi,functionName,args})},label??functionName);}
function event(receipt,contractAbi,name){for(const log of receipt.logs){try{const d=decodeEventLog({abi:contractAbi,data:log.data,topics:log.topics});if(d.eventName===name)return d.args;}catch{}}throw Error(`Missing ${name}`);}
async function agentCall(address,contractAbi,functionName,args,label){const r=await remote('/transaction',{to:address,data:encodeFunctionData({abi:contractAbi,functionName,args})});if(r.status!=='success')throw Error(label);report.transactions.push({label,hash:r.hash,block:r.blockNumber,actor:r.actor});persist();return rpc.getTransactionReceipt({hash:r.hash});}
async function rejects(name,address,contractAbi,functionName,args,actor=agent){
 let rejected=false;try{await rpc.simulateContract({account:actor,address,abi:contractAbi,functionName,args});}catch(e){if(e.name==='ContractFunctionExecutionError'&&e.cause?.name==='ContractFunctionRevertedError')rejected=true;else throw e;}
 if(!rejected)throw Error(`${name} unexpectedly allowed`);pass(name,{verifiedBy:'eth_call against deployed testnet contracts; no reverting transaction broadcast'});
}
const before=await control('/v2/account');
if(before.verificationStatus!=='verified'){
 const challenge=await control('/v2/account/address/challenge',{address:owner.address});
 const signature=await owner.signMessage({message:challenge.message});
 await control('/v2/account/address/verify',{challengeId:challenge.challengeId,signature});
 pass('Principal change requires real proof of control',{previous:before.principalAddress,current:owner.address});
 const existing=await control(`/v2/grants/${load('resources.json').grant.id}`);
 if(existing.principal_address!==before.principalAddress)throw Error('Historical principal mutated');
 pass('Existing HTTP grant retains original principal',{grantId:existing.id,principal:existing.principal_address});
}
// Total new funding capped at 0.50 testMON; never touches mainnet.
for(const [target,min]of [[owner.address,'0.35'],[agent.address,'0.15']]){
 const balance=await rpc.getBalance({address:target});const desired=parseEther(min);
 if(balance===0n)await tx(deployer,{to:target,value:desired},'Fund dedicated test identity');
}
let pactAccount=await rpc.readContract({address:manifest.accountFactory,abi:abi.PactAccountFactoryAbi,functionName:'accountOf',args:[owner.address]});
if(pactAccount==='0x0000000000000000000000000000000000000000'){
 const prepared=await control('/v2/account/onchain/prepare',{});
 if(prepared.chainId!==10143||prepared.to.toLowerCase()!==manifest.accountFactory)throw Error('Invalid prepared account deployment');
 await tx(owner,{to:prepared.to,data:prepared.data},'Create unique Pact account from real API preparation');
 pactAccount=await rpc.readContract({address:manifest.accountFactory,abi:abi.PactAccountFactoryAbi,functionName:'accountOf',args:[owner.address]});
}
report.pactAccount=pactAccount;pass('Owner-specific Pact account deployed',{address:pactAccount});
const artifact=JSON.parse(readFileSync(new URL('../../packages/contracts/out/LiveTestToken.sol/LiveTestToken.json',import.meta.url),'utf8'));
const deployed=await tx(owner,{data:artifact.bytecode.object},'Deploy six-decimal valueless test token');
const token=deployed.contractAddress;report.token=token;
await contract(owner,token,artifact.abi,'mint',[pactAccount,10000000n]);
const policyHash=keccak256(toHex('Pact live test bounded transfer v1'));
const expiry=BigInt(Math.floor(Date.now()/1000)+7200);
const grantReceipt=await contract(owner,manifest.registry,abi.AuthorityRegistryAbi,'createRoot',[agent.address,pactAccount,token,owner.address,5000000n,1000000n,500000n,expiry,1,policyHash]);
const grantId=event(grantReceipt,abi.AuthorityRegistryAbi,'GrantCreated').grantId;report.grantId=grantId.toString();
pass('Onchain owner grant binds agent, token, recipient, ceiling and per-action limit',{grantId:report.grantId});
const intent={grantId,agent:agent.address,token,to:owner.address,amount:100000n,nonce:BigInt(Date.now()),deadline:expiry-60n,policyHash};
const intentHash=await rpc.readContract({address:pactAccount,abi:abi.PactAccountAbi,functionName:'hashIntent',args:[intent]});
await rejects('Unreserved transfer denied',pactAccount,abi.PactAccountAbi,'executeTransfer',[intent,0n,'0x']);
await rejects('Foreign actor cannot reserve authority',manifest.ledger,abi.CommitmentLedgerAbi,'reserve',[grantId,intentHash,intent.amount,intent.deadline],owner);
await rejects('Per-action limit enforced onchain',manifest.ledger,abi.CommitmentLedgerAbi,'reserve',[grantId,intentHash,1000001n,intent.deadline]);
const reserved=await agentCall(manifest.ledger,abi.CommitmentLedgerAbi,'reserve',[grantId,intentHash,intent.amount,intent.deadline],'Railway agent reserves transfer capacity');
const reservationId=event(reserved,abi.CommitmentLedgerAbi,'Reserved').reservationId;
await rejects('Intent reservation replay denied',manifest.ledger,abi.CommitmentLedgerAbi,'reserve',[grantId,intentHash,intent.amount,intent.deadline]);
await agentCall(pactAccount,abi.PactAccountAbi,'executeTransfer',[intent,reservationId,'0x'],'Railway agent executes authorized test-token transfer');
const balance=await rpc.readContract({address:token,abi:artifact.abi,functionName:'balanceOf',args:[owner.address]});
if(balance!==intent.amount)throw Error('Recipient balance mismatch');pass('Real transfer settlement and recipient balance',{amountMinor:balance.toString(),decimals:6});
await rejects('Transfer nonce replay denied',pactAccount,abi.PactAccountAbi,'executeTransfer',[intent,reservationId,'0x']);
const large={...intent,amount:600000n,nonce:intent.nonce+1n};
const largeHash=await rpc.readContract({address:pactAccount,abi:abi.PactAccountAbi,functionName:'hashIntent',args:[large]});
const largeReservation=event(await agentCall(manifest.ledger,abi.CommitmentLedgerAbi,'reserve',[grantId,largeHash,large.amount,large.deadline],'Railway agent reserves approval-sized transfer'),abi.CommitmentLedgerAbi,'Reserved').reservationId;
await rejects('Above-threshold transfer requires owner signature',pactAccount,abi.PactAccountAbi,'executeTransfer',[large,largeReservation,'0x']);
const approvalHash=await rpc.readContract({address:pactAccount,abi:abi.PactAccountAbi,functionName:'hashApproval',args:[largeHash,largeReservation,large.deadline]});
const approval=await owner.sign({hash:approvalHash});
await agentCall(pactAccount,abi.PactAccountAbi,'executeTransfer',[large,largeReservation,approval],'Railway agent executes owner-approved transfer');
pass('Exact owner approval permits above-threshold transfer',{reservationId:largeReservation.toString()});
await contract(owner,manifest.registry,abi.AuthorityRegistryAbi,'revoke',[grantId]);
await rejects('Revoked onchain grant rejects new reservations',manifest.ledger,abi.CommitmentLedgerAbi,'reserve',[grantId,keccak256(toHex('revoked probe')),1n,expiry-60n]);
const publicResponse=await fetch(`https://pact-api-production-2ab9.up.railway.app/v1/public/grants/${grantId}`);
const publicData=await publicResponse.json();
if(publicResponse.status!==404||publicData.error!=='GRANT_NOT_PUBLIC')throw Error('Undisclosed authority was exposed');
pass('Public API hides authority without signed disclosure',publicData);
persist();console.log(JSON.stringify({grantId:report.grantId,pactAccount,transactions:report.transactions.length,checks:report.checks.length}));
