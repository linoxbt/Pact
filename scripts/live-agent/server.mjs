/** Bounded, authenticated test actor. Runs on Railway; never receives owner credentials. */
import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {createPublicClient,createWalletClient,http,defineChain} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
const gateway='https://pact-gateway-production-ec3f.up.railway.app';
const chain=defineChain({id:10143,name:'Monad Testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:['https://testnet-rpc.monad.xyz']}}});
const account=privateKeyToAccount(process.env.PACT_TEST_AGENT_KEY);
const rpc=createPublicClient({chain,transport:http()});
const wallet=createWalletClient({account,chain,transport:http()});
const digest=value=>createHash('sha256').update(value).digest();
let busy=false, calls=0;
const expires=Date.parse(process.env.PACT_TEST_AGENT_EXPIRES);
if(!process.env.PACT_TEST_AGENT_SECRET||!Number.isFinite(expires))throw Error('Test agent configuration missing');
export function validateProxy(input) {
 const url=new URL(input.url);
 if(url.origin!==gateway||!url.pathname.startsWith('/v2/proxy/')||url.username||url.password||url.hash)throw Error('INVALID_GATEWAY');
 const init=input.init??{};
 if(!['GET','POST','PUT','PATCH','DELETE'].includes(init.method??'GET'))throw Error('INVALID_METHOD');
 const headers=new Headers(init.headers);
 if(!/^Bearer pat_[A-Za-z0-9_-]+$/.test(headers.get('authorization')??''))throw Error('SCOPED_KEY_REQUIRED');
 for(const name of headers.keys())if(!['authorization','content-type','x-pact-approval-id','x-pact-idempotency-key'].includes(name))throw Error('INVALID_HEADER');
 return {url:url.href,init:{method:init.method??'GET',headers,...(init.body===undefined?{}:{body:JSON.stringify(typeof init.body==='string'?JSON.parse(init.body):init.body)})}};
}
async function proxy(input) {
 const {url,init}=validateProxy(input);
 const r=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(25000)});
 const body=await r.text();if(body.length>65536)throw Error('UPSTREAM_TOO_LARGE');
 return {status:r.status,headers:{'x-pact-request-id':r.headers.get('x-pact-request-id')},body};
}
async function modelTask(input) {
 const observations=[],turns=[];
 if(typeof input.task!=='string'||input.task.length>1200)throw Error('INVALID_TASK');
 for(let n=0;n<2;n++) {
  const reply=await proxy({url:input.modelUrl,init:{method:'POST',headers:{authorization:`Bearer ${input.key}`,'content-type':'application/json','x-pact-idempotency-key':crypto.randomUUID()},body:{task:input.task,observations}}});
  if(reply.status!==200)throw Error('MODEL_GATEWAY_REJECTED');
  const inference=JSON.parse(reply.body),raw=inference.response;
  let action;try{action=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{throw Error('MODEL_INVALID_JSON');}
  turns.push({model:inference.model,usage:inference.usage,requestId:reply.headers['x-pact-request-id'],action});
  if(action.done===true)break;
  if(n>0||!['GET','POST','DELETE'].includes(action.method)||!['/health','/write','/forbidden'].includes(action.path))throw Error('MODEL_ACTION_OUT_OF_BOUNDS');
  const operation=action.path==='/health'?'/read':action.path;
  const result=await proxy({url:input.toolBase+operation,init:{method:action.method,headers:{authorization:`Bearer ${input.key}`,...(action.method==='GET'?{}:{'x-pact-idempotency-key':crypto.randomUUID()})}}});
  observations.push({method:action.method,path:action.path,...result});
 }
 return {turns,observations};
}
const allowedSelectors=new Set(['reserve','reserveLiabilityAt','executeTransfer']);
async function transaction(input) {
 // ABI/function allowlist; no arbitrary transactions, native transfers or mainnet.
 const {CommitmentLedgerAbi,PactAccountAbi}=await import('../../packages/abis/dist/index.js');
 const {decodeFunctionData}=await import('viem');
 const ledger='0x3737354490d80e5b9a0d2df7659c258e58ec6280';
 const abi=input.to?.toLowerCase()===ledger?CommitmentLedgerAbi:PactAccountAbi;
 const decoded=decodeFunctionData({abi,data:input.data});
 if(!allowedSelectors.has(decoded.functionName))throw Error('ACTION_NOT_ALLOWED');
 if(abi===PactAccountAbi) {
  const registry=await rpc.readContract({address:input.to,abi:PactAccountAbi,functionName:'registry'});
  if(registry.toLowerCase()!=='0xa3f2ea05d4abc6eac5a8d71ad8773ce86684c2f1')throw Error('UNKNOWN_ACCOUNT');
 }
 if(await rpc.getChainId()!==10143)throw Error('CHAIN_MISMATCH');
 const gas=await rpc.estimateGas({account,to:input.to,data:input.data});
 const gasPrice=await rpc.getGasPrice();
 if(gas*gasPrice>50000000000000000n)throw Error('TEST_GAS_BUDGET_EXCEEDED');
 if(input.simulateOnly)return {simulated:true,gas:gas.toString()};
 const hash=await wallet.sendTransaction({to:input.to,data:input.data,gas,gasPrice});
 const receipt=await rpc.waitForTransactionReceipt({hash,timeout:45000});
 return {hash,status:receipt.status,blockNumber:receipt.blockNumber.toString(),actor:account.address};
}
const server=createServer(async(req,res)=>{
 const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
 if(req.url==='/health'&&req.method==='GET')return send(200,{status:'ready',actor:account.address,chainId:10143,deployment:process.env.RAILWAY_DEPLOYMENT_ID,expiresAt:new Date(expires).toISOString()});
 if(!timingSafeEqual(digest(req.headers.authorization??''),digest('Bearer '+process.env.PACT_TEST_AGENT_SECRET)))return send(401,{error:'UNAUTHORIZED'});
 if(Date.now()>=expires||calls>=500)return send(503,{error:'TEST_WINDOW_CLOSED'});
 if(req.method!=='POST'||!['/request','/task','/transaction'].includes(req.url))return send(404,{error:'NOT_FOUND'});
 if(busy)return send(409,{error:'BUSY'});busy=true;calls++;
 try {
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384){send(413,{error:'BODY_TOO_LARGE'});return;}chunks.push(chunk);}
  const input=JSON.parse(Buffer.concat(chunks).toString());
  const result=await (req.url==='/task'?modelTask(input):req.url==='/transaction'?transaction(input):proxy(input));
  send(200,{...result,actor:account.address,chainId:10143});
 }catch(error){
  // RPC/provider error messages may contain request bodies: never emit them.
  send(422,{error:'TEST_ACTION_FAILED',kind:error?.name??'Error'});
 }finally{busy=false;}
});
server.requestTimeout=30000;
server.listen(Number(process.env.PORT??3000),'0.0.0.0',()=>console.log(JSON.stringify({event:'test-agent.ready',actor:account.address,chainId:10143})));
process.once('SIGTERM',()=>server.close());
