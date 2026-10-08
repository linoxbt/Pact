import { activeNetwork, networkNotice } from './networks.js';
import { useEffect, useRef, useState } from 'react';
import { getAccessToken, useConnectWallet, usePrivy, useWallets } from '@privy-io/react-auth';
import {ActionPayment,PaymentHistory,type Payment,type FeeConfig} from './ActionPayment.js';
import {AccountSecurity} from './AccountSecurity.js';
import { Brand, Icon } from './ui.js';
import './control.css';
import { VerificationPanel } from './VerificationPanel.js';
import { Dashboard, type WorkspaceView } from './Dashboard.js';
import { ResourceDetail } from './ResourceDetail.js';
import './dashboard.css';

const apiOrigin = import.meta.env.VITE_PACT_API_URL as string | undefined;
const gatewayOrigin = import.meta.env.VITE_PACT_GATEWAY_URL as string | undefined;
import type {Account,Agent,Grant,Service,Policy,Endpoint,IntegrationKey,Approval,Activity,AuditEvent,OpenApiPreview,DashboardData} from './control-types.js';
type Item = Record<string, unknown>;
type View = WorkspaceView;
type ControlStatus = 'idle'|'loading'|'ready'|'unavailable';
const nav: { id: View; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'agents', label: 'Agents', icon: 'agent' },
  { id: 'grants', label: 'Grants', icon: 'shield' },
  { id: 'endpoints', label: 'Endpoints', icon: 'globe' },
  { id: 'policies', label: 'Policies', icon: 'layers' },
  { id: 'keys', label: 'API keys', icon: 'key' },
  { id: 'approvals', label: 'Approvals', icon: 'inbox' },
  { id: 'activity', label: 'Live Activity', icon: 'activity' },
  { id: 'verification', label: 'Verification', icon: 'shield' },
  { id: 'audit', label: 'Audit history', icon: 'book' },
  { id: 'account', label: 'Account', icon: 'wallet' },
];
const readRoute=()=>{
  const path=window.location.pathname.replace(/\/$/,'').split('/').filter(Boolean);
  const legacy=window.location.hash.slice(1).split('/');
  const parts=path[0]==='app'&&path.length>1?path.slice(1):legacy;
  const [page,id]=parts;
  return {view:(nav.some(x=>x.id===page)?page:'overview') as View,id:id&&/^[0-9a-f-]{36}$/i.test(id)?id:undefined};
};
const json = (value: unknown) => JSON.stringify(value, (_key, field) =>
  typeof field === 'bigint' ? field.toString() : field);
