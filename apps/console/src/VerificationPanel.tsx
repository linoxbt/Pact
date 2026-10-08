import { useRef, useState } from 'react';
import { verifyGatewayEnforcement } from '@pact/sdk-ts';

export function VerificationPanel({control,onComplete,feesEnabled}:{
  control:(path:string,body?:unknown,method?:string)=>Promise<Record<string,unknown>>;
  onComplete:()=>Promise<void>;
  feesEnabled?:boolean;
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
    <h2>Verify enforcement</h2>
    <p>{feesEnabled?'Creates paid test resources: 5 MON per agent, grant, policy and key, approved separately.':'Real gateway requests. Temporary agent. No funds or model key.'}</p>
    <p>Includes one approved test request. The agent and credentials are disabled afterward.</p>
    <details><summary>Test scope and cleanup</summary><p>Checks grants, policies, secrets, approvals, scopes, rotation, revocation and activity.
      Starting authorizes one harmless approval. Keep this page open until cleanup completes.
      Keys and grants expire after 20 minutes. Audit records remain.</p></details>
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
