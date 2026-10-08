import {createHash,randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {isAddress,stringToHex,type Address,type Hex} from 'viem';
import {z} from 'zod';
import {AuthError,enforceRequestLimit,jsonSafe,type Database,type Owner} from '@pact/operations';
import {grantInput,httpPolicyInput} from '@pact/policies';
import type {ApiContext} from './server.js';

export const ACTION_FEE_WEI=5_000_000_000_000_000_000n;
export type ActionFees={treasury:Address;chainId:number};
export function loadActionFees(env:NodeJS.ProcessEnv,chainId:number):ActionFees|undefined {
  if(env.PACT_ACTION_FEES_ENABLED!=='yes')return;
  const treasury=env.PACT_ACTION_FEE_TREASURY;
  if(!treasury||!isAddress(treasury)||/^0x0{40}$/i.test(treasury))throw Error('Valid PACT_ACTION_FEE_TREASURY required');
  if(![10143,143].includes(chainId))throw Error('Action fees require Monad');
  return {treasury,chainId};
}
export const connectedAgentInput=z.object({name:z.string().trim().min(2).max(100),environment:z.enum(['development','staging','production']),description:z.string().max(1000).default('')}).strict();
export const integrationKeyInput=z.object({name:z.string().trim().min(2).max(100),scopes:z.array(z.enum(['proxy.read','proxy.write'])).min(1).max(2),expiresAt:z.iso.datetime({offset:true})}).strict();
export function paidAction(path:string,body:unknown) {
  if(path==='/v2/agents')return {action:'agent.create',body:connectedAgentInput.parse(body),table:'pact_connected_agents'};
  if(path==='/v2/grants')return {action:'grant.create',body:grantInput.parse(body),table:'pact_authority_grants'};
  if(path==='/v2/policies')return {action:'policy.create',body:httpPolicyInput.parse(body),table:'pact_http_policies'};
  if(/^\/v2\/agents\/[0-9a-f-]{36}\/keys$/.test(path)) {
    z.uuid().parse(path.split('/')[3]);return {action:'key.create',body:integrationKeyInput.parse(body),table:'pact_integration_keys'};
  }
  throw new AuthError('ACTION_NOT_BILLABLE',400);
}
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const digest=(path:string,body:unknown)=>createHash('sha256').update(path+'\n'+canonical(body)).digest('hex');
type Client=Pick<Database,'query'>;
export async function consumeActionFee(client:Client,ctx:ApiContext,owner:Owner,request:FastifyRequest,resourceId:string) {
  if(!ctx.actionFees)return;
  const id=z.uuid().safeParse(request.headers['x-pact-payment']);
  if(!id.success)throw new AuthError('PAYMENT_REQUIRED_5_MON',402);
  const path=request.url.split('?')[0]!;
  const action=paidAction(path,request.body);
  const row=(await client.query('SELECT * FROM pact_action_payments WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id.data,owner.id])).rows[0];
  if(!row||row.request_hash!==digest(path,action.body))throw new AuthError('PAYMENT_ACTION_MISMATCH',402);
  if(row.consumed_at)throw new AuthError('PAYMENT_ALREADY_USED_CHECK_ACCOUNT_HISTORY',409);
  if(!row.confirmed_at)throw new AuthError('PAYMENT_NOT_CONFIRMED',402);
  await client.query('UPDATE pact_action_payments SET consumed_at=now(),resource_id=$2 WHERE id=$1',[row.id,resourceId]);
  await client.query('INSERT INTO pact_audit_events(principal,actor,action,details) VALUES($1,$2,$3,$4)',[row.payer,owner.did,'action.payment.consumed',JSON.stringify({paymentId:row.id,action:row.action,resourceId,txHash:row.tx_hash,amountWei:row.amount_wei})]);
}
export async function paidInsert<T>(ctx:ApiContext,owner:Owner,request:FastifyRequest,id:string,insert:(client:Client)=>Promise<T>):Promise<T>{
  const client=await ctx.database.connect();
  try{await client.query('BEGIN');await consumeActionFee(client,ctx,owner,request,id);const result=await insert(client);await client.query('COMMIT');return result;}
  catch(cause){await client.query('ROLLBACK');throw cause;}finally{client.release();}
}
export function registerActionFees(app:FastifyInstance,ctx:ApiContext){
  const ownerFor=async(header:string|undefined)=>{const owner=await ctx.ownerAuth!.authenticate(header);await enforceRequestLimit(ctx.database,`action-fees:${owner.id}`,120);return owner;};
  app.get('/v2/fees/config',async request=>{await ownerFor(request.headers.authorization);return {enabled:Boolean(ctx.actionFees),amountMon:'5',amountWei:ACTION_FEE_WEI.toString(),treasury:ctx.actionFees?.treasury??null,chainId:ctx.actionFees?.chainId??null,actions:['agent.create','grant.create','policy.create','key.create']};});
  app.get('/v2/fees/payments',async request=>{const owner=await ownerFor(request.headers.authorization);return {payments:jsonSafe((await ctx.database.query(`(SELECT * FROM pact_action_payments WHERE owner_id=$1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 100) UNION ALL (SELECT * FROM pact_action_payments WHERE owner_id=$1 AND consumed_at IS NOT NULL ORDER BY created_at DESC LIMIT 100)`,[owner.id])).rows)};});
  app.post('/v2/fees/prepare',async request=>{
    const owner=await ownerFor(request.headers.authorization),config=ctx.actionFees;
    if(!config)throw new AuthError('ACTION_FEES_DISABLED',409);
    if(owner.principalStatus!=='verified'||!owner.principalAddress)throw new AuthError('VERIFY_PAYMENT_WALLET',409);
    const input=z.object({path:z.string().max(100),body:z.unknown()}).strict().parse(request.body);
    const action=paidAction(input.path,input.body),payload=action.body as Record<string,unknown>;
    const agentId=action.action==='key.create'?input.path.split('/')[3]:payload.agentId;
    if(agentId){const agent=(await ctx.database.query('SELECT status FROM pact_connected_agents WHERE id=$1 AND owner_id=$2',[agentId,owner.id])).rows[0];if(!agent)throw new AuthError('AGENT_NOT_FOUND',404);if(agent.status!=='active')throw new AuthError('AGENT_DISABLED',409);}
    if(action.action==='key.create'&&(Date.parse(String(payload.expiresAt))<=Date.now()||Date.parse(String(payload.expiresAt))>Date.now()+90*86400000))throw new AuthError('INVALID_KEY_EXPIRY',400);
    const count=await ctx.database.query(`SELECT count(*)::int AS n FROM ${action.table} WHERE owner_id=$1`,[owner.id]);
    if(count.rows[0].n>=1000)throw new AuthError('RESOURCE_QUOTA_EXCEEDED',409);
    const id=randomUUID(),hash=digest(input.path,action.body),client=await ctx.database.connect();
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[owner.id+':action-payments']);
      const existing=(await client.query('SELECT * FROM pact_action_payments WHERE owner_id=$1 AND request_hash=$2 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1',[owner.id,hash])).rows[0];
      if(existing){await client.query('COMMIT');return jsonSafe(existing);}
      const pending=await client.query('SELECT count(*)::int AS n FROM pact_action_payments WHERE owner_id=$1 AND consumed_at IS NULL',[owner.id]);
      if(pending.rows[0].n>=100)throw new AuthError('RESUME_PENDING_PAYMENTS_FIRST',409);
      const row=(await client.query(`INSERT INTO pact_action_payments(id,owner_id,action,path,payload,request_hash,payer,treasury,chain_id,amount_wei,tx_data)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[id,owner.id,action.action,input.path,JSON.stringify(action.body),hash,owner.principalAddress.toLowerCase(),config.treasury.toLowerCase(),config.chainId,ACTION_FEE_WEI.toString(),stringToHex(`pact-action:${id}`)])).rows[0];
      await client.query('INSERT INTO pact_audit_events(principal,actor,action,details) VALUES($1,$2,$3,$4)',[owner.principalAddress,owner.did,'action.payment.prepared',JSON.stringify({paymentId:id,action:action.action,amountWei:ACTION_FEE_WEI.toString(),treasury:config.treasury})]);
      await client.query('COMMIT');return jsonSafe(row);
    }catch(cause){await client.query('ROLLBACK');throw cause;}finally{client.release();}
  });
  app.post('/v2/fees/payments/:id/confirm',async request=>{
    const owner=await ownerFor(request.headers.authorization);
    const id=z.uuid().parse((request.params as {id:string}).id);
    const {txHash}=z.object({txHash:z.string().regex(/^0x[0-9a-fA-F]{64}$/)}).strict().parse(request.body);
    const row=(await ctx.database.query('SELECT * FROM pact_action_payments WHERE id=$1 AND owner_id=$2',[id,owner.id])).rows[0];
    if(!row)throw new AuthError('PAYMENT_NOT_FOUND',404);
    if(row.confirmed_at){if(row.tx_hash!==txHash.toLowerCase())throw new AuthError('PAYMENT_HASH_MISMATCH',409);return jsonSafe(row);}
    if(await ctx.rpc.getChainId()!==row.chain_id)throw new AuthError('PAYMENT_CHAIN_MISMATCH',503);
    let tx,receipt;
    try{[tx,receipt]=await Promise.all([ctx.rpc.getTransaction({hash:txHash as Hex}),ctx.rpc.getTransactionReceipt({hash:txHash as Hex})]);}
    catch(cause){if(cause instanceof Error&&['TransactionNotFoundError','TransactionReceiptNotFoundError'].includes(cause.name))throw new AuthError('PAYMENT_NOT_FINAL',409);throw cause;}
    if(tx.from.toLowerCase()!==row.payer||tx.to?.toLowerCase()!==row.treasury||tx.value!==BigInt(row.amount_wei)||tx.input.toLowerCase()!==row.tx_data)throw new AuthError('PAYMENT_TRANSFER_MISMATCH',400);
    if(receipt.status!=='success')throw new AuthError('PAYMENT_REVERTED',400);
    const [block,head]=await Promise.all([ctx.rpc.getBlock({blockNumber:receipt.blockNumber}),ctx.rpc.getBlockNumber({cacheTime:0})]);
    if(block.hash!==receipt.blockHash||tx.blockHash!==receipt.blockHash||head<receipt.blockNumber+BigInt(Math.max(5,ctx.auth.config.finalityBlocks)))throw new AuthError('PAYMENT_NOT_FINAL',409);
    const client=await ctx.database.connect();
    try{await client.query('BEGIN');
      await client.query('SELECT id FROM pact_action_payments WHERE id=$1 FOR UPDATE',[id]);
      const result=await client.query(`UPDATE pact_action_payments SET tx_hash=$2,confirmed_at=COALESCE(confirmed_at,now()) WHERE id=$1 AND (tx_hash IS NULL OR tx_hash=$2) RETURNING *`,[id,txHash.toLowerCase()]);
      if(!result.rows[0])throw new AuthError('PAYMENT_HASH_MISMATCH',409);
      await client.query('INSERT INTO pact_audit_events(principal,actor,action,details) VALUES($1,$2,$3,$4)',[row.payer,owner.did,'action.payment.confirmed',JSON.stringify({paymentId:id,txHash,amountWei:row.amount_wei})]);
      await client.query('COMMIT');return jsonSafe(result.rows[0]);
    }catch(cause){await client.query('ROLLBACK');throw cause;}finally{client.release();}
  });
}
