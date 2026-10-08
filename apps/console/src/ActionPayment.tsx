import {useEffect,useState} from 'react';
import {useWallets} from '@privy-io/react-auth';
import {activeNetwork} from './networks.js';
import type {Account} from './control-types.js';
export type FeeConfig={enabled:boolean;amountMon:string;treasury:string|null;chainId:number|null};
export type Payment={id:string;action:string;path:string;payload:unknown;payer:string;treasury:string;chain_id:number;amount_wei:string;tx_data:string;tx_hash:string|null;confirmed_at:string|null;consumed_at:string|null;resource_id:string|null;created_at:string};
export type ControlRequest=<T=Record<string,unknown>>(path:string,body?:unknown,method?:string,paymentId?:string)=>Promise<T>;
export function ActionPayment({api,path,body,existing,onDone,onCancel}:{api:ControlRequest;path:string;body:unknown;existing?:Payment;onDone:(value:Record<string,unknown>)=>void;onCancel:()=>void}) {
  const {wallets}=useWallets();const [config,setConfig]=useState<FeeConfig>();const [payment,setPayment]=useState<Payment|undefined>(existing);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[hash,setHash]=useState(existing?.tx_hash??'');
  const [reverted,setReverted]=useState(false);
  const [payer,setPayer]=useState(existing?.payer??'');
  useEffect(()=>{let active=true;void api<Account>('/v2/account').then(account=>{if(active)setPayer(existing?.payer??(account.verificationStatus==='verified'?account.principalAddress:wallets.find(w=>w.walletClientType==='privy')?.address)??'');}).catch(()=>{});return()=>{active=false;};},[wallets.map(w=>w.address).join(',')]);
  useEffect(()=>{let active=true;void api<FeeConfig>('/v2/fees/config').then(value=>{if(active)setConfig(value);}).catch(()=>{if(active)setError('Unable to load fee. Close and retry.');});return()=>{active=false;};},[]);
  const complete=async(intent:Payment,txHash:string)=>{
    const confirmed=await api<Payment>(`/v2/fees/payments/${intent.id}/confirm`,{txHash});setPayment(confirmed);
    const result=await api(intent.path,intent.payload,'POST',intent.id);onDone(result);
  };
  const submit=async()=>{
    setBusy(true);setError('');setReverted(false);
    try{
      let intent=payment;
      if(intent?.consumed_at)throw Error('Action already completed. See its resource ID in Account payment history.');
      if(intent?.confirmed_at){onDone(await api(intent.path,intent.payload,'POST',intent.id));return;}
      if(intent&&/^0x[0-9a-fA-F]{64}$/.test(hash)){await complete(intent,hash);return;}
      let account=await api<Account>('/v2/account');
      let wallet=wallets.find(w=>intent ? w.address.toLowerCase()===intent.payer : account.verificationStatus==='verified'&&w.address.toLowerCase()===account.principalAddress?.toLowerCase());
      if(!intent&&account.verificationStatus!=='verified'){
        wallet=wallets.find(w=>w.walletClientType==='privy');
        if(!wallet)throw Error('Your Pact wallet is loading. Retry shortly.');
        const challenge=await api<{challengeId:string;message:string}>('/v2/account/address/challenge',{address:wallet.address});
        const provider=await wallet.getEthereumProvider();
        const signature=await provider.request({method:'personal_sign',params:[challenge.message,wallet.address]});
        await api('/v2/account/address/verify',{challengeId:challenge.challengeId,signature});
        account=await api<Account>('/v2/account');
      }
      if(!wallet)throw Error('Open the wallet linked to your account to authorize this payment.');
      intent??=await api<Payment>('/v2/fees/prepare',{path,body});setPayment(intent);
      if(intent.confirmed_at){onDone(await api(intent.path,intent.payload,'POST',intent.id));return;}
      // Never silently resend after a refresh or a lost confirmation response.
      let saved:string|null=null;try{saved=localStorage.getItem(`pact:payment:${intent.id}`);}catch{/* Wallet hash can be entered manually when browser storage is unavailable. */}
      if(saved){setHash(saved);await complete(intent,saved);return;}
      if(wallet.address.toLowerCase()!==intent.payer)throw Error('This pending payment belongs to your previous wallet. Use that wallet to pay or recover its transaction hash.');
      if(intent.chain_id!==activeNetwork.id)throw Error('Payment network differs from this Console. Do not send funds.');
      await wallet.switchChain(intent.chain_id);
      const provider=await wallet.getEthereumProvider();
      const txHash=String(await provider.request({method:'eth_sendTransaction',params:[{from:intent.payer,to:intent.treasury,value:`0x${BigInt(intent.amount_wei).toString(16)}`,data:intent.tx_data}]}));
      setHash(txHash);try{localStorage.setItem(`pact:payment:${intent.id}`,txHash);}catch{/* Hash remains visible and recoverable from the wallet. */}
      // Confirmation is explicit, so slow finality never resubmits the transfer.
      setError('Transaction submitted. Wait for confirmation, then select Verify payment & finish.');
    }catch(cause){const message=cause instanceof Error?cause.message:'Payment failed';setReverted(message==='PAYMENT_REVERTED');setError(message==='PAYMENT_NOT_FINAL'?'Transaction is still confirming. Wait a few seconds and retry verification.':message);}
    finally{setBusy(false);}
  };
  const confirming=Boolean(hash||payment?.confirmed_at);
  return <div className="cpReviewShade"><section className="cpReview" role="dialog" aria-modal="true" aria-label="Pay action fee">
    <span className="cpEyebrow">ACTION FEE</span><h2>5 MON</h2><p>{payment?.action??path} · {activeNetwork.name}</p>
    <p>One payment for this creation. Network gas is additional.</p>
    <small>Paying wallet · fund this address with MON on {activeNetwork.name}</small><code style={{display:'block',overflowWrap:'anywhere'}}>{payment?.payer??(payer||'Wallet loading…')}</code>
    <details><summary>Action details</summary><pre>{JSON.stringify(payment?.payload??body,null,2)}</pre></details><small>Treasury</small><code style={{display:'block',overflowWrap:'anywhere'}}>{payment?.treasury??config?.treasury??'Loading…'}</code>
    <p>Authorize with your account wallet. A first payment may ask you to verify wallet ownership.</p>
    {payment&&<label className="cpField"><span>Payment transaction hash</span><input value={hash} onChange={e=>setHash(e.target.value)} disabled={busy} placeholder="0x…"/><small>Recover a submitted payment here. Do not pay again.</small></label>}
    {error&&<p role="status">{error}</p>}
    {reverted&&payment&&<button onClick={()=>{try{localStorage.removeItem(`pact:payment:${payment.id}`);}catch{}setHash('');setReverted(false);setError('The transfer reverted. No fee was received. You can retry this payment.');}}>Retry reverted transfer</button>}
    <div className="cpActions"><button disabled={busy} onClick={onCancel}>{hash?'Close — finish from Account':'Cancel'}</button>
    <button className="cpPrimary" disabled={busy||!config?.enabled||Boolean(hash&&!/^0x[0-9a-fA-F]{64}$/.test(hash))} onClick={()=>void submit()}>{busy?'Processing…':confirming?'Verify payment & finish':'Pay 5 MON'}</button></div>
  </section></div>;
}
export function PaymentHistory({api,onResume}:{api:ControlRequest;onResume:(payment:Payment)=>void}){
  const [payments,setPayments]=useState<Payment[]>([]),[error,setError]=useState('');
  const load=()=>{setError('');void api<{payments:Payment[]}>('/v2/fees/payments').then(value=>setPayments(value.payments)).catch(()=>setError('Payment history unavailable.'));};
  useEffect(load,[]);
  return <section className="cpCard"><span className="cpEyebrow">ACTION PAYMENTS</span><h2>Payment history</h2><small>Pending actions and the latest 100 completed payments.</small><button onClick={load}>Refresh payments</button>{error&&<p role="alert">{error}</p>}
    {!payments.length&&!error&&<p>No action payments yet.</p>}{payments.map(item=><div className="cpListRow" key={item.id}><div><strong>{item.action} · 5 MON</strong><small>{item.chain_id===143?'Monad mainnet':'Monad testnet'} · {new Date(item.created_at).toLocaleString()}</small><small>{item.consumed_at?'Completed':item.confirmed_at?'Paid — finish action':'Awaiting payment verification'}</small>{item.resource_id&&<code>{item.resource_id}</code>}{item.tx_hash&&<a href={`${item.chain_id===143?'https://monadvision.com':'https://testnet.monadvision.com'}/tx/${item.tx_hash}`} target="_blank" rel="noreferrer">View payment ↗</a>}</div>{!item.consumed_at&&<button onClick={()=>onResume(item)}>Resume action</button>}</div>)}
  </section>;
}
