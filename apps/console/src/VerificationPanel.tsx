import { useRef, useState } from 'react';
import { verifyGatewayEnforcement } from '@pact/sdk-ts';

export function VerificationPanel({control,onComplete}:{
  control:(path:string,body?:unknown,method?:string)=>Promise<Record<string,unknown>>;
  onComplete:()=>Promise<void>;
}) {
  const running=useRef(false);
  const [busy,setBusy]=useState(false);
  const [steps,setSteps]=useState<string[]>([]);
  const [report,setReport]=useState<Awaited<ReturnType<typeof verifyGatewayEnforcement>>>();
  const [error,setError]=useState('');
  const start=async()=>{
    if(running.current)return;
    running.current=true;setBusy(true);setSteps([]);setReport(undefined);setError('');
    try {
      const result=await verifyGatewayEnforcement({apiOrigin:import.meta.env.VITE_PACT_API_URL,
        gatewayOrigin:import.meta.env.VITE_PACT_GATEWAY_URL,control,
        onStep:step=>setSteps(current=>[...current,step])});
      setReport(result);await onComplete();
    } catch(cause) {setError(cause instanceof Error?cause.message:'Verification failed');}
    finally {running.current=false;setBusy(false);}
  };
  return <section className="cpCard"><span className="cpEyebrow">LIVE ENFORCEMENT CHECK</span>
    <h2>Test Pact with a temporary agent</h2>
    <p>This creates real records in your account and makes harmless requests through the deployed gateway.
      It tests grants, ordered policies, protected secrets, approval, scopes, rotation, revocation and activity.
      Starting authorizes approval of one test request that changes no external data. No wallet, funds or model key is used.</p>
    <p>The test disables its agent and removes credentials afterwards. Records remain in your audit history.
      Keep this page open until cleanup completes. Keys and grants expire after 20 minutes.</p>
    <button className="cpPrimary" disabled={busy} onClick={()=>void start()}>{busy?'Verifying live requests…':'Run live enforcement check'}</button>
    <ol aria-live="polite">{steps.map(step=><li key={step}>{step}</li>)}</ol>
    {error && <p role="alert">{error}</p>}
    {report && <><p role={report.passed?'status':'alert'}><strong>{report.passed?'Verification passed':'Verification failed'}</strong>
      {report.error && `: ${report.error}`}</p>
      {report.cleanupFailures.length>0 && <p role="alert">Cleanup needs attention: {report.cleanupFailures.join(', ')}. Revoke remaining keys and disable this agent in your workspace.</p>}
      <p>Agent: <code>{report.agentId}</code>. {report.evidence}.</p>
      <details><summary>Request IDs and verification evidence</summary><pre>{JSON.stringify(report,null,2)}</pre></details></>}
  </section>;
}