async function requestControl<T = Item>(path: string, body?: unknown, method?: string, scope?: {signal:AbortSignal;did?:string},paymentId?:string): Promise<T> {
  if (!apiOrigin) throw Error('Pact API URL is not configured');
  const token = await getAccessToken();
  if (!token) throw Error('Your sign in expired. Please sign in again.');
  if(scope?.signal.aborted) throw Error('Account changed');
  if(scope?.did) {
    const claims=JSON.parse(atob(token.split('.')[1]!.replace(/-/g,'+').replace(/_/g,'/')));
    if(claims.sub!==scope.did) throw Error('Account changed. Retry from your current workspace.');
  }
  const response = await fetch(new URL(path, apiOrigin), { method: method ?? (body === undefined ? 'GET' : 'POST'),
    redirect: 'error', signal:scope ? AbortSignal.any([scope.signal,AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${token}`,
      ...(paymentId ? {'x-pact-payment':paymentId} : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: json(body) }) });
  const data = await response.json().catch(() => ({})) as Item;
  if (!response.ok) {
    if (response.status === 404 && path.startsWith('/v2/')) {
      throw Error('The live Pact API does not have the agent management release yet (HTTP 404).');
    }
    throw Error(String(data.message ?? data.error ?? `Pact API ${response.status}`));
  }
  const collection=path.match(/^\/v2\/(agents|grants|policies|services|endpoints|approvals)(?:\/[^/]+\/(keys))?$/);
  if(collection && data.nextCursor) {
    const field=collection[2] ?? collection[1]!;
    let cursor:unknown=data.nextCursor;
    while(cursor) {
      const page=await requestControl<Item>(`${path}?cursor=${encodeURIComponent(String(cursor))}`,undefined,'GET',scope);
      if(!Array.isArray(data[field]) || !Array.isArray(page[field])) throw Error('Invalid collection response');
      data[field]=[...data[field],...page[field]];cursor=page.nextCursor;
    }
    data.nextCursor=null;
  }
  return data as T;
}
const later = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const localDateTime = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0,16);
};
const moneyLabel = (minor: string, currency: string) => `${minor} ${currency} minor units`;
const short = (value?: string) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : 'Pending';
function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [error,setError]=useState(false);
  return <button className="cpCopy" type="button" onClick={() => {
    void navigator.clipboard.writeText(text).then(() => { setError(false);setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(()=>setError(true));
  }}>{error ? 'Copy failed — select text' : copied ? 'Copied' : label}</button>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="cpEmpty"><span><Icon name="layers" size={24}/></span><strong>{title}</strong><p>{detail}</p></div>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="cpField"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function ControlConsole() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const lifetime=useRef(new AbortController());
  useEffect(()=>{if(lifetime.current.signal.aborted)lifetime.current=new AbortController();const current=lifetime.current;return()=>current.abort();},[]);
  const rawApi=<T=Item,>(path:string,body?:unknown,method?:string,paymentId?:string)=>requestControl<T>(path,body,method,{signal:lifetime.current.signal,did:user?.id},paymentId);
  const [feeConfig,setFeeConfig]=useState<FeeConfig>();
  const [paymentRevision,setPaymentRevision]=useState(0);
  const [paymentTask,setPaymentTask]=useState<{path:string;body:unknown;existing?:Payment;resolve:(value:Item)=>void;reject:(cause:Error)=>void}>();
  const api=async<T=Item,>(path:string,body?:unknown,method?:string):Promise<T>=>{
    const billable=(method??(body===undefined?'GET':'POST'))==='POST'&&(/^\/v2\/(agents|grants|policies)$/.test(path)||/^\/v2\/agents\/[^/]+\/keys$/.test(path));
    if(billable){const config=await rawApi<FeeConfig>('/v2/fees/config');if(config.enabled)return new Promise<T>((resolve,reject)=>setPaymentTask({path,body,resolve:value=>resolve(value as T),reject}));}
    return rawApi<T>(path,body,method);
  };
  useEffect(()=>{if(authenticated)void rawApi<FeeConfig>('/v2/fees/config').then(setFeeConfig).catch(()=>setFeeConfig(undefined));},[authenticated,user?.id]);
  const activityGeneration=useRef(0);
  const keyGeneration=useRef(0);
  const activityLatest=useRef<Activity[]>([]);
  const { wallets } = useWallets();
  const { connectWallet } = useConnectWallet();
  const [view, setView] = useState<View>(()=>readRoute().view);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem('pact:sidebar-collapsed') === 'true'; }
    catch { return false; }
  });
  const [account, setAccount] = useState<Account>();
  const [controlStatus, setControlStatus] = useState<ControlStatus>('idle');
  const [controlError, setControlError] = useState('');
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [keys, setKeys] = useState<IntegrationKey[]>([]);
  const [activeKeyCount, setActiveKeyCount] = useState(0);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [activityError, setActivityError] = useState('');
  const [activityFilters, setActivityFilters] = useState({ search: '', decision: '', agentId: '' });
  const [selected,setSelected]=useState<{id:string}|undefined>(()=>readRoute().id?{id:readRoute().id!}:undefined);
  const [detailEditing,setDetailEditing]=useState(false);
  const [dashboard,setDashboard]=useState<DashboardData>();
  const [dashboardError,setDashboardError]=useState('');
  const [agentActivity,setAgentActivity]=useState<Activity[]>([]);
  const [detailKey,setDetailKey]=useState<IntegrationKey>();
  const [activityDetail,setActivityDetail]=useState<Activity>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ title: string; summary: string[]; action: () => Promise<void> }>();
  const [approvalIntent, setApprovalIntent] = useState<{id:string; intent:unknown}>();
  const [newSecret, setNewSecret] = useState('');
  const [testKey, setTestKey] = useState('');
  const [testMethod, setTestMethod] = useState('GET');
  const [testPath, setTestPath] = useState('/health');
  const [testBody, setTestBody] = useState('{}');
  const [testResult, setTestResult] = useState('');
  const [changeAddress, setChangeAddress] = useState('');
  const [editAgentId,setEditAgentId]=useState('');
  const [agentForm, setAgentForm] = useState({ name: '', environment: 'development', description: '' });
  const [serviceForm, setServiceForm] = useState({ agentId: '', name: '', baseUrl: '',
    authMethod: 'none', authHeader: '', secret: '' });
  const [replacementSecret, setReplacementSecret] = useState('');
  const [responseFieldsDraft, setResponseFieldsDraft] = useState('');
  const [grantForm, setGrantForm] = useState({ agentId: '', name: 'Read only service access',
    origin: '', recipients: '', actions: ['GET'], currency: 'USD', perActionLimitMinor: '0',
    aggregateLimitMinor: '0', approvalThresholdMinor: '0', startsAt: new Date().toISOString(),
    expiresAt: later(30) });
  const [editGrantId, setEditGrantId] = useState('');
  const [policyForm, setPolicyForm] = useState({ agentId: '', name: 'Read only policy',
    rules: [{ id: 'allow_read', name: 'Allow registered reads', effect: 'allow',
      methods: ['GET'], paths: ['/health'], destinations: [''], maxRequests: 60,
      periodSeconds: 60, maxSpendMinor: '', currency: 'USD', startHour: '', endHour: '' }] });
  const [editPolicyId, setEditPolicyId] = useState('');
  const [endpointForm, setEndpointForm] = useState({ serviceId: '', grantId: '', policyId: '',
    method: 'GET', pathPattern: '/health', description: '', costMinor: '0', currency: 'USD',
    amountPath: '', currencyPath: '', recipientPath: '', responseFields: ['status','service','ok'] });
  const [keyForm, setKeyForm] = useState({ agentId: '', name: 'Development agent',
    scopes: ['proxy.read'], expiresAt: later(30) });
  const [openApi, setOpenApi] = useState('');
  const [openApiPreview, setOpenApiPreview] = useState<OpenApiPreview>();
  const [legacyCount, setLegacyCount] = useState<number | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setNotice('');
    try { await work(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Action failed'); }
    finally { setBusy(false); }
  };
  const refresh = async () => {
    const failures:string[]=[];
    const load=async(name:string,work:()=>Promise<void>)=>{try{await work();}catch{failures.push(name);}};
    await Promise.all([
      load('Agents',async()=>setAgents((await api<{agents:Agent[]}>('/v2/agents')).agents)),
      load('Grants',async()=>setGrants((await api<{grants:Grant[]}>('/v2/grants')).grants)),
      load('Services',async()=>setServices((await api<{services:Service[]}>('/v2/services')).services)),
      load('Endpoints',async()=>setEndpoints((await api<{endpoints:Endpoint[]}>('/v2/endpoints')).endpoints)),
      load('Policies',async()=>setPolicies((await api<{policies:Policy[]}>('/v2/policies')).policies)),
      load('Approvals',async()=>setApprovals((await api<{approvals:Approval[]}>('/v2/approvals')).approvals)),
      load('Activity',async()=>{if(view==='activity')await refreshActivity(false,true);}),
      load('Dashboard',async()=>{setDashboard(await api<DashboardData>('/v2/dashboard'));setDashboardError('');}),
      load('Keys',async()=>setActiveKeyCount((await api<{active:number}>('/v2/keys/summary')).active)),
    ]);
    if(failures.length) setNotice(`Temporarily unavailable: ${failures.join(', ')}. Other sections remain available; use Retry to reload.`);
  };
  const refreshKeys = async (agentId: string) => {
    const generation=++keyGeneration.current;setKeys([]);
    if (!agentId) { setKeys([]); return; }
    const result = await api<{ keys: IntegrationKey[] }>(`/v2/agents/${agentId}/keys`);
    if(generation===keyGeneration.current) setKeys(result.keys);
  };
  const refreshActivity = async (append = false, preserveLoaded = false) => {
    const generation=activityGeneration.current;
    const query = new URLSearchParams();
    if (activityFilters.search) query.set('search', activityFilters.search);
    if (activityFilters.decision) query.set('decision', activityFilters.decision);
    if (activityFilters.agentId) query.set('agentId', activityFilters.agentId);
    if (append && activityCursor) query.set('cursor', activityCursor);
    const previous=activityLatest.current;
    let data=await api<{events:Activity[];nextCursor:string|null}>(`/v2/activity?${query}`);
    const events=[...data.events];
    const firstCursor=data.nextCursor;
    // Walk every intervening page after a burst instead of silently skipping events.
    while(preserveLoaded && data.nextCursor && previous.length && !events.some(event=>event.id===previous[0]?.id)) {
      if(generation!==activityGeneration.current || lifetime.current.signal.aborted) return;
      query.set('cursor',data.nextCursor);
      data=await api<{events:Activity[];nextCursor:string|null}>(`/v2/activity?${query}`);
      events.push(...data.events);
    }
    if(generation!==activityGeneration.current || lifetime.current.signal.aborted) return;
    if(preserveLoaded) {
      const pending=previous.filter(item=>!events.some(event=>event.id===item.id) && ['authorized','dispatching'].includes(item.execution_state??''));
      for(const item of pending) {const detail=await api<Activity>(`/v2/activity/${item.id}`);events.push(detail);}
      if(generation!==activityGeneration.current) return;
    }
    const merged=append ? [...previous,...events] : preserveLoaded ? [...events,...previous.filter(item=>!events.some(event=>event.id===item.id))] : events;
    const unique=[...new Map(merged.map(item=>[item.id,item])).values()];
    activityLatest.current=unique;setActivity(unique);
    if(!preserveLoaded) setActivityCursor(data.nextCursor);
    else if(!previous.length) setActivityCursor(firstCursor);
    setActivityError('');
  };
  const refreshAudit = async (append = false) => {
    const data = await api<{ events: AuditEvent[]; nextCursor: string | null }>(
      `/v2/audit${append && auditCursor ? `?cursor=${auditCursor}` : ''}`);
    setAuditEvents(old => append ? [...old, ...data.events] : data.events);
    setAuditCursor(data.nextCursor);
  };
  useEffect(() => {
    if (authenticated && controlStatus === 'ready' && view === 'audit')
      void refreshAudit().catch(() => setNotice('Audit history is temporarily unavailable.'));
  }, [authenticated, controlStatus, view]);
  useEffect(() => {
    if (!ready || !authenticated) {
      setAccount(undefined);
      setControlStatus('idle');
      setControlError('');
      return;
    }
    let cancelled = false;
    setAccount(undefined);
    setControlStatus('loading');
    setControlError('');
    void (async () => {
      try {
        const nextAccount = await api<Account>('/v2/account');
        if (cancelled) return;
        await refresh();
        if (cancelled) return;
        setAccount(nextAccount);
        setControlStatus('ready');
      } catch (cause) {
        if (cancelled) return;
        setAccount(undefined);
        setControlError(cause instanceof Error ? cause.message : 'Unable to reach the Pact API.');
        setControlStatus('unavailable');
      }
    })();
    return () => { cancelled = true; };
  }, [ready, authenticated, user?.id, connectionAttempt]);
  useEffect(() => {
    activityGeneration.current++;
    if (!authenticated || controlStatus!=='ready' || view !== 'activity') return;
    let active=true;let timer:ReturnType<typeof setTimeout>;let first=true;
    const poll=async()=>{try{await refreshActivity(false,!first);first=false;}catch{if(active)setActivityError('Activity is temporarily stale. Retry below.');}
      if(active) timer=setTimeout(()=>void poll(),3000);};
    void poll();
    return ()=>{active=false;clearTimeout(timer);activityGeneration.current++;};
  }, [authenticated, controlStatus, view, activityFilters]);
  useEffect(()=>{
    if(!authenticated || controlStatus!=='ready' || !['approvals','overview'].includes(view)) return;
    let active=true;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const data=await api<{approvals:Approval[]}>('/v2/approvals');if(active)setApprovals(data.approvals);}
      catch{if(active)setNotice('Approval inbox is temporarily stale. Retry to refresh.');}
      if(active)timer=setTimeout(()=>void poll(),5000);};
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[authenticated,controlStatus,view]);
  useEffect(() => {
    try { window.localStorage.setItem('pact:sidebar-collapsed', String(sidebarCollapsed)); }
    catch { /* Navigation still works when storage is unavailable. */ }
  }, [sidebarCollapsed]);

  useEffect(()=>{
    const target=`/app/${view}${selected?`/${selected.id}`:''}`;
    if(window.location.pathname!==target||window.location.hash) window.history.replaceState(null,'',target);
  },[view,selected?.id]);
  useEffect(()=>{
    const handler=()=>{const route=readRoute();setView(route.view);setSelected(route.id?{id:route.id}:undefined);setDetailEditing(false);};
    window.addEventListener('popstate',handler);window.addEventListener('hashchange',handler);
    return()=>{window.removeEventListener('popstate',handler);window.removeEventListener('hashchange',handler);};
  },[]);
  useEffect(()=>{setDetailEditing(false);},[view,selected?.id]);
  useEffect(()=>{
    if(!authenticated||controlStatus!=='ready'||!['overview','agents'].includes(view))return;
    let active=true;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const result=await api<DashboardData>('/v2/dashboard');if(active){setDashboard(result);setDashboardError('');}}
      catch{if(active)setDashboardError('Metrics unavailable. Last snapshot retained.');}
      if(active)timer=setTimeout(()=>void poll(),10000);};
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[authenticated,controlStatus,view]);
  useEffect(()=>{
    if(!selected||controlStatus!=='ready')return;
    let active=true;
    if(view==='agents') {
      setAgentActivity([]);
      void refreshKeys(selected.id).catch(()=>{if(active)setNotice('Agent keys unavailable.');});
      void api<{events:Activity[]}>(`/v2/activity?agentId=${selected.id}`).then(data=>{if(active)setAgentActivity(data.events);}).catch(()=>{if(active)setNotice('Agent activity unavailable.');});
    }
    if(view==='keys') {
      setDetailKey(undefined);
      void api<IntegrationKey&{agent_id:string}>(`/v2/keys/${selected.id}`).then(data=>{if(active){setDetailKey(data);setKeyForm(current=>({...current,agentId:data.agent_id}));void refreshKeys(data.agent_id).catch(()=>{});}}).catch(()=>{if(active)setNotice('Key details unavailable.');});
    }
    if(view==='activity') {setActivityDetail(undefined);void api<Activity>(`/v2/activity/${selected.id}`).then(data=>{if(active)setActivityDetail(data);}).catch(()=>{if(active)setNotice('Request unavailable.');});}
    return()=>{active=false;};
  },[view,selected?.id,controlStatus]);
  const choose = (next: View, id?:string) => { window.history.pushState(null,'',`/app/${next}${id?`/${id}`:''}`);setView(next); setSelected(id?{id}:undefined);setDetailEditing(false);setMenuOpen(false);setNotice('');window.scrollTo({top:0}); };
  const showDetail=Boolean(selected&&!detailEditing&&['agents','grants','policies','endpoints','keys','approvals','activity'].includes(view));
  const withReview = (title: string, summary: string[], action: () => Promise<void>) =>
    setReview({ title, summary, action });
  const confirm = () => {
    if (!review) return;
    const action = review.action;
    setReview(undefined);
    void run(action);
  };
  const agentDetail=agents.find(item=>item.id===selected?.id);
  const grantDetail=grants.find(item=>item.id===selected?.id);
  const policyDetail=policies.find(item=>item.id===selected?.id);
  const serviceDetail=services.find(item=>item.id===selected?.id);
  const endpointDetail=endpoints.find(item=>item.id===selected?.id);
  const selectedAgent = agents.find(item => item.id === keyForm.agentId);
  const activeServices = services.filter(item => item.status === 'active');
  const apiBase = apiOrigin?.replace(/\/$/, '') ?? 'https://YOUR_PACT_API';
  const gatewayBase = gatewayOrigin?.replace(/\/$/, '') ?? 'https://YOUR_PACT_GATEWAY';
  const exampleAgent = selectedAgent ?? agents[0];
  const exampleService = services.find(service=>service.agent_id===exampleAgent?.id);
  const exampleEndpoint = endpoints.find(endpoint=>endpoint.service_id===exampleService?.id && endpoint.method==='GET');
  const proxyUrl = exampleService && exampleAgent ?
    `${gatewayBase}/v2/proxy/${exampleAgent.id}/${exampleService.id}${exampleEndpoint?.path_pattern ?? '/health'}` :
    `${gatewayBase}/v2/proxy/AGENT_ID/SERVICE_ID/health`;
  return <div className={`cpShell ${sidebarCollapsed ? 'cpCollapsed' : ''}`}>
    <aside className={`cpSidebar ${menuOpen ? 'open' : ''}`}><div className="cpBrand"><Brand/><button className="cpClose" onClick={() => setMenuOpen(false)} aria-label="Close menu">×</button></div>
      <div className="cpWorkspaceIdentity"><span className="cpWorkspaceAvatar">P</span><div className="cpWorkspaceIdentityText">Pact workspace<small><i className="cpStatusDot"/> {activeNetwork.name}</small></div><span className="cpWorkspaceVersion">01</span></div>
      <span className="cpNavLabel">WORKSPACE</span><nav id="pact-console-nav" aria-label="Console navigation">{nav.map(item =>
        <a key={item.id} href={`/app/${item.id}`} className={view === item.id ? 'active' : ''} onClick={event => {event.preventDefault();choose(item.id);}}
          aria-current={view === item.id ? 'page' : undefined} aria-label={item.label}
          title={sidebarCollapsed ? item.label : undefined}><Icon name={item.icon} size={18}/><span className="cpNavText">{item.label}</span>
          {item.id === 'approvals' && approvals.filter(value => value.state === 'pending').length > 0 &&
            <em>{approvals.filter(value => value.state === 'pending').length}</em>}</a>)}</nav>
      <div className="cpSidebarFoot"><a href="/docs" aria-label="Developer docs" title={sidebarCollapsed ? 'Developer docs' : undefined}><Icon name="book" size={17}/><span className="cpFootText">Developer docs</span><Icon name="external" size={13}/></a>
        <a href="/explorer" aria-label="Public Explorer" title={sidebarCollapsed ? 'Public Explorer' : undefined}><Icon name="globe" size={17}/><span className="cpFootText">Public Explorer</span><Icon name="external" size={13}/></a>
        <a href="/legacy" aria-label="Existing Monad grants" title={sidebarCollapsed ? 'Existing Monad grants' : undefined}><Icon name="shield" size={17}/><span className="cpFootText">Existing Monad grants</span><Icon name="external" size={13}/></a>
        <div className="cpSidebarAccount" title={sidebarCollapsed ? (account?.principalAddress ?? 'Pact account') : undefined}><span><Icon name="wallet" size={18}/></span><div className="cpAccountText">{account?.principalAddress ? short(account.principalAddress) : 'Pact account'}<small>{account?.verificationStatus === 'verified' ? 'Verified signing address' : account?.verificationStatus === 'account_assigned' ? 'Account owned' : authenticated ? 'Account setup' : 'Sign in to get started'}</small></div></div>
      </div></aside>
    {menuOpen && <button className="cpBackdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)}/>}
    <div className="cpMain"><header className="cpTopbar"><button className="cpMenu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Icon name="menu"/></button>
      <button className="cpSidebarToggle" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-controls="pact-console-nav" aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed(value => !value)}><Icon name="panel" size={18}/></button>
      <span>PACT <b>/</b> {nav.find(item => item.id === view)?.label}</span><div className="cpTopActions"><span className="cpLive"><i/> CONTROL PLANE</span>
      {authenticated ? <button onClick={() => void logout()}>Sign out</button> : <button className="cpPrimary" onClick={() => login()}>Sign in</button>}</div></header>
      <main className="cpContent"><div className="cpPageHead"><div><span className="cpEyebrow">PACT / {view.toUpperCase()}</span>
        <h1>{view === 'overview' ? 'Overview' : nav.find(item => item.id === view)?.label}</h1>
        <p>{view === 'overview' ? 'Your agents, authority and activity.' :
          view === 'account' ? 'Identity, signing and recovery.' :
          view === 'activity' ? 'Live decisions · private gateway records.' :
          ''}</p></div>
        {authenticated && account?.principalAddress && <div className="cpPrincipalBadge"><small>YOUR PRINCIPAL ADDRESS</small><code title={account.principalAddress}>{short(account.principalAddress)}</code><span>{account.verificationStatus}</span></div>}</div>
      {notice && <div className="cpNotice" role="status">{notice}<button disabled={busy} onClick={()=>void run(refresh)}>Retry loading</button><button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
        {newSecret && <div className="cpSecret" role="alert"><strong>Copy this key now</strong><code>{newSecret}</code><Copy text={newSecret} label="Copy key"/><button onClick={()=>setNewSecret('')}>I saved it</button></div>}
      {authenticated && view==='account' && <><AccountSecurity key={user?.id}/><PaymentHistory key={`payments:${user?.id}:${paymentRevision}`} api={rawApi} onResume={existing=>setPaymentTask({path:existing.path,body:existing.payload,existing,resolve:value=>{if(typeof value.secret==='string'){setNewSecret(value.secret);setNotice('Key issued. Copy it now.');}else setNotice('Paid action completed.');void refresh();},reject:cause=>setNotice(cause.message)})}/></>}
      {!ready && <p className="cpLoading">Loading account…</p>}
      {ready && !authenticated && <section className="cpHeroPanel"><span className="cpEyebrow">YOUR AGENT WORKSPACE</span><h2>Start with your account.</h2>
        <p>Email, passkey or wallet. HTTP agents need no wallet.</p>
        <button className="cpPrimary" onClick={() => login()}>Create account or sign in <Icon name="arrow" size={16}/></button></section>}
      {authenticated && controlStatus === 'loading' && <section className="cpHeroPanel" role="status"><span className="cpEyebrow">CONNECTING</span><h2>Loading your workspace.</h2><p>Connecting to Pact.</p></section>}
      {authenticated && controlStatus === 'unavailable' && <section className="cpHeroPanel" role="alert"><span className="cpEyebrow">SERVICE UNAVAILABLE</span><h2>{nav.find(item => item.id === view)?.label} cannot load yet.</h2>
        <p>{controlError} Retry when the API is available.</p>
        <button className="cpPrimary" onClick={() => setConnectionAttempt(value => value + 1)}>Retry connection</button>
        <p><a href="/legacy">Open existing Monad grants ↗</a></p></section>}
      {authenticated && controlStatus === 'ready' && account?.verificationStatus === 'unverified' && <section className="cpCard" role="status"><span className="cpEyebrow">ACCOUNT SETUP</span><h2>Your account address is being assigned.</h2><p>Agent and HTTP grant management will be available when this finishes.</p><button onClick={() => setConnectionAttempt(value => value + 1)}>Retry account setup</button></section>}
      {authenticated && controlStatus === 'ready' && account && <>
      {view === 'overview' && <Dashboard agents={agents} grants={grants} policies={policies} endpoints={endpoints} approvals={approvals} data={dashboard} error={dashboardError} navigate={choose} retry={()=>void run(refresh)}/>}
      {view === 'verification' && <VerificationPanel feesEnabled={feeConfig?.enabled} control={api} onComplete={refresh}/>}
      {showDetail && selected && <ResourceDetail view={view} id={selected.id} agents={agents} grants={grants} policies={policies} services={services} endpoints={endpoints} keys={view==='keys'&&detailKey?[detailKey]:keys} approvals={approvals} agentActivity={agentActivity} activity={activityDetail?.id===selected.id?activityDetail:undefined} data={dashboard} navigate={choose} manage={()=>{setDetailEditing(true);if(view==='endpoints'&&endpointDetail)setResponseFieldsDraft(endpointDetail.response_fields.join(', '));if(view==='agents'&&agentDetail){setEditAgentId(agentDetail.id);setAgentForm({name:agentDetail.name,environment:agentDetail.environment,description:agentDetail.description});}}}/>}
      {!showDetail && <>

      {view === 'agents' && <div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">01 / IDENTITY</span><h2>{editAgentId?'Edit agent':'Register an agent'}</h2><p>Register a runtime. Add authority with a grant.</p>
        <Field label="Agent name" hint="Example: Support assistant"><input value={agentForm.name} onChange={e => setAgentForm({ ...agentForm, name: e.target.value })} placeholder="Support assistant"/></Field>
        <Field label="Environment"><select value={agentForm.environment} onChange={e => setAgentForm({ ...agentForm, environment: e.target.value })}><option value="development">Development</option><option value="staging">Staging</option><option value="production">Production</option></select></Field>
        <Field label="Description"><textarea value={agentForm.description} onChange={e => setAgentForm({ ...agentForm, description: e.target.value })} placeholder="What this agent does"/></Field>
        <button className="cpPrimary" disabled={busy || agentForm.name.trim().length < 2} onClick={() => withReview(editAgentId?'Edit agent':'Register agent', [agentForm.name, `Environment: ${agentForm.environment}`, agentForm.description || 'No description'], async () => {
          await api(editAgentId?`/v2/agents/${editAgentId}`:'/v2/agents',agentForm,editAgentId?'PATCH':'POST');setEditAgentId(''); setAgentForm({ ...agentForm, name: '', description: '' });
          await refresh(); setNotice('Agent saved.');
        })}>Review agent <Icon name="arrow" size={15}/></button>{editAgentId && <button onClick={()=>setEditAgentId('')}>Cancel edit</button>}</section>
        <section className="cpCard"><div className="cpCardHead"><span className="cpEyebrow">DIRECTORY</span><h2>Your agents</h2></div>{agents.length ? agents.map(item =>
          <div className="cpListRow" key={item.id}><span className="cpAvatar"><Icon name="agent" size={18}/></span><div><strong>{item.name}</strong><small>{item.environment} · {item.status}</small></div><button onClick={() => setSelected(item)}>View</button></div>) : <Empty title="No agents yet" detail="Register your first agent."/>}
          {agentDetail && <div className="cpDetail"><h3>{agentDetail.name}</h3><p>{agentDetail.description || 'No description'}</p><code>{agentDetail.id}</code><button onClick={()=>{setEditAgentId(agentDetail.id);setAgentForm({name:agentDetail.name,environment:agentDetail.environment,description:agentDetail.description});}}>Edit details</button><div className="cpActions"><button onClick={() => void run(async () => { await api(`/v2/agents/${agentDetail.id}`, { status: agentDetail.status === 'active' ? 'disabled' : 'active' }, 'PATCH'); await refresh(); setSelected(undefined); })}>{agentDetail.status === 'active' ? 'Disable agent' : 'Enable agent'}</button></div></div>}</section></div>}

      {view === 'grants' && <div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">02 / OWNER AUTHORITY</span><h2>{editGrantId?'Narrow an HTTP grant':'Create an HTTP grant'}</h2><p>HTTP authority. Onchain spending requires separate authorization.</p>
        <Field label="Agent"><select disabled={!!editGrantId} value={grantForm.agentId} onChange={e => setGrantForm({ ...grantForm, agentId: e.target.value })}><option value="">Select agent</option>{agents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Grant name"><input disabled={!!editGrantId} value={grantForm.name} onChange={e => setGrantForm({ ...grantForm, name: e.target.value })}/></Field>
        <Field label="Permitted service origin" hint="Exact HTTPS origin"><select value={grantForm.origin} onChange={e => setGrantForm({ ...grantForm, origin: e.target.value })}><option value="">Select registered service</option>{services.filter(item => item.agent_id === grantForm.agentId).map(item => <option key={item.id} value={item.base_url}>{item.name} · {item.base_url}</option>)}</select></Field>
        <Field label="Allowed recipients" hint="Exact IDs, comma separated. Required for payments."><input value={grantForm.recipients} onChange={e=>setGrantForm({...grantForm,recipients:e.target.value})}/></Field>
        <Field label="Allowed HTTP actions"><div className="cpChecks">{['GET','POST','PUT','PATCH','DELETE'].map(method => <label key={method}><input type="checkbox" checked={grantForm.actions.includes(method)} onChange={e => setGrantForm({ ...grantForm, actions: e.target.checked ? [...grantForm.actions,method] : grantForm.actions.filter(value => value !== method) })}/>{method}</label>)}</div></Field>
        <div className="cpGrid3"><Field label="Currency"><input value={grantForm.currency} maxLength={12} onChange={e => setGrantForm({ ...grantForm, currency: e.target.value.toUpperCase() })}/></Field>
          <Field label="Per action limit" hint="Minor units; 0 = free calls only"><input inputMode="numeric" value={grantForm.perActionLimitMinor} onChange={e => setGrantForm({ ...grantForm, perActionLimitMinor: e.target.value })}/></Field>
          <Field label="Aggregate limit" hint="Minor units"><input inputMode="numeric" value={grantForm.aggregateLimitMinor} onChange={e => setGrantForm({ ...grantForm, aggregateLimitMinor: e.target.value })}/></Field></div>
        <Field label="Approval above" hint="Minor units; larger amounts require approval"><input inputMode="numeric" value={grantForm.approvalThresholdMinor} onChange={e => setGrantForm({ ...grantForm, approvalThresholdMinor: e.target.value })}/></Field>
        <div className="cpGrid2"><Field label="Starts at"><input disabled={!!editGrantId} type="datetime-local" value={localDateTime(grantForm.startsAt)} onChange={e => { if(e.target.value) setGrantForm({ ...grantForm, startsAt: new Date(e.target.value).toISOString() }); }}/></Field>
          <Field label="Expires at"><input type="datetime-local" value={localDateTime(grantForm.expiresAt)} onChange={e => { if(e.target.value) setGrantForm({ ...grantForm, expiresAt: new Date(e.target.value).toISOString() }); }}/></Field></div>
        <button className="cpPrimary" disabled={busy || (!editGrantId && !account.principalAddress) || !grantForm.agentId || !grantForm.origin || !grantForm.actions.length} onClick={() => withReview(editGrantId?'Narrow HTTP grant':'Create HTTP grant', [
          `Owner: ${account.principalAddress}`, `Agent: ${agents.find(item => item.id === grantForm.agentId)?.name}`,
          `Actions: ${grantForm.actions.join(', ')}`, `Origin and destination: ${grantForm.origin}`,
          `Allowed recipients: ${grantForm.recipients || "None (fixed cost only)"}`,
          `Per action: ${moneyLabel(grantForm.perActionLimitMinor, grantForm.currency)}`,
          `Aggregate: ${moneyLabel(grantForm.aggregateLimitMinor, grantForm.currency)}`,
          `Approval above: ${moneyLabel(grantForm.approvalThresholdMinor, grantForm.currency)}`,
          `Window: ${grantForm.startsAt} to ${grantForm.expiresAt}`,
        ], async () => { if(editGrantId) await api(`/v2/grants/${editGrantId}`,{
          resourceOrigins:[grantForm.origin],destinationOrigins:[grantForm.origin],actions:grantForm.actions,
          allowedRecipients:grantForm.recipients.split(',').map(v=>v.trim()).filter(Boolean),
          perActionLimitMinor:grantForm.perActionLimitMinor,aggregateLimitMinor:grantForm.aggregateLimitMinor,
          approvalThresholdMinor:grantForm.approvalThresholdMinor,expiresAt:grantForm.expiresAt },'PATCH');
          else await api('/v2/grants', { agentId: grantForm.agentId, name: grantForm.name,
          resourceOrigins: [grantForm.origin], destinationOrigins: [grantForm.origin],
          actions: grantForm.actions, currency: grantForm.currency,
          allowedRecipients:grantForm.recipients.split(',').map(v=>v.trim()).filter(Boolean),
          perActionLimitMinor: grantForm.perActionLimitMinor,
          aggregateLimitMinor: grantForm.aggregateLimitMinor,
          approvalThresholdMinor: grantForm.approvalThresholdMinor,
          startsAt: grantForm.startsAt, expiresAt: grantForm.expiresAt });
          setEditGrantId('');await refresh(); setNotice('Grant saved.');
        })}>Review grant <Icon name="arrow" size={15}/></button>{editGrantId && <button onClick={()=>setEditGrantId('')}>Cancel edit</button>}</section>
        <section className="cpCard"><span className="cpEyebrow">ISSUED AUTHORITY</span><h2>Grants</h2>{grants.length ? grants.map(item =>
          <div className="cpListRow" key={item.id}><span className="cpAvatar"><Icon name="shield" size={18}/></span><div><strong>{item.name}</strong><small>{item.actions?.join(', ')} · {item.status}</small></div><button onClick={() => setSelected(item)}>Inspect</button></div>) : <Empty title="No HTTP grants" detail="Create a grant for a registered service."/>}
          {grantDetail && <div className="cpDetail"><h3>{grantDetail.name}</h3><p>Owner: <code>{grantDetail.principal_address}</code></p><p>Actions: {grantDetail.actions?.join(', ')}</p><p>Destination: {grantDetail.destination_origins?.join(', ')}</p><p>Limit: {moneyLabel(grantDetail.per_action_limit_minor, grantDetail.currency)} per action; {moneyLabel(grantDetail.aggregate_limit_minor, grantDetail.currency)} aggregate.</p><p>Spent: {grantDetail.spent_minor ?? '0'} minor units</p><p>Expires: {new Date(grantDetail.expires_at).toLocaleString()}</p><p>Status: {grantDetail.status}</p>
          {grantDetail.status === 'active' && <button onClick={()=>{setEditGrantId(grantDetail.id);setGrantForm({agentId:grantDetail.agent_id,name:grantDetail.name,
            origin:grantDetail.resource_origins[0],recipients:(grantDetail.allowed_recipients??[]).join(', '),actions:grantDetail.actions,currency:grantDetail.currency,
            perActionLimitMinor:grantDetail.per_action_limit_minor,aggregateLimitMinor:grantDetail.aggregate_limit_minor,
            approvalThresholdMinor:grantDetail.approval_threshold_minor,startsAt:grantDetail.starts_at,expiresAt:grantDetail.expires_at});}}>Narrow grant</button>}
          {grantDetail.status === 'active' && account.principalAddress &&
            grantDetail.principal_address?.toLowerCase() !== account.principalAddress?.toLowerCase() &&
            <button onClick={()=>withReview('Migrate HTTP grant',[
              `Original principal: ${grantDetail.principal_address}`,`Current principal: ${account.principalAddress}`,
              'Pact will copy the grant bounds and spent budget, move its endpoints, and revoke the old grant in one transaction.'
            ],async()=>{await api(`/v2/grants/${grantDetail.id}/migrate`,{});await refresh();setSelected(undefined);setNotice('HTTP grant migrated. Original grant remains in audit history.');})}>Migrate to current principal</button>}
          {grantDetail.status === 'active' && <button className="cpDanger" onClick={() => withReview('Revoke grant', ['All operations bound to this grant will be denied immediately.', grantDetail.id], async () => {
            await api(`/v2/grants/${grantDetail.id}`, { status: 'revoked' }, 'PATCH'); await refresh(); setSelected(undefined);
          })}>Revoke grant</button>}</div>}</section></div>}

      {view === 'policies' && <div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">03 / ORDERED DECISIONS</span><h2>{editPolicyId?'Edit ordered policy':'Create a policy'}</h2><p>First match wins. No match denies.</p>
        <Field label="Agent"><select disabled={!!editPolicyId} value={policyForm.agentId} onChange={e => setPolicyForm({ ...policyForm, agentId: e.target.value })}><option value="">Select agent</option>{agents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Policy name"><input value={policyForm.name} onChange={e => setPolicyForm({ ...policyForm, name: e.target.value })}/></Field>
        {policyForm.rules.map((rule, index) => <div className="cpRule" key={`${rule.id}-${index}`}><div className="cpRuleHead"><strong>Rule {index+1}</strong><div><button onClick={() => { const next = [...policyForm.rules]; if (index > 0) { [next[index-1],next[index]] = [next[index]!,next[index-1]!]; setPolicyForm({ ...policyForm, rules: next }); } }} disabled={index===0}>↑</button><button onClick={() => { const next = [...policyForm.rules]; if (index < next.length-1) { [next[index],next[index+1]] = [next[index+1]!,next[index]!]; setPolicyForm({ ...policyForm, rules: next }); } }} disabled={index===policyForm.rules.length-1}>↓</button><button onClick={() => setPolicyForm({ ...policyForm, rules: policyForm.rules.filter((_,i) => i!==index) })} disabled={policyForm.rules.length===1}>Remove</button></div></div>
          <Field label="Rule ID"><input value={rule.id} onChange={e => setPolicyForm({ ...policyForm, rules: policyForm.rules.map((item,i) => i===index ? { ...item,id:e.target.value } : item) })}/></Field>
          <Field label="Rule name"><input value={rule.name} onChange={e => setPolicyForm({ ...policyForm, rules: policyForm.rules.map((item,i) => i===index ? { ...item,name:e.target.value } : item) })}/></Field>
          <Field label="Decision"><select value={rule.effect} onChange={e => setPolicyForm({ ...policyForm, rules: policyForm.rules.map((item,i) => i===index ? { ...item,effect:e.target.value } : item) })}><option value="allow">Allow</option><option value="deny">Deny</option><option value="approval">Require approval</option></select></Field>
          <Field label="HTTP methods"><div className="cpChecks">{['GET','POST','PUT','PATCH','DELETE'].map(method => <label key={method}><input type="checkbox" checked={rule.methods.includes(method)} onChange={e => setPolicyForm({ ...policyForm, rules: policyForm.rules.map((item,i) => i===index ? { ...item,methods:e.target.checked ? [...item.methods,method] : item.methods.filter(value=>value!==method) } : item) })}/>{method}</label>)}</div></Field>
          <Field label="Path patterns" hint="Comma separated; /health, /v1/items/:id, /v1/*"><input value={rule.paths.join(', ')} onChange={e => setPolicyForm({ ...policyForm, rules: policyForm.rules.map((item,i) => i===index ? { ...item, paths:e.target.value.split(',').map(value=>value.trim()).filter(Boolean) } : item) })}/></Field>
          <Field label="Upstream destination"><select value={rule.destinations[0]} onChange={e => setPolicyForm({ ...policyForm, rules: policyForm.rules.map((item,i) => i===index ? { ...item,destinations:[e.target.value] } : item) })}><option value="">Select registered service</option>{services.filter(item=>item.agent_id===policyForm.agentId).map(item=><option key={item.id} value={item.base_url}>{item.name} · {item.base_url}</option>)}</select></Field>
          <div className="cpGrid2"><Field label="Rate: requests"><input type="number" min="1" value={rule.maxRequests} onChange={e => setPolicyForm({ ...policyForm, rules: policyForm.rules.map((item,i) => i===index ? { ...item,maxRequests:Number(e.target.value) } : item) })}/></Field><Field label="Per seconds"><input type="number" min="60" value={rule.periodSeconds} onChange={e => setPolicyForm({ ...policyForm, rules: policyForm.rules.map((item,i) => i===index ? { ...item,periodSeconds:Number(e.target.value) } : item) })}/></Field></div>
          <div className="cpGrid2"><Field label="Spending cap, minor units" hint="Blank means grant limit only"><input inputMode="numeric" value={rule.maxSpendMinor} onChange={e => setPolicyForm({ ...policyForm, rules: policyForm.rules.map((item,i) => i===index ? { ...item,maxSpendMinor:e.target.value } : item) })}/></Field><Field label="Currency"><input value={rule.currency} onChange={e => setPolicyForm({ ...policyForm, rules: policyForm.rules.map((item,i) => i===index ? { ...item,currency:e.target.value.toUpperCase() } : item) })}/></Field></div>
          <div className="cpGrid2"><Field label="UTC start hour (optional)"><input type="number" min="0" max="23" value={rule.startHour} onChange={e => setPolicyForm({ ...policyForm, rules: policyForm.rules.map((item,i) => i===index ? { ...item,startHour:e.target.value } : item) })}/></Field><Field label="UTC end hour (optional)"><input type="number" min="1" max="24" value={rule.endHour} onChange={e => setPolicyForm({ ...policyForm, rules: policyForm.rules.map((item,i) => i===index ? { ...item,endHour:e.target.value } : item) })}/></Field></div>
        </div>)}
        <button onClick={() => setPolicyForm({ ...policyForm, rules:[...policyForm.rules,{ id:`rule_${policyForm.rules.length+1}`,name:'New rule',effect:'deny',methods:['GET'],paths:['/health'],destinations:[''],maxRequests:60,periodSeconds:60,maxSpendMinor:'',currency:'USD',startHour:'',endHour:'' }] })}>Add ordered rule</button>
        <button className="cpPrimary" disabled={busy || !policyForm.agentId} onClick={() => {
          const payload = { agentId:policyForm.agentId,name:policyForm.name,rules:policyForm.rules.map(rule=>({
            id:rule.id,name:rule.name,effect:rule.effect,methods:rule.methods,paths:rule.paths,
            destinations:rule.destinations,maxRequests:rule.maxRequests,periodSeconds:rule.periodSeconds,
            ...(rule.maxSpendMinor ? { maxSpendMinor:rule.maxSpendMinor,currency:rule.currency } : {}),
            ...(rule.startHour !== '' && rule.endHour !== '' ? { windowUtc:{ startHour:Number(rule.startHour),endHour:Number(rule.endHour) } } : {}),
          })) };
          withReview(editPolicyId?'Update ordered policy':'Create ordered policy', [policyForm.name, ...payload.rules.map((rule,i)=>`${i+1}. ${rule.name}: ${rule.effect} ${rule.methods.join(',')} ${rule.paths.join(',')} → ${rule.destinations.join(',')}`)], async () => {
            if(editPolicyId) await api(`/v2/policies/${editPolicyId}`,{name:payload.name,rules:payload.rules},'PATCH');
            else await api('/v2/policies',payload);
            setEditPolicyId('');await refresh(); setNotice('Policy saved. Requests use the new rule order immediately.');
          });
        }}>Review policy <Icon name="arrow" size={15}/></button>{editPolicyId && <button onClick={()=>setEditPolicyId('')}>Cancel edit</button>}</section>
        <section className="cpCard"><span className="cpEyebrow">POLICY LIBRARY</span><h2>Policies</h2>{policies.length ? policies.map(item => <div className="cpListRow" key={item.id}><span className="cpAvatar"><Icon name="layers" size={18}/></span><div><strong>{item.name}</strong><small>{item.rules?.length} rules · v{item.version} · {item.status}</small></div><button onClick={() => setSelected(item)}>Inspect</button></div>) : <Empty title="No policies" detail="Add an ordered rule so Pact can evaluate each proposed call."/>}
        {policyDetail && <div className="cpDetail"><h3>{policyDetail.name}</h3>{policyDetail.rules?.map((rule,i:number)=><p key={rule.id}>{i+1}. <b>{rule.name}</b> · {rule.effect} · {rule.methods?.join(', ')} · {rule.paths?.join(', ')}</p>)}<button onClick={()=>{setEditPolicyId(policyDetail.id);setPolicyForm({agentId:policyDetail.agent_id,name:policyDetail.name,rules:policyDetail.rules.map((rule)=>({
          id:rule.id,name:rule.name,effect:rule.effect,methods:rule.methods,paths:rule.paths,
          destinations:rule.destinations,maxRequests:rule.maxRequests??60,periodSeconds:rule.periodSeconds??60,
          maxSpendMinor:rule.maxSpendMinor??'',currency:rule.currency??'USD',
          startHour:rule.windowUtc?.startHour?.toString()??'',endHour:rule.windowUtc?.endHour?.toString()??''}))});}}>Edit rules</button><button className="cpDanger" onClick={()=>withReview('Disable policy',[`All linked endpoints will deny requests.`,policyDetail.name],async()=>{await api(`/v2/policies/${policyDetail.id}`,{status:'disabled'},'PATCH');await refresh();setSelected(undefined);})} disabled={policyDetail.status==='disabled'}>Disable policy</button></div>}</section></div>}

      {view === 'endpoints' && <><div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">02 / UPSTREAM</span><h2>Register a service</h2><p>Register the upstream. Agents call Pact.</p>
        <Field label="Agent"><select value={serviceForm.agentId} onChange={e=>setServiceForm({...serviceForm,agentId:e.target.value})}><option value="">Select agent</option>{agents.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Service name"><input value={serviceForm.name} onChange={e=>setServiceForm({...serviceForm,name:e.target.value})} placeholder="Orders API"/></Field>
        <Field label="Base URL" hint="HTTPS origin, e.g. https://api.example.com"><input value={serviceForm.baseUrl} onChange={e=>setServiceForm({...serviceForm,baseUrl:e.target.value})} placeholder="https://api.example.com"/></Field>
        <Field label="Upstream authentication"><select value={serviceForm.authMethod} onChange={e=>setServiceForm({...serviceForm,authMethod:e.target.value})}><option value="none">No credential</option><option value="bearer">Bearer token</option><option value="header">Custom header</option></select></Field>
        {serviceForm.authMethod==='header' && <Field label="Header name"><input value={serviceForm.authHeader} onChange={e=>setServiceForm({...serviceForm,authHeader:e.target.value})} placeholder="X-API-Key"/></Field>}
        {serviceForm.authMethod!=='none' && <Field label="Upstream secret" hint="Encrypted. Hidden from agents."><input type="password" autoComplete="off" value={serviceForm.secret} onChange={e=>setServiceForm({...serviceForm,secret:e.target.value})}/></Field>}
        <button className="cpPrimary" disabled={busy || !serviceForm.agentId || !serviceForm.baseUrl || !serviceForm.name} onClick={()=>withReview('Register service',[
          `Agent: ${agents.find(item=>item.id===serviceForm.agentId)?.name}`,`Upstream: ${serviceForm.baseUrl}`,
          `Credential: ${serviceForm.authMethod==='none'?'none':`${serviceForm.authMethod} (stored encrypted)`}`],async()=>{
          const created=await api<Service>('/v2/services',{agentId:serviceForm.agentId,name:serviceForm.name,baseUrl:serviceForm.baseUrl,
            authMethod:serviceForm.authMethod,...(serviceForm.authMethod==='header'?{authHeader:serviceForm.authHeader}:{})});
          try {if(serviceForm.authMethod!=='none') await api(`/v2/services/${created.id}/secret`,{secret:serviceForm.secret},'PUT');}
          catch {setServiceForm({...serviceForm,name:'',baseUrl:'',secret:''});await refresh();setSelected(created);throw Error('Service registered; credential setup failed. Select the service below and save a replacement credential.');}
          setServiceForm({...serviceForm,name:'',baseUrl:'',secret:''});await refresh();setNotice('Service connected.');
        })}>Review service <Icon name="arrow" size={15}/></button></section>
        <section className="cpCard"><span className="cpEyebrow">UPSTREAM SERVICES</span><h2>Manage services</h2>
          {services.length ? services.map(item => <div className="cpListRow" key={item.id}><span className="cpAvatar"><Icon name="globe" size={18}/></span><div><strong>{item.name}</strong><small>{item.base_url} · {item.auth_method} · {item.status} · credential {item.has_secret ? 'stored' : 'missing'}</small></div><button onClick={()=>{setSelected(item);setReplacementSecret('');}}>Manage</button></div>) : <Empty title="No services" detail="Add an upstream service."/>}
          {serviceDetail && <div className="cpDetail"><h3>{serviceDetail.name}</h3><p>Agent: {agents.find(item=>item.id===serviceDetail.agent_id)?.name ?? serviceDetail.agent_id}</p><p>Base URL: <code>{serviceDetail.base_url}</code></p><p>Authentication: {serviceDetail.auth_method}{serviceDetail.auth_header ? ` · ${serviceDetail.auth_header}` : ''}</p><p>Status: {serviceDetail.status}</p>
            <button onClick={()=>withReview(serviceDetail.status==='active'?'Disable service':'Enable service',[serviceDetail.name,serviceDetail.base_url],async()=>{await api(`/v2/services/${serviceDetail.id}`,{status:serviceDetail.status==='active'?'disabled':'active'},'PATCH');await refresh();setSelected(undefined);})}>{serviceDetail.status==='active'?'Disable service':'Enable service'}</button>
            {serviceDetail.auth_method!=='none' && <><Field label="Replacement upstream secret"><input type="password" autoComplete="off" value={replacementSecret} onChange={e=>setReplacementSecret(e.target.value)}/></Field><button disabled={replacementSecret.length<8} onClick={()=>withReview('Rotate upstream credential',[`Service: ${serviceDetail.name}`,'The prior credential stops being used immediately.'],async()=>{await api(`/v2/services/${serviceDetail.id}/secret`,{secret:replacementSecret},'PUT');setReplacementSecret('');await refresh();setSelected(undefined);})}>Rotate credential</button><button className="cpDanger" onClick={()=>withReview('Revoke upstream credential',[`Service: ${serviceDetail.name}`,'Authenticated calls will fail until a replacement is stored.'],async()=>{await api(`/v2/services/${serviceDetail.id}/secret`,undefined,'DELETE');await refresh();setSelected(undefined);})}>Revoke credential</button></>}
          </div>}</section>
        <section className="cpCard"><span className="cpEyebrow">04 / OPERATION</span><h2>Register an endpoint</h2><p>Bind a route to its grant and policy.</p>
          <Field label="Service"><select value={endpointForm.serviceId} onChange={e=>{setEndpointForm({...endpointForm,serviceId:e.target.value});setOpenApiPreview(undefined);}}><option value="">Select service</option>{activeServices.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <div className="cpGrid2"><Field label="HTTP method"><select value={endpointForm.method} onChange={e=>setEndpointForm({...endpointForm,method:e.target.value})}>{['GET','POST','PUT','PATCH','DELETE'].map(value=><option key={value}>{value}</option>)}</select></Field><Field label="Route pattern"><input value={endpointForm.pathPattern} onChange={e=>setEndpointForm({...endpointForm,pathPattern:e.target.value})} placeholder="/health"/></Field></div>
          <Field label="Description"><input value={endpointForm.description} onChange={e=>setEndpointForm({...endpointForm,description:e.target.value})} placeholder="Read health status"/></Field>
          <div className="cpGrid2"><Field label="Grant"><select value={endpointForm.grantId} onChange={e=>{setEndpointForm({...endpointForm,grantId:e.target.value});setOpenApiPreview(undefined);}}><option value="">Select grant</option>{grants.filter(item=>item.status==='active').map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Policy"><select value={endpointForm.policyId} onChange={e=>{setEndpointForm({...endpointForm,policyId:e.target.value});setOpenApiPreview(undefined);}}><option value="">Select policy</option>{policies.filter(item=>item.status==='active').map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div>
          <div className="cpGrid2"><Field label="Fixed cost, minor units" hint="0 for free operations"><input inputMode="numeric" value={endpointForm.costMinor} onChange={e=>setEndpointForm({...endpointForm,costMinor:e.target.value})}/></Field><Field label="Currency"><input value={endpointForm.currency} onChange={e=>{setEndpointForm({...endpointForm,currency:e.target.value.toUpperCase()});setOpenApiPreview(undefined);}}/></Field></div>
          <fieldset><legend>Request spending constraints</legend><p>Map payment fields to enforce amounts and recipients. Use string amounts in minor units.</p>
          <Field label="Amount field path" hint="Example: payment.amountMinor"><input value={endpointForm.amountPath} onChange={e=>setEndpointForm({...endpointForm,amountPath:e.target.value})}/></Field>
          <Field label="Currency field path" hint="Example: payment.currency"><input value={endpointForm.currencyPath} onChange={e=>setEndpointForm({...endpointForm,currencyPath:e.target.value})}/></Field>
          <Field label="Recipient field path" hint="Example: payment.recipient"><input value={endpointForm.recipientPath} onChange={e=>setEndpointForm({...endpointForm,recipientPath:e.target.value})}/></Field></fieldset>
          <Field label="Returned JSON fields" hint="Allowed response fields. Empty returns no body."><input value={endpointForm.responseFields.join(', ')} onChange={e=>setEndpointForm({...endpointForm,responseFields:e.target.value.split(',').map(value=>value.trim()).filter(Boolean)})}/></Field>
          <button className="cpPrimary" disabled={busy || !endpointForm.serviceId || !endpointForm.grantId || !endpointForm.policyId} onClick={()=>withReview('Register operation',[
            `${endpointForm.method} ${endpointForm.pathPattern}`,`Service: ${services.find(item=>item.id===endpointForm.serviceId)?.name}`,
            `Grant: ${grants.find(item=>item.id===endpointForm.grantId)?.name}`,`Policy: ${policies.find(item=>item.id===endpointForm.policyId)?.name}`,
            `Cost: ${moneyLabel(endpointForm.costMinor,endpointForm.currency)}`],async()=>{const {amountPath,currencyPath,recipientPath,...operation}=endpointForm;await api('/v2/endpoints',{...operation,...(amountPath||currencyPath||recipientPath ? {economicConstraints:{amountPath,currencyPath,recipientPath}} : {})});await refresh();setNotice('Endpoint registered. Issue a scoped API key to call it.');})}>Review endpoint <Icon name="arrow" size={15}/></button>
        </section></div>
        <div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">OPENAPI IMPORT</span><h2>Import operations</h2><p>Paste an OpenAPI 3 JSON document.</p><details><summary>Supported imports</summary><p>First server, base path and local references. Set authentication separately. Remote references, per-operation servers and request-schema enforcement are not supported.</p></details>
          <textarea className="cpCodeInput" value={openApi} onChange={e=>{setOpenApi(e.target.value);setOpenApiPreview(undefined);}} placeholder='{"openapi":"3.0.0","info":{"title":"Demo"},"servers":[{"url":"https://api.example.com"}],"paths":{"/health":{"get":{"summary":"Health"}}}}'/>
          <div className="cpActions"><button onClick={()=>void run(async()=>setOpenApiPreview(await api<OpenApiPreview>('/v2/openapi/preview',{spec:JSON.parse(openApi)})))} disabled={!openApi}>Preview import</button>
          <button className="cpPrimary" disabled={!openApiPreview || !endpointForm.serviceId || !endpointForm.grantId || !endpointForm.policyId} onClick={()=>withReview('Import OpenAPI operations',openApiPreview?.operations?.map((item)=>`${item.method} ${item.pathPattern}`)??[],async()=>{
            await api(`/v2/services/${endpointForm.serviceId}/import`,{spec:JSON.parse(openApi),grantId:endpointForm.grantId,policyId:endpointForm.policyId,currency:endpointForm.currency});await refresh();setOpenApiPreview(undefined);setNotice('OpenAPI operations imported.');
          })}>Import reviewed routes</button></div>{openApiPreview && <pre>{JSON.stringify(openApiPreview.operations,null,2)}</pre>}</section>
        <section className="cpCard"><span className="cpEyebrow">SAFE TEST CONSOLE</span><h2>Try a call through Pact</h2><p>GET reaches the registered upstream only if policy allows it. Use an unregistered path or forbidden method to test a denial that never forwards.</p>
          <Field label="Scoped integration key"><input type="password" value={testKey} onChange={e=>setTestKey(e.target.value)} placeholder="pat_…"/></Field>
          <div className="cpGrid2"><Field label="Method"><select value={testMethod} onChange={e=>setTestMethod(e.target.value)}>{['GET','POST','PUT','PATCH','DELETE'].map(value=><option key={value}>{value}</option>)}</select></Field><Field label="Path"><input value={testPath} onChange={e=>setTestPath(e.target.value)} placeholder="/health"/></Field></div>
          {testMethod!=='GET' && <Field label="JSON request body" hint="This sends a real request. Use your local demo service for testing."><textarea value={testBody} onChange={e=>setTestBody(e.target.value)}/></Field>}
          <button disabled={busy || !gatewayOrigin || !testKey || !endpointForm.serviceId} onClick={()=>void run(async()=>{
            const service=services.find(item=>item.id===endpointForm.serviceId);
            if(!service) throw Error('Select a service');
            const response=await fetch(`${gatewayBase}/v2/proxy/${service.agent_id}/${service.id}${testPath}`,{method:testMethod,headers:{Authorization:`Bearer ${testKey}`,'X-Pact-Idempotency-Key':crypto.randomUUID(),...(testMethod!=='GET'?{'Content-Type':'application/json'}:{})},...(testMethod!=='GET'?{body:JSON.stringify(JSON.parse(testBody))}:{}),signal:AbortSignal.any([lifetime.current.signal,AbortSignal.timeout(15_000)]),redirect:'error'});
            setTestResult(`${response.status} ${await response.text()}`);await refreshActivity();
          })}>Send real test request</button>{testResult && <pre role="status">{testResult}</pre>}</section></div>
        <section className="cpCard"><span className="cpEyebrow">REGISTERED OPERATIONS</span><h2>Endpoints by service</h2>{endpoints.length ? services.filter(service=>endpoints.some(e=>e.service_id===service.id)).map(service=><section key={service.id} className="cpDetail"><h3>{agents.find(a=>a.id===service.agent_id)?.name} / {service.name}</h3>{endpoints.filter(e=>e.service_id===service.id).map(item=><div className="cpListRow" key={item.id}><span className={`cpMethod ${item.method.toLowerCase()}`}>{item.method}</span><div><strong>{item.path_pattern}</strong><small>{item.service_name} · {item.agent_name} · {item.policy_name} · {item.status} · last used {item.last_used_at?new Date(item.last_used_at).toLocaleString():'never'}</small></div><button onClick={()=>{setSelected(item);setResponseFieldsDraft((item.response_fields??[]).join(', '));}}>Details</button></div>)}</section>) : <Empty title="No endpoints yet" detail="Register a service, grant and policy, then add an operation."/>}
          {endpointDetail && <div className="cpDetail"><h3>{endpointDetail.method} {endpointDetail.path_pattern}</h3><p>{endpointDetail.description}</p><p>Service: {endpointDetail.service_name} · <code>{endpointDetail.base_url}</code></p><p>Authentication: {services.find(item=>item.id===endpointDetail.service_id)?.auth_method ?? 'unknown'}</p><p>Policy: {endpointDetail.policy_name}</p><Field label="Assign policy"><select value={endpointDetail.policy_id} onChange={e=>{const id=e.target.value;withReview('Change operation policy',[`Operation: ${endpointDetail.method} ${endpointDetail.path_pattern}`,`Policy: ${policies.find(p=>p.id===id)?.name}`,'Existing approvals become invalid.'],async()=>{await api(`/v2/endpoints/${endpointDetail.id}`,{policyId:id},'PATCH');await refresh();setSelected(undefined);});}}>{policies.filter(p=>p.agent_id===endpointDetail.agent_id && p.status==='active').map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><p>Grant: {endpointDetail.grant_id}</p><p>Fixed cost: {moneyLabel(endpointDetail.cost_minor,endpointDetail.currency)}</p><Field label="Returned JSON fields" hint="Protected upstreams return only these top-level fields; leave empty for an empty body."><input value={responseFieldsDraft} onChange={e=>setResponseFieldsDraft(e.target.value)}/></Field><button onClick={()=>withReview('Update response fields',[`Operation: ${endpointDetail.method} ${endpointDetail.path_pattern}`,`Fields: ${responseFieldsDraft || '(none)'}`],async()=>{await api(`/v2/endpoints/${endpointDetail.id}`,{responseFields:responseFieldsDraft.split(',').map(value=>value.trim()).filter(Boolean)},'PATCH');await refresh();setSelected(undefined);})}>Review response fields</button><code>{gatewayBase}/v2/proxy/{endpointDetail.agent_id}/{endpointDetail.service_id}{endpointDetail.path_pattern}</code><div className="cpActions"><button onClick={()=>void run(async()=>{await api(`/v2/endpoints/${endpointDetail.id}`,{status:endpointDetail.status==='active'?'disabled':'active'},'PATCH');await refresh();setSelected(undefined);})}>{endpointDetail.status==='active'?'Disable':'Enable'} operation</button></div></div>}</section></>}

      {view === 'keys' && <div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">05 / INTEGRATION CREDENTIAL</span><h2>Issue an API key</h2><p>The key authenticates proxy calls for one agent. It cannot sign transactions, grant authority, or read the upstream secret.</p>
        <Field label="Agent"><select value={keyForm.agentId} onChange={e=>{setKeyForm({...keyForm,agentId:e.target.value});void refreshKeys(e.target.value).catch(()=>setNotice('Unable to load keys. Reselect the agent to retry.'));}}><option value="">Select agent</option>{agents.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Key name"><input value={keyForm.name} onChange={e=>setKeyForm({...keyForm,name:e.target.value})} placeholder="Local MCP client"/></Field>
        <Field label="Scopes"><div className="cpChecks">{['proxy.read','proxy.write'].map(scope=><label key={scope}><input type="checkbox" checked={keyForm.scopes.includes(scope)} onChange={e=>setKeyForm({...keyForm,scopes:e.target.checked?[...keyForm.scopes,scope]:keyForm.scopes.filter(value=>value!==scope)})}/>{scope}</label>)}</div></Field>
        <Field label="Expires at"><input type="datetime-local" value={localDateTime(keyForm.expiresAt)} onChange={e=>{ if(e.target.value) setKeyForm({...keyForm,expiresAt:new Date(e.target.value).toISOString()}); }}/></Field>
        <button className="cpPrimary" disabled={busy || !keyForm.agentId || !keyForm.scopes.length} onClick={()=>withReview('Issue scoped key',[
          `Agent: ${selectedAgent?.name}`,`Scopes: ${keyForm.scopes.join(', ')}`,`Expires: ${keyForm.expiresAt}`,
          'The secret is displayed once. Only its SHA-256 hash is stored.'],async()=>{
            const result=await api<{secret:string}>(`/v2/agents/${keyForm.agentId}/keys`,{name:keyForm.name,scopes:keyForm.scopes,expiresAt:keyForm.expiresAt});
            setNewSecret(result.secret);setTestKey(result.secret);await refreshKeys(keyForm.agentId);await refresh();setNotice('Key issued. Copy it now; Pact will not show it again.');
          })}>Review and issue <Icon name="arrow" size={15}/></button>

        <div className="cpDivider"/><h3>Keys for {selectedAgent?.name??'selected agent'}</h3>{keys.length ? keys.map(item=><div className="cpListRow" key={item.id}><span className="cpAvatar"><Icon name="key" size={18}/></span><div><strong>{item.name}</strong><small>{item.prefix}… · {item.scopes?.join(', ')} · {item.revoked_at?'revoked':new Date(item.expires_at)<new Date()?'expired':'active'}</small><small>Last used: {item.last_used_at?new Date(item.last_used_at).toLocaleString():'never'}</small></div><button onClick={()=>choose('keys',item.id)}>View more</button>{!item.revoked_at && <div className="cpKeyActions"><button onClick={()=>withReview('Rotate key',[`Old key ${item.prefix}… stops working immediately.`,`New key keeps scopes ${item.scopes.join(', ')} and expiry.`],async()=>{const result=await api<{secret:string}>(`/v2/agents/${keyForm.agentId}/keys/${item.id}/rotate`,{});setNewSecret(result.secret);setTestKey(result.secret);await refreshKeys(keyForm.agentId);await refresh();})}>Rotate</button><button className="cpDanger" onClick={()=>withReview('Revoke key',[`Key ${item.prefix}… will stop working immediately.`],async()=>{await api(`/v2/agents/${keyForm.agentId}/keys/${item.id}`,undefined,'DELETE');await refreshKeys(keyForm.agentId);await refresh();})}>Revoke</button></div>}</div>) : <Empty title="No keys for this agent" detail="Issue one after registering an endpoint."/>}</section>
        <section className="cpCard"><span className="cpEyebrow">INTEGRATE</span><h2>Call Pact from your agent</h2><p>Use the gateway URL with the scoped key. Keep the key in a server-side secret store. It is never an onchain signer.</p>
          <Field label="Proxy URL"><code className="cpCode">{proxyUrl}</code><Copy text={proxyUrl}/></Field>
          <h3>TypeScript</h3><pre>{`import { PactHttpClient } from '@pact/sdk-ts';\nconst pact = new PactHttpClient('${gatewayBase}', process.env.PACT_AGENT_KEY!);\nconst result = await pact.proxy('${exampleAgent?.id??'AGENT_ID'}','${exampleService?.id??'SERVICE_ID'}','GET','${exampleEndpoint?.path_pattern??"/health"}');`}</pre>
          <h3>Python</h3><pre>{`import os\nfrom pact import PactClient\npact = PactClient('${gatewayBase}', token=os.environ['PACT_AGENT_KEY'])\nresult = pact.proxy('${exampleAgent?.id??'AGENT_ID'}','${exampleService?.id??'SERVICE_ID'}','GET','${exampleEndpoint?.path_pattern??"/health"}')`}</pre>
          <h3>curl</h3><pre>{`curl '${proxyUrl}' -H 'Authorization: Bearer '$PACT_AGENT_KEY`}</pre>
          <h3>MCP</h3><pre>{`PACT_GATEWAY_URL=${gatewayBase} PACT_AGENT_KEY=pat_… pnpm --filter @pact/mcp start`}</pre>
          <p className="cpHint">Set <code>PACT_API_URL={apiBase}</code> for authority reads. The key only allows its listed proxy scopes.</p></section></div>}

      {view === 'approvals' && <section className="cpCard"><span className="cpEyebrow">HUMAN DECISION</span><h2>Approval inbox</h2><p>Inspect before approving. Approval permits one exact retry.</p>
        {approvalIntent && <div className="cpDetail"><h3>Request details</h3><p>Owner-only disclosure. Sensitive fields are redacted.</p><pre>{JSON.stringify(approvalIntent.intent,null,2)}</pre></div>}{approvals.length ? approvals.map(item=><div className="cpListRow" key={item.id}><span className="cpAvatar"><Icon name="inbox" size={18}/></span><div><strong>{item.agent_name} · {item.method} {item.path_pattern}</strong><small>{item.state} · expires {new Date(item.expires_at).toLocaleString()}</small><small>Grant: {item.grant_name ?? item.grant_id ?? 'legacy request'} · Policy: {item.policy_name ?? item.policy_id ?? 'legacy request'} · Rule: {item.matched_rule ?? 'unavailable'}</small><small>Declared cost: {item.cost_minor == null ? 'unavailable' : moneyLabel(item.cost_minor, item.currency)} · Request digest: {item.request_hash}</small><code>{item.id}</code></div><button onClick={()=>choose('approvals',item.id)}>View more</button>{item.state==='pending' && <div className="cpKeyActions"><button onClick={()=>void run(async()=>{const data=await api<{intent:unknown}>(`/v2/approvals/${item.id}/intent`);setApprovalIntent({id:item.id,intent:data.intent});})}>Inspect request</button><button disabled={approvalIntent?.id!==item.id} className="cpPrimary" onClick={()=>withReview('Approve exact request',[`Agent: ${item.agent_name}`,`Operation: ${item.method} ${item.path_pattern}`,`Grant: ${item.grant_name ?? item.grant_id}`,`Policy: ${item.policy_name ?? item.policy_id}; rule: ${item.matched_rule}`,`Declared cost: ${item.cost_minor == null ? 'unavailable' : moneyLabel(item.cost_minor, item.currency)}`,`Request digest: ${item.request_hash}`,`Expires: ${item.expires_at}`],async()=>{await api(`/v2/approvals/${item.id}/decision`,{decision:'approved'});await refresh();})}>Approve</button><button className="cpDanger" onClick={()=>withReview('Reject exact request',[`Agent: ${item.agent_name}`,`Operation: ${item.method} ${item.path_pattern}`,`Request digest: ${item.request_hash}`],async()=>{await api(`/v2/approvals/${item.id}/decision`,{decision:'rejected'});await refresh();})}>Reject</button></div>}</div>) : <Empty title="No approval requests" detail="Requests awaiting your decision appear here."/>}</section>}

      {view === 'activity' && <section className="cpCard"><div className="cpCardHead"><span className="cpEyebrow"><i className="cpPulse"/> AUTO-UPDATING EVERY 3 SECONDS</span><h2>Agent activity</h2><p>Live decisions. Bodies and secrets excluded.</p></div>
        {activityError && <p role="alert">{activityError} <button onClick={() => void refreshActivity().catch(() => setActivityError('Activity is still unavailable.'))}>Retry activity</button></p>}
        <div className="cpFilters"><input aria-label="Search activity" placeholder="Search route, reason, agent" value={activityFilters.search} onChange={e=>setActivityFilters({...activityFilters,search:e.target.value})}/><select aria-label="Decision filter" value={activityFilters.decision} onChange={e=>setActivityFilters({...activityFilters,decision:e.target.value})}><option value="">All decisions</option><option value="allowed">Allowed</option><option value="denied">Denied</option><option value="pending_approval">Pending approval</option></select><select aria-label="Agent filter" value={activityFilters.agentId} onChange={e=>setActivityFilters({...activityFilters,agentId:e.target.value})}><option value="">All agents</option>{agents.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><button onClick={()=>void run(()=>refreshActivity())}>Search</button></div>
        {activity.length ? <><div className="cpActivityTable"><div className="cpActivityHeader"><span>TIME / AGENT</span><span>REQUEST</span><span>DECISION</span><span>RULE / REASON</span><span>UPSTREAM</span></div>{activity.map(item=><button key={item.id} className="cpActivityRow" onClick={()=>choose('activity',item.id)}><span><strong>{new Date(item.created_at).toLocaleTimeString()}</strong><small>{item.agent_name}</small></span><span><b>{item.method}</b> {item.route}</span><span className={`cpDecision ${item.decision}`}>{item.decision.replace('_',' ')}</span><span><strong>{item.matched_rule??'—'}</strong><small>{item.reason}</small></span><span>{item.upstream_status??'—'} · {item.latency_ms??'—'} ms</span></button>)}</div>
          {activityCursor && <button onClick={()=>void run(()=>refreshActivity(true))}>Load older events</button>}</> : <Empty title="No activity yet" detail="Call an endpoint through Pact to see its decision."/>}
        {activityDetail?.trace && <div className="cpDetail"><h3>Request {activityDetail.id}</h3><p>{activityDetail.method} {activityDetail.route} · {activityDetail.decision}</p><p>Agent {activityDetail.agent_id} · Key {activityDetail.key_id}</p><div className="cpActions">{activityDetail.grant_id && <button onClick={()=>{setView('grants');setSelected({id:activityDetail.grant_id!});}}>Inspect grant</button>}{activityDetail.policy_id && <button onClick={()=>{setView('policies');setSelected({id:activityDetail.policy_id!});}}>Inspect policy</button>}{activityDetail.approval_id && <button onClick={()=>choose('approvals')}>Open approval inbox</button>}</div><p>Approval {activityDetail.approval_id??'not required'} · Upstream {activityDetail.upstream_status??'not reached'}</p><h4>Decision trace</h4>{activityDetail.trace.map((step,i:number)=><p key={i}>{i+1}. <b>{step.name}</b> ({step.ruleId}) — {step.result}: {step.reason}</p>)}<p className="cpHint">Private gateway log · not anchored onchain.</p></div>}</section>}

      {view === 'audit' && <section className="cpCard"><span className="cpEyebrow">ACCOUNT CHANGES</span><h2>Audit history</h2><p>Account changes, attributed and timestamped.</p>
        {auditEvents.length ? auditEvents.map(item => <div className="cpListRow" key={item.id}><span className="cpAvatar"><Icon name="book" size={17}/></span><div><strong>{item.action}</strong><small>{new Date(item.created_at).toLocaleString()}</small><code>{JSON.stringify(item.details)}</code></div></div>) : <Empty title="No changes yet" detail="Create an agent or policy to start an audit history."/>}
        {auditCursor && <button onClick={() => void run(() => refreshAudit(true))}>Load older changes</button>}</section>}

      {view === 'account' && <div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">ACCOUNT PRINCIPAL</span><h2>Your address</h2><p>Used automatically for new grants. Monad signing requires a verified wallet.</p>{account.principalAddress ? <div className="cpAddress"><code>{account.principalAddress}</code><Copy text={account.principalAddress}/></div> : <p>Your account address is being assigned. You can register agents while this finishes.</p>}{account.verificationStatus === 'verified' && <p className="cpVerified"><Icon name="check" size={16}/> Signing address verified</p>}{account.verificationStatus === 'account_assigned' && <p className="cpVerified"><Icon name="check" size={16}/> Account-owned HTTP authority</p>}
        {account.verificationStatus==='account_assigned' && <button className="cpPrimary" disabled={busy || !wallets.some(w=>w.walletClientType==='privy')} onClick={()=>withReview('Enable Monad signing',[
          'Use the embedded wallet belonging to your signed-in account. No shared Pact private key is used.',
          'Sign an account ownership message. Existing HTTP grants retain their original principal until you migrate them.',
          'No blockchain transaction or payment occurs in this step.'
        ],async()=>{
          const wallet=wallets.find(w=>w.walletClientType==='privy');if(!wallet) throw Error('Your embedded wallet is still loading. Retry shortly.');
          const challenge=await api<{message:string;challengeId:string}>('/v2/account/address/challenge',{address:wallet.address});
          const provider=await wallet.getEthereumProvider();
          const signature=await provider.request({method:'personal_sign',params:[challenge.message,wallet.address]});
          await api('/v2/account/address/verify',{challengeId:challenge.challengeId,signature});
          setAccount(await api<Account>('/v2/account'));setNotice('Your Pact wallet is verified. Deploy its Monad account when you are ready to transact.');
        })}>Enable Monad signing with my Pact wallet</button>}
        <h3>Monad account</h3><p>{account.onchainStatus==='deployed' ? `Controlled account: ${account.onchainAccount}` : account.onchainStatus==='external_proof_required' ? 'Enable signing for Monad transactions.' : account.onchainStatus==='factory_unconfigured' ? 'Account factory not configured.' : account.onchainStatus==='rpc_unavailable' ? 'Chain status unavailable. HTTP agents remain available.' : 'Not deployed. HTTP agents need no onchain account.'}</p>
        {account.onchainStatus==='not_deployed' && account.verificationStatus==='verified' && <button onClick={()=>withReview('Deploy your Monad account',[
          `Signer: ${account.principalAddress}`,'This is a real Monad transaction. Your account wallet must have MON for gas. The integration key cannot sign it.'
        ],async()=>{
          const transaction=await api<{chainId:number;from:string;to:string;data:string}>('/v2/account/onchain/prepare',{});
          const wallet=wallets.find(item=>item.address.toLowerCase()===account.principalAddress?.toLowerCase());
          if(!wallet) throw Error('Connect the account address before sending the transaction.');
          const provider=await wallet.getEthereumProvider();
          await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:`0x${Number(transaction.chainId).toString(16)}`}]});
          const hash=await provider.request({method:'eth_sendTransaction',params:[{from:transaction.from,to:transaction.to,data:transaction.data}]});
          setNotice(`Monad transaction submitted: ${String(hash)}. Refresh Account after confirmation.`);
        })}>Review account deployment</button>}
        <button onClick={()=>void run(async()=>setAccount(await api<Account>('/v2/account')))}>Refresh chain status</button>
        <h3>Change principal address</h3><p>Proof of control required. Existing grants keep their owner until migrated or reissued.</p><Field label="New address"><input value={changeAddress} onChange={e=>setChangeAddress(e.target.value)} placeholder="0x…"/></Field>
        <button onClick={() => connectWallet()}>Connect address to verify</button>
        <button disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(changeAddress)} onClick={()=>withReview('Change principal address',[`Current: ${account.principalAddress}`,`New: ${changeAddress}`,'Existing grants remain under their original principal and must be reissued explicitly.'],async()=>{
          const matching=wallets.find(item=>item.address.toLowerCase()===changeAddress.toLowerCase());
          if(!matching) throw Error('Add the new address to this account first, then retry. Pact must verify its signature.');
          const challenge=await api<{message:string;challengeId:string}>('/v2/account/address/challenge',{address:changeAddress});
          const provider=await matching.getEthereumProvider();
          const signature=await provider.request({method:'personal_sign',params:[challenge.message,matching.address]});
          await api('/v2/account/address/verify',{challengeId:challenge.challengeId,signature});
          setAccount(await api<Account>('/v2/account'));await refresh();setChangeAddress('');setNotice('Principal changed for future grants. Existing grants are unchanged.');
        })}>Review address change</button>
        </section>
        <section className="cpCard"><span className="cpEyebrow">MIGRATION & CUSTODY</span><h2>Existing grants</h2><p>Existing Monad grants retain their original signer.</p><p>{legacyCount===null?'Check your existing grant list before migrating.':`${legacyCount} indexed legacy grants are visible to the original principal session.`}</p><a href="/legacy">Open existing Monad grant manager ↗</a><a href="/docs/custody">Read custody, recovery and revocation model ↗</a><p className="cpHint">HTTP: migrate in Grants. Monad: revoke and reissue, then rotate keys.</p></section></div>}
      </>}
      </>}
      </main></div>
    {paymentTask && <ActionPayment api={rawApi} path={paymentTask.path} body={paymentTask.body} existing={paymentTask.existing} onDone={value=>{paymentTask.resolve(value);setPaymentTask(undefined);setPaymentRevision(current=>current+1);void rawApi<Account>('/v2/account').then(setAccount).catch(()=>setNotice('Action completed. Refresh Account to update its address status.'));}} onCancel={()=>{paymentTask.reject(Error('Payment closed. Resume pending payments from Account.'));setPaymentTask(undefined);}}/>}
    {review && <div className="cpReviewShade" role="presentation"><div className="cpReview" role="dialog" aria-modal="true" aria-label={review.title}><span className="cpEyebrow">REVIEW BEFORE APPLYING</span><h2>{review.title}</h2>{feeConfig?.enabled && ['Register agent','Create HTTP grant','Create ordered policy','Issue scoped key'].includes(review.title) && <p><strong>Fee: 5 MON + network gas</strong></p>}<ul>{review.summary.map((line,i)=><li key={i}>{line}</li>)}</ul><div className="cpActions"><button onClick={()=>setReview(undefined)}>Cancel</button><button className="cpPrimary" onClick={confirm} disabled={busy}>Confirm change</button></div></div></div>}
  </div>;
}
