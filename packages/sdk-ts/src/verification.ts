/** Exercises public APIs and a real protected upstream. No privileged provisioning or auth bypass. */
type RecordValue = Record<string, unknown>;
export type VerificationOptions = {
  apiOrigin: string; gatewayOrigin: string;
  control: (path: string, body?: unknown, method?: string) => Promise<RecordValue>;
  onStep?: (step: string) => void;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
};
export async function verifyGatewayEnforcement(options: VerificationOptions) {
  const { control, onStep = () => {}, signal } = options;
  const fetcher = options.fetcher ?? fetch;
  const origin = new URL(options.apiOrigin).origin;
  const steps: string[] = [];
  const pass = (label: string) => { steps.push(label); onStep(label); };
  const check = (value: unknown, label: string) => { if (!value) throw Error(label); };
  let grantRevoked = false;
  let agentId = '', grantId = '', serviceId = '', policyId = '', probeId = '';
  const keyIds = new Set<string>();
  const requestIds: string[] = [];
  const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString();
  const keyInput = {name:'Verification only',scopes:['proxy.read','proxy.write'],expiresAt};
  let error: string | null = null;
  const cleanupFailures: string[] = [];
  try {
    const probe = await control('/v2/verification/probes', {});
    probeId = String(probe.id);
    const path = String(probe.path);
    const agent = await control('/v2/agents', {name:'Pact enforcement verification',
      environment: origin.startsWith('http:') ? 'development' : 'staging',
      description:'Disposable verification agent; no funds or model provider access.'});
    agentId = String(agent.id);
    grantId = String((await control('/v2/grants', {agentId, name:'Verification HTTP authority',
      actions:['GET','POST'],resourceOrigins:[origin],destinationOrigins:[origin],currency:'USD',
      perActionLimitMinor:'0',aggregateLimitMinor:'0',approvalThresholdMinor:'0',
      startsAt:new Date(Date.now()-60_000).toISOString(),expiresAt})).id);
    const rules = [
      {id:'deny_forbidden',name:'Deny forbidden operation',effect:'deny',methods:['GET'],paths:[`${path}/forbidden`],destinations:[origin]},
      {id:'approve_write',name:'Approve harmless test write',effect:'approval',methods:['POST'],paths:[`${path}/write`],destinations:[origin]},
      {id:'read_only',name:'Allow protected reads',effect:'allow',methods:['GET'],paths:[`${path}/read`],destinations:[origin]},
    ];
    policyId = String((await control('/v2/policies',{agentId,name:'Verification ordered policy',rules})).id);
    serviceId = String((await control('/v2/services',{agentId,name:'Protected verification upstream',baseUrl:origin,authMethod:'bearer'})).id);
    await control(`/v2/services/${serviceId}/secret`,{secret:probe.secret},'PUT');
    for (const [method,operation] of [['GET','read'],['GET','forbidden'],['POST','write']])
      await control('/v2/endpoints',{serviceId,grantId,policyId,method,pathPattern:`${path}/${operation}`,
        currency:'USD',responseFields:['ok','method']});
    let key = await control(`/v2/agents/${agentId}/keys`,keyInput);
    keyIds.add(String(key.id));
    pass('Created account-owned agent, zero-spend grant, ordered policy, encrypted secret and scoped key');
    const invoke = async (method:string, operation:string, secret = String(key.secret), approvalId?:string) => {
      signal?.throwIfAborted();
      const response = await fetcher(`${options.gatewayOrigin.replace(/\/$/,'')}/v2/proxy/${agentId}/${serviceId}${path}/${operation}`, {
        method,redirect:'error',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
        headers:{Authorization:`Bearer ${secret}`,...(method!=='GET'?{'X-Pact-Idempotency-Key':crypto.randomUUID()}:{}),...(method==='POST'?{'Content-Type':'application/json'}:{}),
          ...(approvalId?{'X-Pact-Approval-Id':approvalId}:{})},...(method==='POST'?{body:'{"test":"noop"}'}:{})});
      const data = await response.json() as RecordValue;
      const id = response.headers.get('X-Pact-Request-Id') ?? data.requestId;
      if (typeof id === 'string') requestIds.push(id);
      return {status:response.status,data};
    };
    const counters = () => control(`/v2/verification/probes/${probeId}`);
    const allowed = await invoke('GET','read');
    check(allowed.status===200 && allowed.data.ok===true,'Allowed GET did not reach authenticated upstream');
    check(!JSON.stringify(allowed.data).includes('must-not-reach-agent'),'Sensitive upstream field was disclosed');
    check((await counters()).authenticated_requests===1,'Protected upstream did not receive injected credential');
    pass('Allowed GET forwarded with protected credential; sensitive response field redacted');
    const denied = await invoke('GET','forbidden');
    check(denied.status===403 && denied.data.matchedRule==='deny_forbidden','Ordered deny rule failed');
    check((await invoke('DELETE','read')).status===403,'Forbidden method was forwarded');
    const readKey=await control(`/v2/agents/${agentId}/keys`,{...keyInput,scopes:['proxy.read']});
    keyIds.add(String(readKey.id));
    check((await invoke('POST','write',String(readKey.secret))).status===401,'Read-only key permitted a write');
    await control(`/v2/agents/${agentId}/keys/${readKey.id}`,undefined,'DELETE');
    keyIds.delete(String(readKey.id));
    check((await invoke('GET','unregistered')).status===403,'Unregistered path was forwarded');
    check((await counters()).requests===1,'A forbidden request reached upstream');
    pass('Policy-denied operation and forbidden method/path never reached upstream');
    const pending = await invoke('POST','write');
    check(pending.status===202 && typeof pending.data.approvalId==='string','Approval was not required');
    check((await counters()).requests===1,'Pending approval reached upstream');
    const approvalId = String(pending.data.approvalId);
    await control(`/v2/approvals/${approvalId}/intent`);
    await control(`/v2/approvals/${approvalId}/decision`,{decision:'approved'});
    check((await invoke('POST','write',String(key.secret),approvalId)).status===200,'Approved request did not execute');
    pass('Pending request withheld until exact test intent was inspected and approved');
    const old = key;
    key = await control(`/v2/agents/${agentId}/keys/${old.id}/rotate`,{});
    keyIds.delete(String(old.id)); keyIds.add(String(key.id));
    check((await invoke('GET','read',String(old.secret))).status===401,'Rotated key remained valid');
    check((await invoke('GET','read')).status===200,'Replacement key did not work');
    pass('Key rotation invalidated the old credential and activated the replacement');
    await control(`/v2/grants/${grantId}`,{status:'revoked'},'PATCH');
    grantRevoked = true;
    check((await invoke('GET','read')).status===403,'Revoked grant still authorized a request');
    pass('Valid API key could not bypass revoked grant');
    await control(`/v2/agents/${agentId}/keys/${key.id}`,undefined,'DELETE');
    keyIds.delete(String(key.id));
    check((await invoke('GET','read')).status===401,'Revoked key remained valid');
    check((await counters()).requests===3,'Revocation or denial forwarded an unexpected request');
    pass('Revoked key rejected; upstream received exactly three authorized requests');
    const activity = await control(`/v2/activity?agentId=${agentId}`);
    const events = activity.events as RecordValue[];
    check(Array.isArray(events) && requestIds.every(id=>events.some(event=>event.id===id)), 'Activity missing observed request IDs');
    check(events.some(event=>event.decision==='pending_approval') && events.some(event=>event.matched_rule==='deny_forbidden'),'Decision trace missing');
    check(!JSON.stringify(activity).includes(String(probe.secret)) && !JSON.stringify(activity).includes(String(key.secret)), 'Secret leaked into activity');
    pass('Live activity contains each request, policy decisions and approval; secrets absent');
  } catch (cause) { error = cause instanceof Error ? cause.message : 'Verification failed'; }
  finally {
    // All grants/keys also expire after twenty minutes if browser/network interrupts cleanup.
    const clean = async (label:string,path:string,body:unknown,method:string) => {
      try { await control(path,body,method); } catch { cleanupFailures.push(label); }
    };
    for(const id of keyIds) await clean(`key ${id}`,`/v2/agents/${agentId}/keys/${id}`,undefined,'DELETE');
    if(grantId && !grantRevoked) await clean('grant',`/v2/grants/${grantId}`,{status:'revoked'},'PATCH');
    if(agentId) await clean('agent',`/v2/agents/${agentId}`,{status:'disabled'},'PATCH');
    if(serviceId) {
      await clean('upstream secret',`/v2/services/${serviceId}/secret`,undefined,'DELETE');
      await clean('service',`/v2/services/${serviceId}`,{status:'disabled'},'PATCH');
    }
    if(policyId) await clean('policy',`/v2/policies/${policyId}`,{status:'disabled'},'PATCH');
    if(probeId) await clean('probe',`/v2/verification/probes/${probeId}`,undefined,'DELETE');
  }
  return {passed:!error && !cleanupFailures.length,agentId,grantId,policyId,requestIds,steps,error,cleanupFailures,
    evidence:'Live HTTP gateway execution; not a model run or onchain receipt',completedAt:new Date().toISOString()};
}
