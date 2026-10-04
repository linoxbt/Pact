import { useEffect, useState } from 'react';
import { getAccessToken, useConnectWallet, useLinkWithPasskey, usePrivy, useWallets } from '@privy-io/react-auth';
import { Brand, Icon } from './ui.js';
import './control.css';

const apiOrigin = import.meta.env.VITE_PACT_API_URL as string | undefined;
const gatewayOrigin = import.meta.env.VITE_PACT_GATEWAY_URL as string | undefined;
type Item = Record<string, any>;
type View = 'overview'|'agents'|'grants'|'endpoints'|'policies'|'keys'|'approvals'|'activity'|'audit'|'account';
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
  { id: 'audit', label: 'Audit history', icon: 'book' },
  { id: 'account', label: 'Account', icon: 'wallet' },
];
const json = (value: unknown) => JSON.stringify(value, (_key, field) =>
  typeof field === 'bigint' ? field.toString() : field);
async function api<T = Item>(path: string, body?: unknown, method?: string): Promise<T> {
  if (!apiOrigin) throw Error('Pact API URL is not configured');
  const token = await getAccessToken();
  if (!token) throw Error('Your sign in expired. Please sign in again.');
  const response = await fetch(new URL(path, apiOrigin), { method: method ?? (body === undefined ? 'GET' : 'POST'),
    redirect: 'error', headers: { Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: json(body) }) });
  const data = await response.json().catch(() => ({})) as Item;
  if (!response.ok) {
    if (response.status === 404 && path.startsWith('/v2/')) {
      throw Error('The live Pact API does not have the agent management release yet (HTTP 404).');
    }
    throw Error(data.message ?? data.error ?? `Pact API ${response.status}`);
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
  return <button className="cpCopy" type="button" onClick={() => {
    void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); });
  }}>{copied ? 'Copied' : label}</button>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="cpEmpty"><span><Icon name="layers" size={24}/></span><strong>{title}</strong><p>{detail}</p></div>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="cpField"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function ControlConsole() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { connectWallet } = useConnectWallet();
  const { linkWithPasskey } = useLinkWithPasskey();
  const [view, setView] = useState<View>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem('pact:sidebar-collapsed') === 'true'; }
    catch { return false; }
  });
  const [account, setAccount] = useState<Item>();
  const [controlStatus, setControlStatus] = useState<ControlStatus>('idle');
  const [controlError, setControlError] = useState('');
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [agents, setAgents] = useState<Item[]>([]);
  const [grants, setGrants] = useState<Item[]>([]);
  const [services, setServices] = useState<Item[]>([]);
  const [endpoints, setEndpoints] = useState<Item[]>([]);
  const [policies, setPolicies] = useState<Item[]>([]);
  const [keys, setKeys] = useState<Item[]>([]);
  const [activeKeyCount, setActiveKeyCount] = useState(0);
  const [approvals, setApprovals] = useState<Item[]>([]);
  const [activity, setActivity] = useState<Item[]>([]);
  const [auditEvents, setAuditEvents] = useState<Item[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [activityError, setActivityError] = useState('');
  const [activityFilters, setActivityFilters] = useState({ search: '', decision: '', agentId: '' });
  const [selected, setSelected] = useState<Item>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ title: string; summary: string[]; action: () => Promise<void> }>();
  const [newSecret, setNewSecret] = useState('');
  const [testKey, setTestKey] = useState('');
  const [testMethod, setTestMethod] = useState('GET');
  const [testPath, setTestPath] = useState('/health');
  const [testResult, setTestResult] = useState('');
  const [changeAddress, setChangeAddress] = useState('');
  const [agentForm, setAgentForm] = useState({ name: '', environment: 'development', description: '' });
  const [serviceForm, setServiceForm] = useState({ agentId: '', name: '', baseUrl: '',
    authMethod: 'none', authHeader: '', secret: '' });
  const [replacementSecret, setReplacementSecret] = useState('');
  const [responseFieldsDraft, setResponseFieldsDraft] = useState('');
  const [grantForm, setGrantForm] = useState({ agentId: '', name: 'Read only service access',
    origin: '', actions: ['GET'], currency: 'USD', perActionLimitMinor: '0',
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
    responseFields: ['status','service','ok'] });
  const [keyForm, setKeyForm] = useState({ agentId: '', name: 'Development agent',
    scopes: ['proxy.read'], expiresAt: later(30) });
  const [openApi, setOpenApi] = useState('');
  const [openApiPreview, setOpenApiPreview] = useState<Item>();
  const [legacyCount, setLegacyCount] = useState<number | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setNotice('');
    try { await work(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Action failed'); }
    finally { setBusy(false); }
  };
  const refresh = async () => {
    const [a,g,s,e,p,ap,ac,k] = await Promise.all([
      api<{ agents: Item[] }>('/v2/agents'), api<{ grants: Item[] }>('/v2/grants'),
      api<{ services: Item[] }>('/v2/services'), api<{ endpoints: Item[] }>('/v2/endpoints'),
      api<{ policies: Item[] }>('/v2/policies'), api<{ approvals: Item[] }>('/v2/approvals'),
      api<{ events: Item[]; nextCursor: string | null }>('/v2/activity'),
      api<{ active: number }>('/v2/keys/summary'),
    ]);
    setAgents(a.agents); setGrants(g.grants); setServices(s.services); setEndpoints(e.endpoints);
    setPolicies(p.policies); setApprovals(ap.approvals); setActivity(ac.events);
    setActivityCursor(ac.nextCursor);
    setActiveKeyCount(k.active);
  };
  const refreshKeys = async (agentId: string) => {
    if (!agentId) { setKeys([]); return; }
    const result = await api<{ keys: Item[] }>(`/v2/agents/${agentId}/keys`);
    setKeys(result.keys);
  };
  const refreshActivity = async (append = false, preserveLoaded = false) => {
    const query = new URLSearchParams();
    if (activityFilters.search) query.set('search', activityFilters.search);
    if (activityFilters.decision) query.set('decision', activityFilters.decision);
    if (activityFilters.agentId) query.set('agentId', activityFilters.agentId);
    if (append && activityCursor) query.set('cursor', activityCursor);
    const data = await api<{ events: Item[]; nextCursor: string | null }>(`/v2/activity?${query}`);
    setActivity(old => append ? [...old, ...data.events] : preserveLoaded ?
      [...data.events, ...old.filter(item => !data.events.some(recent => recent.id === item.id))] :
      data.events);
    if (!preserveLoaded) setActivityCursor(data.nextCursor);
    setActivityError('');
  };
  const refreshAudit = async (append = false) => {
    const data = await api<{ events: Item[]; nextCursor: string | null }>(
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
        const nextAccount = await api('/v2/account');
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
    if (!authenticated || view !== 'activity') return;
    void refreshActivity().catch(() => setActivityError('Activity could not be refreshed. Retry below.'));
    const timer = setInterval(() => { void refreshActivity(false, true)
      .catch(() => setActivityError('Activity is temporarily stale. Retry below.')); }, 3000);
    return () => clearInterval(timer);
  }, [authenticated, view, activityFilters]);
  useEffect(() => {
    try { window.localStorage.setItem('pact:sidebar-collapsed', String(sidebarCollapsed)); }
    catch { /* Navigation still works when storage is unavailable. */ }
  }, [sidebarCollapsed]);

  const choose = (next: View) => { setView(next); setSelected(undefined); setMenuOpen(false); };
  const withReview = (title: string, summary: string[], action: () => Promise<void>) =>
    setReview({ title, summary, action });
  const confirm = () => {
    if (!review) return;
    const action = review.action;
    setReview(undefined);
    void run(action);
  };
  const selectedAgent = agents.find(item => item.id === keyForm.agentId);
  const activeServices = services.filter(item => item.status === 'active');
  const apiBase = apiOrigin?.replace(/\/$/, '') ?? 'https://YOUR_PACT_API';
  const gatewayBase = gatewayOrigin?.replace(/\/$/, '') ?? 'https://YOUR_PACT_GATEWAY';
  const exampleService = services[0];
  const exampleAgent = agents[0];
  const proxyUrl = exampleService && exampleAgent ?
    `${gatewayBase}/v2/proxy/${exampleAgent.id}/${exampleService.id}/health` :
    `${gatewayBase}/v2/proxy/AGENT_ID/SERVICE_ID/health`;
  return <div className={`cpShell ${sidebarCollapsed ? 'cpCollapsed' : ''}`}>
    <aside className={`cpSidebar ${menuOpen ? 'open' : ''}`}><div className="cpBrand"><Brand/><button className="cpClose" onClick={() => setMenuOpen(false)} aria-label="Close menu">×</button></div>
      <div className="cpWorkspaceIdentity"><span className="cpWorkspaceAvatar">P</span><div className="cpWorkspaceIdentityText">Pact workspace<small><i className="cpStatusDot"/> Monad testnet</small></div><span className="cpWorkspaceVersion">01</span></div>
      <span className="cpNavLabel">WORKSPACE</span><nav id="pact-console-nav" aria-label="Console navigation">{nav.map(item =>
        <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => choose(item.id)}
          aria-current={view === item.id ? 'page' : undefined} aria-label={item.label}
          title={sidebarCollapsed ? item.label : undefined}><Icon name={item.icon} size={18}/><span className="cpNavText">{item.label}</span>
          {item.id === 'approvals' && approvals.filter(value => value.state === 'pending').length > 0 &&
            <em>{approvals.filter(value => value.state === 'pending').length}</em>}</button>)}</nav>
      <div className="cpSidebarFoot"><a href="/docs" aria-label="Developer docs" title={sidebarCollapsed ? 'Developer docs' : undefined}><Icon name="book" size={17}/><span className="cpFootText">Developer docs</span><Icon name="external" size={13}/></a>
        <a href="/explorer" aria-label="Public Explorer" title={sidebarCollapsed ? 'Public Explorer' : undefined}><Icon name="globe" size={17}/><span className="cpFootText">Public Explorer</span><Icon name="external" size={13}/></a>
        <a href="/legacy" aria-label="Existing Monad grants" title={sidebarCollapsed ? 'Existing Monad grants' : undefined}><Icon name="shield" size={17}/><span className="cpFootText">Existing Monad grants</span><Icon name="external" size={13}/></a>
        <div className="cpSidebarAccount" title={sidebarCollapsed ? (account?.principalAddress ?? 'Pact account') : undefined}><span><Icon name="wallet" size={18}/></span><div className="cpAccountText">{account?.principalAddress ? short(account.principalAddress) : 'Pact account'}<small>{account?.verificationStatus === 'verified' ? 'Verified external address' : account?.verificationStatus === 'account_assigned' ? 'Account owned' : authenticated ? 'Account setup' : 'Sign in to get started'}</small></div></div>
      </div></aside>
    {menuOpen && <button className="cpBackdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)}/>}
    <div className="cpMain"><header className="cpTopbar"><button className="cpMenu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Icon name="menu"/></button>
      <button className="cpSidebarToggle" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-controls="pact-console-nav" aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed(value => !value)}><Icon name="panel" size={18}/></button>
      <span>PACT <b>/</b> {nav.find(item => item.id === view)?.label}</span><div className="cpTopActions"><span className="cpLive"><i/> CONTROL PLANE</span>
      {authenticated ? <button onClick={() => void logout()}>Sign out</button> : <button className="cpPrimary" onClick={() => login()}>Sign in</button>}</div></header>
      <main className="cpContent"><div className="cpPageHead"><div><span className="cpEyebrow">PACT / {view.toUpperCase()}</span>
        <h1>{view === 'overview' ? 'Connect an agent. Keep control.' : nav.find(item => item.id === view)?.label}</h1>
        <p>{view === 'overview' ? 'Register a service, set the boundary, and see every decision as it happens.' :
          view === 'account' ? 'Your verified identity owns future grants. Earlier grants keep their original principal.' :
          view === 'activity' ? 'Every proxy decision, updated automatically. Private gateway logs are not onchain receipts.' :
          'Each change is checked by Pact before it affects an agent.'}</p></div>
        {authenticated && account?.principalAddress && <div className="cpPrincipalBadge"><small>YOUR PRINCIPAL ADDRESS</small><code title={account.principalAddress}>{short(account.principalAddress)}</code><span>{account.verificationStatus}</span></div>}</div>
      {notice && <div className="cpNotice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
      {!ready && <p className="cpLoading">Loading account…</p>}
      {ready && !authenticated && <section className="cpHeroPanel"><span className="cpEyebrow">YOUR AGENT WORKSPACE</span><h2>Start with your account.</h2>
        <p>Sign in with email, passkey, or another available method. Pact creates a unique account address for you automatically. No external wallet is needed to connect an HTTP agent.</p>
        <button className="cpPrimary" onClick={() => login()}>Create account or sign in <Icon name="arrow" size={16}/></button></section>}
      {authenticated && controlStatus === 'loading' && <section className="cpHeroPanel" role="status"><span className="cpEyebrow">CONNECTING</span><h2>Loading your workspace.</h2><p>Checking your account and agent management API.</p></section>}
      {authenticated && controlStatus === 'unavailable' && <section className="cpHeroPanel" role="alert"><span className="cpEyebrow">SERVICE UNAVAILABLE</span><h2>{nav.find(item => item.id === view)?.label} cannot load yet.</h2>
        <p>{controlError} Your account verification has not failed; the Console cannot check it until the API responds.</p>
        <button className="cpPrimary" onClick={() => setConnectionAttempt(value => value + 1)}>Retry connection</button>
        <p><a href="/legacy">Open existing Monad grants ↗</a></p></section>}
      {authenticated && controlStatus === 'ready' && account?.verificationStatus === 'unverified' && <section className="cpCard" role="status"><span className="cpEyebrow">ACCOUNT SETUP</span><h2>Your account address is being assigned.</h2><p>Agent and HTTP grant management will be available when this finishes.</p><button onClick={() => setConnectionAttempt(value => value + 1)}>Retry account setup</button></section>}
      {authenticated && controlStatus === 'ready' && account && <>
      {view === 'overview' && <><div className="cpStats">{[
        ['Agents',agents.length,'agent'],['Endpoints',endpoints.length,'globe'],
        ['Active keys',activeKeyCount,'key'],
        ['Events',activity.length,'activity'],
      ].map(([label,value,icon]) => <div key={String(label)}><Icon name={String(icon)} size={20}/><span>{label}</span><strong>{value}</strong></div>)}</div>
      <div className="cpTwo"><section className="cpCard"><div className="cpCardHead"><span className="cpEyebrow">QUICKSTART</span><h2>Connect an agent</h2><p>Finish these steps in order. Each step writes a real record and appears in the pages at left.</p></div>
        {[
          ['1','Register an agent','Give it a name and environment.','agents',agents.length],
          ['2','Add a service and secret','Choose an upstream; Pact stores the credential encrypted.','endpoints',services.length],
          ['3','Create a grant and policy','Bound actions, destinations, rates, and approvals.','grants',grants.length && policies.length],
          ['4','Register an operation','Map a method and route to a grant and policy.','endpoints',endpoints.length],
          ['5','Issue a scoped API key','Copy the secret once and give it to your agent.','keys',activeKeyCount],
          ['6','Test and inspect','Make an allowed GET and a denied request.','activity',activity.length],
        ].map(([number,title,detail,target,done]) => <button className="cpStep" key={String(number)} onClick={() => choose(target as View)}><span className={done ? 'done' : ''}>{done ? '✓' : number}</span><div><strong>{title}</strong><small>{detail}</small></div><Icon name="arrow" size={16}/></button>)}</section>
        <section className="cpCard cpFlow"><span className="cpEyebrow">THE ENFORCEMENT PATH</span><h2>Permission travels through Pact.</h2><div className="cpFlowDiagram"><span>Agent</span><i>→</i><span>Scoped key</span><i>→</i><span>Ordered policy</span><i>→</i><span>Upstream</span></div>
          <p>The upstream secret remains in Pact. A denied request stops before forwarding. Gateway activity is private by default; Monad receipts are separately anchored and verifiable.</p>
          <code>{proxyUrl}</code><Copy text={proxyUrl} label="Copy proxy URL"/>
        </section></div></>}

      {view === 'agents' && <div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">01 / IDENTITY</span><h2>Register an agent</h2><p>An agent is your application or runtime. It receives no authority until you create a grant and policy.</p>
        <Field label="Agent name" hint="Example: Support assistant"><input value={agentForm.name} onChange={e => setAgentForm({ ...agentForm, name: e.target.value })} placeholder="Support assistant"/></Field>
        <Field label="Environment"><select value={agentForm.environment} onChange={e => setAgentForm({ ...agentForm, environment: e.target.value })}><option value="development">Development</option><option value="staging">Staging</option><option value="production">Production</option></select></Field>
        <Field label="Description"><textarea value={agentForm.description} onChange={e => setAgentForm({ ...agentForm, description: e.target.value })} placeholder="What this agent does"/></Field>
        <button className="cpPrimary" disabled={busy || agentForm.name.trim().length < 2} onClick={() => withReview('Register agent', [agentForm.name, `Environment: ${agentForm.environment}`, agentForm.description || 'No description'], async () => {
          await api('/v2/agents', agentForm); setAgentForm({ ...agentForm, name: '', description: '' });
          await refresh(); setNotice('Agent registered. Add an upstream service next.');
        })}>Review agent <Icon name="arrow" size={15}/></button></section>
        <section className="cpCard"><div className="cpCardHead"><span className="cpEyebrow">DIRECTORY</span><h2>Your agents</h2></div>{agents.length ? agents.map(item =>
          <div className="cpListRow" key={item.id}><span className="cpAvatar"><Icon name="agent" size={18}/></span><div><strong>{item.name}</strong><small>{item.environment} · {item.status}</small></div><button onClick={() => setSelected(item)}>View</button></div>) : <Empty title="No agents yet" detail="Register one here to begin connecting an upstream service."/>}
          {selected && agents.some(item => item.id === selected.id) && <div className="cpDetail"><h3>{selected.name}</h3><p>{selected.description || 'No description'}</p><code>{selected.id}</code><div className="cpActions"><button onClick={() => void run(async () => { await api(`/v2/agents/${selected.id}`, { status: selected.status === 'active' ? 'disabled' : 'active' }, 'PATCH'); await refresh(); setSelected(undefined); })}>{selected.status === 'active' ? 'Disable agent' : 'Enable agent'}</button></div></div>}</section></div>}

      {view === 'grants' && <div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">02 / OWNER AUTHORITY</span><h2>{editGrantId?'Narrow an HTTP grant':'Create an HTTP grant'}</h2><p>This grant authorizes an agent to use registered HTTP operations only. Onchain spending requires a separate Monad transaction.</p>
        <Field label="Agent"><select disabled={!!editGrantId} value={grantForm.agentId} onChange={e => setGrantForm({ ...grantForm, agentId: e.target.value })}><option value="">Select agent</option>{agents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Grant name"><input disabled={!!editGrantId} value={grantForm.name} onChange={e => setGrantForm({ ...grantForm, name: e.target.value })}/></Field>
        <Field label="Permitted service origin" hint="Example: https://api.example.com; exact destination allowlist"><select value={grantForm.origin} onChange={e => setGrantForm({ ...grantForm, origin: e.target.value })}><option value="">Select registered service</option>{services.filter(item => item.agent_id === grantForm.agentId).map(item => <option key={item.id} value={item.base_url}>{item.name} · {item.base_url}</option>)}</select></Field>
        <Field label="Allowed HTTP actions"><div className="cpChecks">{['GET','POST','PUT','PATCH','DELETE'].map(method => <label key={method}><input type="checkbox" checked={grantForm.actions.includes(method)} onChange={e => setGrantForm({ ...grantForm, actions: e.target.checked ? [...grantForm.actions,method] : grantForm.actions.filter(value => value !== method) })}/>{method}</label>)}</div></Field>
        <div className="cpGrid3"><Field label="Currency"><input value={grantForm.currency} maxLength={12} onChange={e => setGrantForm({ ...grantForm, currency: e.target.value.toUpperCase() })}/></Field>
          <Field label="Per action limit" hint="Minor units; 0 = free calls only"><input inputMode="numeric" value={grantForm.perActionLimitMinor} onChange={e => setGrantForm({ ...grantForm, perActionLimitMinor: e.target.value })}/></Field>
          <Field label="Aggregate limit" hint="Minor units"><input inputMode="numeric" value={grantForm.aggregateLimitMinor} onChange={e => setGrantForm({ ...grantForm, aggregateLimitMinor: e.target.value })}/></Field></div>
        <Field label="Approval above" hint="Minor units; paid calls above this need human approval"><input inputMode="numeric" value={grantForm.approvalThresholdMinor} onChange={e => setGrantForm({ ...grantForm, approvalThresholdMinor: e.target.value })}/></Field>
        <div className="cpGrid2"><Field label="Starts at"><input disabled={!!editGrantId} type="datetime-local" value={localDateTime(grantForm.startsAt)} onChange={e => { if(e.target.value) setGrantForm({ ...grantForm, startsAt: new Date(e.target.value).toISOString() }); }}/></Field>
          <Field label="Expires at"><input type="datetime-local" value={localDateTime(grantForm.expiresAt)} onChange={e => { if(e.target.value) setGrantForm({ ...grantForm, expiresAt: new Date(e.target.value).toISOString() }); }}/></Field></div>
        <button className="cpPrimary" disabled={busy || (!editGrantId && !account.principalAddress) || !grantForm.agentId || !grantForm.origin || !grantForm.actions.length} onClick={() => withReview(editGrantId?'Narrow HTTP grant':'Create HTTP grant', [
          `Owner: ${account.principalAddress}`, `Agent: ${agents.find(item => item.id === grantForm.agentId)?.name}`,
          `Actions: ${grantForm.actions.join(', ')}`, `Origin and destination: ${grantForm.origin}`,
          `Per action: ${moneyLabel(grantForm.perActionLimitMinor, grantForm.currency)}`,
          `Aggregate: ${moneyLabel(grantForm.aggregateLimitMinor, grantForm.currency)}`,
          `Approval above: ${moneyLabel(grantForm.approvalThresholdMinor, grantForm.currency)}`,
          `Window: ${grantForm.startsAt} to ${grantForm.expiresAt}`,
        ], async () => { if(editGrantId) await api(`/v2/grants/${editGrantId}`,{
          resourceOrigins:[grantForm.origin],destinationOrigins:[grantForm.origin],actions:grantForm.actions,
          perActionLimitMinor:grantForm.perActionLimitMinor,aggregateLimitMinor:grantForm.aggregateLimitMinor,
          approvalThresholdMinor:grantForm.approvalThresholdMinor,expiresAt:grantForm.expiresAt },'PATCH');
          else await api('/v2/grants', { agentId: grantForm.agentId, name: grantForm.name,
          resourceOrigins: [grantForm.origin], destinationOrigins: [grantForm.origin],
          actions: grantForm.actions, currency: grantForm.currency,
          perActionLimitMinor: grantForm.perActionLimitMinor,
          aggregateLimitMinor: grantForm.aggregateLimitMinor,
          approvalThresholdMinor: grantForm.approvalThresholdMinor,
          startsAt: grantForm.startsAt, expiresAt: grantForm.expiresAt });
          setEditGrantId('');await refresh(); setNotice('HTTP grant saved under your principal address.');
        })}>Review grant <Icon name="arrow" size={15}/></button>{editGrantId && <button onClick={()=>setEditGrantId('')}>Cancel edit</button>}</section>
        <section className="cpCard"><span className="cpEyebrow">ISSUED AUTHORITY</span><h2>Grants</h2>{grants.length ? grants.map(item =>
          <div className="cpListRow" key={item.id}><span className="cpAvatar"><Icon name="shield" size={18}/></span><div><strong>{item.name}</strong><small>{item.actions?.join(', ')} · {item.status}</small></div><button onClick={() => setSelected(item)}>Inspect</button></div>) : <Empty title="No HTTP grants" detail="Choose an agent and a registered service to define its boundary."/>}
          {selected && grants.some(item => item.id === selected.id) && <div className="cpDetail"><h3>{selected.name}</h3><p>Owner: <code>{selected.principal_address}</code></p><p>Actions: {selected.actions?.join(', ')}</p><p>Destination: {selected.destination_origins?.join(', ')}</p><p>Limit: {moneyLabel(selected.per_action_limit_minor, selected.currency)} per action; {moneyLabel(selected.aggregate_limit_minor, selected.currency)} aggregate.</p><p>Spent: {selected.spent_minor ?? '0'} minor units</p><p>Expires: {new Date(selected.expires_at).toLocaleString()}</p><p>Status: {selected.status}</p>
          {selected.status === 'active' && <button onClick={()=>{setEditGrantId(selected.id);setGrantForm({agentId:selected.agent_id,name:selected.name,
            origin:selected.resource_origins[0],actions:selected.actions,currency:selected.currency,
            perActionLimitMinor:selected.per_action_limit_minor,aggregateLimitMinor:selected.aggregate_limit_minor,
            approvalThresholdMinor:selected.approval_threshold_minor,startsAt:selected.starts_at,expiresAt:selected.expires_at});}}>Narrow grant</button>}
          {selected.status === 'active' && account.principalAddress &&
            selected.principal_address?.toLowerCase() !== account.principalAddress?.toLowerCase() &&
            <button onClick={()=>withReview('Migrate HTTP grant',[
              `Original principal: ${selected.principal_address}`,`Current principal: ${account.principalAddress}`,
              'Pact will copy the grant bounds and spent budget, move its endpoints, and revoke the old grant in one transaction.'
            ],async()=>{await api(`/v2/grants/${selected.id}/migrate`,{});await refresh();setSelected(undefined);setNotice('HTTP grant migrated. Original grant remains in audit history.');})}>Migrate to current principal</button>}
          {selected.status === 'active' && <button className="cpDanger" onClick={() => withReview('Revoke grant', ['All operations bound to this grant will be denied immediately.', selected.id], async () => {
            await api(`/v2/grants/${selected.id}`, { status: 'revoked' }, 'PATCH'); await refresh(); setSelected(undefined);
          })}>Revoke grant</button>}</div>}</section></div>}

      {view === 'policies' && <div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">03 / ORDERED DECISIONS</span><h2>{editPolicyId?'Edit ordered policy':'Create a policy'}</h2><p>Rules run top to bottom. The first matching rule decides. No match means deny.</p>
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
        {selected && policies.some(item=>item.id===selected.id) && <div className="cpDetail"><h3>{selected.name}</h3>{selected.rules?.map((rule:Item,i:number)=><p key={rule.id}>{i+1}. <b>{rule.name}</b> · {rule.effect} · {rule.methods?.join(', ')} · {rule.paths?.join(', ')}</p>)}<button onClick={()=>{setEditPolicyId(selected.id);setPolicyForm({agentId:selected.agent_id,name:selected.name,rules:selected.rules.map((rule:Item)=>({
          id:rule.id,name:rule.name,effect:rule.effect,methods:rule.methods,paths:rule.paths,
          destinations:rule.destinations,maxRequests:rule.maxRequests??60,periodSeconds:rule.periodSeconds??60,
          maxSpendMinor:rule.maxSpendMinor??'',currency:rule.currency??'USD',
          startHour:rule.windowUtc?.startHour?.toString()??'',endHour:rule.windowUtc?.endHour?.toString()??''}))});}}>Edit rules</button><button className="cpDanger" onClick={()=>withReview('Disable policy',[`All linked endpoints will deny requests.`,selected.name],async()=>{await api(`/v2/policies/${selected.id}`,{status:'disabled'},'PATCH');await refresh();setSelected(undefined);})} disabled={selected.status==='disabled'}>Disable policy</button></div>}</section></div>}

      {view === 'endpoints' && <><div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">02 / UPSTREAM</span><h2>Register a service</h2><p>Give Pact the upstream origin. The agent only receives Pact’s proxy URL.</p>
        <Field label="Agent"><select value={serviceForm.agentId} onChange={e=>setServiceForm({...serviceForm,agentId:e.target.value})}><option value="">Select agent</option>{agents.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Service name"><input value={serviceForm.name} onChange={e=>setServiceForm({...serviceForm,name:e.target.value})} placeholder="Orders API"/></Field>
        <Field label="Base URL" hint="HTTPS origin, for example https://api.example.com. Local HTTP is allowed only in the demo environment."><input value={serviceForm.baseUrl} onChange={e=>setServiceForm({...serviceForm,baseUrl:e.target.value})} placeholder="https://api.example.com"/></Field>
        <Field label="Upstream authentication"><select value={serviceForm.authMethod} onChange={e=>setServiceForm({...serviceForm,authMethod:e.target.value})}><option value="none">No credential</option><option value="bearer">Bearer token</option><option value="header">Custom header</option></select></Field>
        {serviceForm.authMethod==='header' && <Field label="Header name"><input value={serviceForm.authHeader} onChange={e=>setServiceForm({...serviceForm,authHeader:e.target.value})} placeholder="X-API-Key"/></Field>}
        {serviceForm.authMethod!=='none' && <Field label="Upstream secret" hint="Encrypted at rest. Never shown again or given to your agent."><input type="password" autoComplete="off" value={serviceForm.secret} onChange={e=>setServiceForm({...serviceForm,secret:e.target.value})}/></Field>}
        <button className="cpPrimary" disabled={busy || !serviceForm.agentId || !serviceForm.baseUrl || !serviceForm.name} onClick={()=>withReview('Register service',[
          `Agent: ${agents.find(item=>item.id===serviceForm.agentId)?.name}`,`Upstream: ${serviceForm.baseUrl}`,
          `Credential: ${serviceForm.authMethod==='none'?'none':`${serviceForm.authMethod} (stored encrypted)`}`],async()=>{
          const created=await api<Item>('/v2/services',{agentId:serviceForm.agentId,name:serviceForm.name,baseUrl:serviceForm.baseUrl,
            authMethod:serviceForm.authMethod,...(serviceForm.authMethod==='header'?{authHeader:serviceForm.authHeader}:{})});
          if(serviceForm.authMethod!=='none') await api(`/v2/services/${created.id}/secret`,{secret:serviceForm.secret},'PUT');
          setServiceForm({...serviceForm,name:'',baseUrl:'',secret:''});await refresh();setNotice('Service connected. Create a grant and policy before registering an operation.');
        })}>Review service <Icon name="arrow" size={15}/></button></section>
        <section className="cpCard"><span className="cpEyebrow">UPSTREAM SERVICES</span><h2>Manage services</h2>
          {services.length ? services.map(item => <div className="cpListRow" key={item.id}><span className="cpAvatar"><Icon name="globe" size={18}/></span><div><strong>{item.name}</strong><small>{item.base_url} · {item.auth_method} · {item.status} · credential {item.has_secret ? 'stored' : 'missing'}</small></div><button onClick={()=>{setSelected(item);setReplacementSecret('');}}>Manage</button></div>) : <Empty title="No services" detail="Register an upstream service to manage its operations and credential."/>}
          {selected && services.some(item=>item.id===selected.id) && <div className="cpDetail"><h3>{selected.name}</h3><p>Agent: {agents.find(item=>item.id===selected.agent_id)?.name ?? selected.agent_id}</p><p>Base URL: <code>{selected.base_url}</code></p><p>Authentication: {selected.auth_method}{selected.auth_header ? ` · ${selected.auth_header}` : ''}</p><p>Status: {selected.status}</p>
            <button onClick={()=>withReview(selected.status==='active'?'Disable service':'Enable service',[selected.name,selected.base_url],async()=>{await api(`/v2/services/${selected.id}`,{status:selected.status==='active'?'disabled':'active'},'PATCH');await refresh();setSelected(undefined);})}>{selected.status==='active'?'Disable service':'Enable service'}</button>
            {selected.auth_method!=='none' && <><Field label="Replacement upstream secret"><input type="password" autoComplete="off" value={replacementSecret} onChange={e=>setReplacementSecret(e.target.value)}/></Field><button disabled={replacementSecret.length<8} onClick={()=>withReview('Rotate upstream credential',[`Service: ${selected.name}`,'The prior credential stops being used immediately.'],async()=>{await api(`/v2/services/${selected.id}/secret`,{secret:replacementSecret},'PUT');setReplacementSecret('');await refresh();setSelected(undefined);})}>Rotate credential</button><button className="cpDanger" onClick={()=>withReview('Revoke upstream credential',[`Service: ${selected.name}`,'Authenticated calls will fail until a replacement is stored.'],async()=>{await api(`/v2/services/${selected.id}/secret`,undefined,'DELETE');await refresh();setSelected(undefined);})}>Revoke credential</button></>}
          </div>}</section>
        <section className="cpCard"><span className="cpEyebrow">04 / OPERATION</span><h2>Register an endpoint</h2><p>Each operation binds one method and route to one grant and one policy.</p>
          <Field label="Service"><select value={endpointForm.serviceId} onChange={e=>{setEndpointForm({...endpointForm,serviceId:e.target.value});setOpenApiPreview(undefined);}}><option value="">Select service</option>{activeServices.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <div className="cpGrid2"><Field label="HTTP method"><select value={endpointForm.method} onChange={e=>setEndpointForm({...endpointForm,method:e.target.value})}>{['GET','POST','PUT','PATCH','DELETE'].map(value=><option key={value}>{value}</option>)}</select></Field><Field label="Route pattern"><input value={endpointForm.pathPattern} onChange={e=>setEndpointForm({...endpointForm,pathPattern:e.target.value})} placeholder="/health"/></Field></div>
          <Field label="Description"><input value={endpointForm.description} onChange={e=>setEndpointForm({...endpointForm,description:e.target.value})} placeholder="Read health status"/></Field>
          <div className="cpGrid2"><Field label="Grant"><select value={endpointForm.grantId} onChange={e=>{setEndpointForm({...endpointForm,grantId:e.target.value});setOpenApiPreview(undefined);}}><option value="">Select grant</option>{grants.filter(item=>item.status==='active').map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Policy"><select value={endpointForm.policyId} onChange={e=>{setEndpointForm({...endpointForm,policyId:e.target.value});setOpenApiPreview(undefined);}}><option value="">Select policy</option>{policies.filter(item=>item.status==='active').map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div>
          <div className="cpGrid2"><Field label="Fixed cost, minor units" hint="0 for free operations"><input inputMode="numeric" value={endpointForm.costMinor} onChange={e=>setEndpointForm({...endpointForm,costMinor:e.target.value})}/></Field><Field label="Currency"><input value={endpointForm.currency} onChange={e=>{setEndpointForm({...endpointForm,currency:e.target.value.toUpperCase()});setOpenApiPreview(undefined);}}/></Field></div>
          <Field label="Returned JSON fields" hint="For protected services, only these top-level fields reach the agent. Example: status, service, ok. Empty means no upstream body."><input value={endpointForm.responseFields.join(', ')} onChange={e=>setEndpointForm({...endpointForm,responseFields:e.target.value.split(',').map(value=>value.trim()).filter(Boolean)})}/></Field>
          <button className="cpPrimary" disabled={busy || !endpointForm.serviceId || !endpointForm.grantId || !endpointForm.policyId} onClick={()=>withReview('Register operation',[
            `${endpointForm.method} ${endpointForm.pathPattern}`,`Service: ${services.find(item=>item.id===endpointForm.serviceId)?.name}`,
            `Grant: ${grants.find(item=>item.id===endpointForm.grantId)?.name}`,`Policy: ${policies.find(item=>item.id===endpointForm.policyId)?.name}`,
            `Cost: ${moneyLabel(endpointForm.costMinor,endpointForm.currency)}`],async()=>{await api('/v2/endpoints',endpointForm);await refresh();setNotice('Endpoint registered. Issue a scoped API key to call it.');})}>Review endpoint <Icon name="arrow" size={15}/></button>
        </section></div>
        <div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">OPENAPI IMPORT</span><h2>Import operations</h2><p>Paste an OpenAPI 3 document. Preview its routes, then import them under the selected service, grant, and policy. Remote references are not fetched.</p>
          <textarea className="cpCodeInput" value={openApi} onChange={e=>{setOpenApi(e.target.value);setOpenApiPreview(undefined);}} placeholder='{"openapi":"3.0.0","info":{"title":"Demo"},"servers":[{"url":"https://api.example.com"}],"paths":{"/health":{"get":{"summary":"Health"}}}}'/>
          <div className="cpActions"><button onClick={()=>void run(async()=>setOpenApiPreview(await api('/v2/openapi/preview',{spec:JSON.parse(openApi)})))} disabled={!openApi}>Preview import</button>
          <button className="cpPrimary" disabled={!openApiPreview || !endpointForm.serviceId || !endpointForm.grantId || !endpointForm.policyId} onClick={()=>withReview('Import OpenAPI operations',openApiPreview?.operations?.map((item:Item)=>`${item.method} ${item.pathPattern}`)??[],async()=>{
            await api(`/v2/services/${endpointForm.serviceId}/import`,{spec:JSON.parse(openApi),grantId:endpointForm.grantId,policyId:endpointForm.policyId,currency:endpointForm.currency});await refresh();setOpenApiPreview(undefined);setNotice('OpenAPI operations imported.');
          })}>Import reviewed routes</button></div>{openApiPreview && <pre>{JSON.stringify(openApiPreview.operations,null,2)}</pre>}</section>
        <section className="cpCard"><span className="cpEyebrow">SAFE TEST CONSOLE</span><h2>Try a call through Pact</h2><p>GET reaches the registered upstream only if policy allows it. Use an unregistered path or forbidden method to test a denial that never forwards.</p>
          <Field label="Scoped integration key"><input type="password" value={testKey} onChange={e=>setTestKey(e.target.value)} placeholder="pat_…"/></Field>
          <div className="cpGrid2"><Field label="Method"><select value={testMethod} onChange={e=>setTestMethod(e.target.value)}>{['GET','POST','PUT','PATCH','DELETE'].map(value=><option key={value}>{value}</option>)}</select></Field><Field label="Path"><input value={testPath} onChange={e=>setTestPath(e.target.value)} placeholder="/health"/></Field></div>
          <button disabled={!gatewayOrigin || !testKey || !endpointForm.serviceId} onClick={()=>void run(async()=>{
            const service=services.find(item=>item.id===endpointForm.serviceId);
            if(!service) throw Error('Select a service');
            const response=await fetch(`${gatewayBase}/v2/proxy/${service.agent_id}/${service.id}${testPath}`,{method:testMethod,headers:{Authorization:`Bearer ${testKey}`},redirect:'error'});
            setTestResult(`${response.status} ${await response.text()}`);await refreshActivity();
          })}>Send real test request</button>{testResult && <pre role="status">{testResult}</pre>}</section></div>
        <section className="cpCard"><span className="cpEyebrow">REGISTERED OPERATIONS</span><h2>Endpoints by service</h2>{endpoints.length ? endpoints.map(item=><div className="cpListRow" key={item.id}><span className={`cpMethod ${item.method.toLowerCase()}`}>{item.method}</span><div><strong>{item.path_pattern}</strong><small>{item.service_name} · {item.agent_name} · {item.policy_name} · {item.status} · last used {item.last_used_at?new Date(item.last_used_at).toLocaleString():'never'}</small></div><button onClick={()=>{setSelected(item);setResponseFieldsDraft((item.response_fields??[]).join(', '));}}>Details</button></div>) : <Empty title="No endpoints yet" detail="Register a service, grant and policy, then add an operation."/>}
          {selected && endpoints.some(item=>item.id===selected.id) && <div className="cpDetail"><h3>{selected.method} {selected.path_pattern}</h3><p>{selected.description}</p><p>Service: {selected.service_name} · <code>{selected.base_url}</code></p><p>Authentication: {services.find(item=>item.id===selected.service_id)?.auth_method ?? 'unknown'}</p><p>Policy: {selected.policy_name}</p><p>Grant: {selected.grant_id}</p><p>Fixed cost: {moneyLabel(selected.cost_minor,selected.currency)}</p><Field label="Returned JSON fields" hint="Protected upstreams return only these top-level fields; leave empty for an empty body."><input value={responseFieldsDraft} onChange={e=>setResponseFieldsDraft(e.target.value)}/></Field><button onClick={()=>withReview('Update response fields',[`Operation: ${selected.method} ${selected.path_pattern}`,`Fields: ${responseFieldsDraft || '(none)'}`],async()=>{await api(`/v2/endpoints/${selected.id}`,{responseFields:responseFieldsDraft.split(',').map(value=>value.trim()).filter(Boolean)},'PATCH');await refresh();setSelected(undefined);})}>Review response fields</button><code>{gatewayBase}/v2/proxy/{selected.agent_id}/{selected.service_id}{selected.path_pattern}</code><div className="cpActions"><button onClick={()=>void run(async()=>{await api(`/v2/endpoints/${selected.id}`,{status:selected.status==='active'?'disabled':'active'},'PATCH');await refresh();setSelected(undefined);})}>{selected.status==='active'?'Disable':'Enable'} operation</button></div></div>}</section></>}

      {view === 'keys' && <div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">05 / INTEGRATION CREDENTIAL</span><h2>Issue an API key</h2><p>The key authenticates proxy calls for one agent. It cannot sign transactions, grant authority, or read the upstream secret.</p>
        <Field label="Agent"><select value={keyForm.agentId} onChange={e=>{setKeyForm({...keyForm,agentId:e.target.value});void refreshKeys(e.target.value).catch(()=>{});}}><option value="">Select agent</option>{agents.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Key name"><input value={keyForm.name} onChange={e=>setKeyForm({...keyForm,name:e.target.value})} placeholder="Local MCP client"/></Field>
        <Field label="Scopes"><div className="cpChecks">{['proxy.read','proxy.write'].map(scope=><label key={scope}><input type="checkbox" checked={keyForm.scopes.includes(scope)} onChange={e=>setKeyForm({...keyForm,scopes:e.target.checked?[...keyForm.scopes,scope]:keyForm.scopes.filter(value=>value!==scope)})}/>{scope}</label>)}</div></Field>
        <Field label="Expires at"><input type="datetime-local" value={localDateTime(keyForm.expiresAt)} onChange={e=>{ if(e.target.value) setKeyForm({...keyForm,expiresAt:new Date(e.target.value).toISOString()}); }}/></Field>
        <button className="cpPrimary" disabled={busy || !keyForm.agentId || !keyForm.scopes.length} onClick={()=>withReview('Issue scoped key',[
          `Agent: ${selectedAgent?.name}`,`Scopes: ${keyForm.scopes.join(', ')}`,`Expires: ${keyForm.expiresAt}`,
          'The secret is displayed once. Only its SHA-256 hash is stored.'],async()=>{
            const result=await api<Item>(`/v2/agents/${keyForm.agentId}/keys`,{name:keyForm.name,scopes:keyForm.scopes,expiresAt:keyForm.expiresAt});
            setNewSecret(result.secret);setTestKey(result.secret);await refreshKeys(keyForm.agentId);await refresh();setNotice('Key issued. Copy it now; Pact will not show it again.');
          })}>Review and issue <Icon name="arrow" size={15}/></button>
        {newSecret && <div className="cpSecret" role="alert"><strong>Copy this key now</strong><code>{newSecret}</code><Copy text={newSecret} label="Copy key"/><button onClick={()=>setNewSecret('')}>I saved it</button></div>}
        <div className="cpDivider"/><h3>Keys for {selectedAgent?.name??'selected agent'}</h3>{keys.length ? keys.map(item=><div className="cpListRow" key={item.id}><span className="cpAvatar"><Icon name="key" size={18}/></span><div><strong>{item.name}</strong><small>{item.prefix}… · {item.scopes?.join(', ')} · {item.revoked_at?'revoked':new Date(item.expires_at)<new Date()?'expired':'active'}</small><small>Last used: {item.last_used_at?new Date(item.last_used_at).toLocaleString():'never'}</small></div>{!item.revoked_at && <div className="cpKeyActions"><button onClick={()=>withReview('Rotate key',[`Old key ${item.prefix}… stops working immediately.`,`New key keeps scopes ${item.scopes.join(', ')} and expiry.`],async()=>{const result=await api<Item>(`/v2/agents/${keyForm.agentId}/keys/${item.id}/rotate`,{});setNewSecret(result.secret);setTestKey(result.secret);await refreshKeys(keyForm.agentId);await refresh();})}>Rotate</button><button className="cpDanger" onClick={()=>withReview('Revoke key',[`Key ${item.prefix}… will stop working immediately.`],async()=>{await api(`/v2/agents/${keyForm.agentId}/keys/${item.id}`,undefined,'DELETE');await refreshKeys(keyForm.agentId);await refresh();})}>Revoke</button></div>}</div>) : <Empty title="No keys for this agent" detail="Issue one after registering an endpoint."/>}</section>
        <section className="cpCard"><span className="cpEyebrow">INTEGRATE</span><h2>Call Pact from your agent</h2><p>Use the gateway URL with the scoped key. Keep the key in a server-side secret store. It is never an onchain signer.</p>
          <Field label="Proxy URL"><code className="cpCode">{proxyUrl}</code><Copy text={proxyUrl}/></Field>
          <h3>TypeScript</h3><pre>{`import { PactHttpClient } from '@pact/sdk-ts';\nconst pact = new PactHttpClient('${gatewayBase}', process.env.PACT_AGENT_KEY!);\nconst result = await pact.proxy('${exampleAgent?.id??'AGENT_ID'}','${exampleService?.id??'SERVICE_ID'}','GET','/health');`}</pre>
          <h3>Python</h3><pre>{`import os\nfrom pact import PactClient\npact = PactClient('${gatewayBase}', token=os.environ['PACT_AGENT_KEY'])\nresult = pact.proxy('${exampleAgent?.id??'AGENT_ID'}','${exampleService?.id??'SERVICE_ID'}','GET','/health')`}</pre>
          <h3>curl</h3><pre>{`curl '${proxyUrl}' -H 'Authorization: Bearer '$PACT_AGENT_KEY`}</pre>
          <h3>MCP</h3><pre>{`PACT_GATEWAY_URL=${gatewayBase} PACT_AGENT_KEY=pat_… pact-mcp`}</pre>
          <p className="cpHint">Set <code>PACT_API_URL={apiBase}</code> for authority reads. The key only allows its listed proxy scopes.</p></section></div>}

      {view === 'approvals' && <section className="cpCard"><span className="cpEyebrow">HUMAN DECISION</span><h2>Approval inbox</h2><p>Approval binds one exact request hash, endpoint, agent, and 15-minute window. The agent must retry with the approval ID; approval alone never forwards a call.</p>
        {approvals.length ? approvals.map(item=><div className="cpListRow" key={item.id}><span className="cpAvatar"><Icon name="inbox" size={18}/></span><div><strong>{item.agent_name} · {item.method} {item.path_pattern}</strong><small>{item.state} · expires {new Date(item.expires_at).toLocaleString()}</small><small>Grant: {item.grant_name ?? item.grant_id ?? 'legacy request'} · Policy: {item.policy_name ?? item.policy_id ?? 'legacy request'} · Rule: {item.matched_rule ?? 'unavailable'}</small><small>Declared cost: {item.cost_minor == null ? 'unavailable' : moneyLabel(item.cost_minor, item.currency)} · Request digest: {item.request_hash}</small><code>{item.id}</code></div>{item.state==='pending' && <div className="cpKeyActions"><button className="cpPrimary" onClick={()=>withReview('Approve exact request',[`Agent: ${item.agent_name}`,`Operation: ${item.method} ${item.path_pattern}`,`Grant: ${item.grant_name ?? item.grant_id}`,`Policy: ${item.policy_name ?? item.policy_id}; rule: ${item.matched_rule}`,`Declared cost: ${item.cost_minor == null ? 'unavailable' : moneyLabel(item.cost_minor, item.currency)}`,`Request digest: ${item.request_hash}`,`Expires: ${item.expires_at}`],async()=>{await api(`/v2/approvals/${item.id}/decision`,{decision:'approved'});await refresh();})}>Approve</button><button className="cpDanger" onClick={()=>withReview('Reject exact request',[`Agent: ${item.agent_name}`,`Operation: ${item.method} ${item.path_pattern}`,`Request digest: ${item.request_hash}`],async()=>{await api(`/v2/approvals/${item.id}/decision`,{decision:'rejected'});await refresh();})}>Reject</button></div>}</div>) : <Empty title="No approval requests" detail="A policy rule requiring approval will place an exact request here."/>}</section>}

      {view === 'activity' && <section className="cpCard"><div className="cpCardHead"><span className="cpEyebrow"><i className="cpPulse"/> AUTO-UPDATING EVERY 3 SECONDS</span><h2>Agent activity</h2><p>Method, decision, rule and latency are recorded. Request and response bodies, secrets and query strings are excluded.</p></div>
        {activityError && <p role="alert">{activityError} <button onClick={() => void refreshActivity().catch(() => setActivityError('Activity is still unavailable.'))}>Retry activity</button></p>}
        <div className="cpFilters"><input aria-label="Search activity" placeholder="Search route, reason, agent" value={activityFilters.search} onChange={e=>setActivityFilters({...activityFilters,search:e.target.value})}/><select aria-label="Decision filter" value={activityFilters.decision} onChange={e=>setActivityFilters({...activityFilters,decision:e.target.value})}><option value="">All decisions</option><option value="allowed">Allowed</option><option value="denied">Denied</option><option value="pending_approval">Pending approval</option></select><select aria-label="Agent filter" value={activityFilters.agentId} onChange={e=>setActivityFilters({...activityFilters,agentId:e.target.value})}><option value="">All agents</option>{agents.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><button onClick={()=>void run(()=>refreshActivity())}>Search</button></div>
        {activity.length ? <><div className="cpActivityTable"><div className="cpActivityHeader"><span>TIME / AGENT</span><span>REQUEST</span><span>DECISION</span><span>RULE / REASON</span><span>UPSTREAM</span></div>{activity.map(item=><button key={item.id} className="cpActivityRow" onClick={()=>void run(async()=>setSelected(await api(`/v2/activity/${item.id}`)))}><span><strong>{new Date(item.created_at).toLocaleTimeString()}</strong><small>{item.agent_name}</small></span><span><b>{item.method}</b> {item.route}</span><span className={`cpDecision ${item.decision}`}>{item.decision.replace('_',' ')}</span><span><strong>{item.matched_rule??'—'}</strong><small>{item.reason}</small></span><span>{item.upstream_status??'—'} · {item.latency_ms??'—'} ms</span></button>)}</div>
          {activityCursor && <button onClick={()=>void run(()=>refreshActivity(true))}>Load older events</button>}</> : <Empty title="No activity yet" detail="Issue a key, call a registered GET through Pact, then try an unregistered path. Both decisions will appear here automatically."/>}
        {selected?.trace && <div className="cpDetail"><h3>Request {selected.id}</h3><p>{selected.method} {selected.route} · {selected.decision}</p><p>Agent {selected.agent_id} · Key {selected.key_id}</p><p>Grant {selected.grant_id} · Policy {selected.policy_id}</p><p>Approval {selected.approval_id??'not required'} · Upstream {selected.upstream_status??'not reached'}</p><h4>Decision trace</h4>{selected.trace.map((step:Item,i:number)=><p key={i}>{i+1}. <b>{step.name}</b> ({step.ruleId}) — {step.result}: {step.reason}</p>)}<p className="cpHint">Private gateway event. This entry is not independently anchored on Monad.</p></div>}</section>}

      {view === 'audit' && <section className="cpCard"><span className="cpEyebrow">ACCOUNT CHANGES</span><h2>Audit history</h2><p>Changes to agents, grants, policies, services, endpoints, keys, and approvals are recorded with your account identity.</p>
        {auditEvents.length ? auditEvents.map(item => <div className="cpListRow" key={item.id}><span className="cpAvatar"><Icon name="book" size={17}/></span><div><strong>{item.action}</strong><small>{new Date(item.created_at).toLocaleString()}</small><code>{JSON.stringify(item.details)}</code></div></div>) : <Empty title="No changes yet" detail="Create an agent or policy to start an audit history."/>}
        {auditCursor && <button onClick={() => void run(() => refreshAudit(true))}>Load older changes</button>}</section>}

      {view === 'account' && <div className="cpTwo"><section className="cpCard"><span className="cpEyebrow">ACCOUNT PRINCIPAL</span><h2>Your address</h2><p>Future HTTP grants use this address automatically. An account-assigned address identifies your Pact records but has no signing key. Monad transactions require a separately proved external signer.</p>{account.principalAddress ? <div className="cpAddress"><code>{account.principalAddress}</code><Copy text={account.principalAddress}/></div> : <p>Your account address is being assigned. You can register agents while this finishes.</p>}{account.verificationStatus === 'verified' && <p className="cpVerified"><Icon name="check" size={16}/> External address verified by a one-time signature</p>}{account.verificationStatus === 'account_assigned' && <p className="cpVerified"><Icon name="check" size={16}/> Assigned to this signed-in Pact account for HTTP authority</p>}
        <h3>Monad account</h3><p>{account.onchainStatus==='deployed' ? `Controlled account: ${account.onchainAccount}` : account.onchainStatus==='external_proof_required' ? 'To use Monad transactions, change to an external address and prove control with its signature. HTTP agents work without this step.' : account.onchainStatus==='factory_unconfigured' ? 'Per-user Monad account deployment is not configured by the operator yet.' : account.onchainStatus==='rpc_unavailable' ? 'Monad status is temporarily unavailable. HTTP agent management remains available.' : 'No controlled Monad account has been deployed for this address. HTTP agents work without it.'}</p>
        {account.onchainStatus==='not_deployed' && account.verificationStatus==='verified' && <button onClick={()=>withReview('Deploy your Monad account',[
          `Signer: ${account.principalAddress}`,'This is a real Monad transaction. Your account wallet must have MON for gas. The integration key cannot sign it.'
        ],async()=>{
          const transaction=await api<Item>('/v2/account/onchain/prepare',{});
          const wallet=wallets.find(item=>item.address.toLowerCase()===account.principalAddress.toLowerCase());
          if(!wallet) throw Error('Connect the account address before sending the transaction.');
          const provider=await wallet.getEthereumProvider();
          await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:`0x${Number(transaction.chainId).toString(16)}`}]});
          const hash=await provider.request({method:'eth_sendTransaction',params:[{from:transaction.from,to:transaction.to,data:transaction.data}]});
          setNotice(`Monad transaction submitted: ${String(hash)}. Refresh Account after confirmation.`);
        })}>Review account deployment</button>}
        <button onClick={()=>void run(async()=>setAccount(await api('/v2/account')))}>Refresh chain status</button>
        <h3>Change principal address</h3><p>The new address must sign a Pact challenge. Existing grants keep their original principal. Use each HTTP grant's audited migration action afterward; existing Monad grants require a separate signed reissuance.</p><Field label="New address"><input value={changeAddress} onChange={e=>setChangeAddress(e.target.value)} placeholder="0x…"/></Field>
        <button onClick={() => connectWallet()}>Connect address to verify</button>
        <button disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(changeAddress)} onClick={()=>withReview('Change principal address',[`Current: ${account.principalAddress}`,`New: ${changeAddress}`,'Existing grants remain under their original principal and must be reissued explicitly.'],async()=>{
          const matching=wallets.find(item=>item.address.toLowerCase()===changeAddress.toLowerCase());
          if(!matching) throw Error('Add the new address to this account first, then retry. Pact must verify its signature.');
          const challenge=await api<Item>('/v2/account/address/challenge',{address:changeAddress});
          const provider=await matching.getEthereumProvider();
          const signature=await provider.request({method:'personal_sign',params:[challenge.message,matching.address]});
          await api('/v2/account/address/verify',{challengeId:challenge.challengeId,signature});
          setAccount(await api('/v2/account'));await refresh();setChangeAddress('');setNotice('Principal changed for future grants. Existing grants are unchanged.');
        })}>Review address change</button>
        <button onClick={()=>void run(async()=>{await linkWithPasskey({name:'Pact Console'});setNotice('Passkey added to your account.');})}>Add passkey</button></section>
        <section className="cpCard"><span className="cpEyebrow">MIGRATION & CUSTODY</span><h2>Existing grants</h2><p>Wallet-backed Monad grants continue to use the principal that signed them. Changing this account address cannot mutate immutable grant history.</p><p>{legacyCount===null?'Check your existing grant list before migrating.':`${legacyCount} indexed legacy grants are visible to the original principal session.`}</p><a href="/legacy">Open existing Monad grant manager ↗</a><a href="/docs#custody">Read custody, recovery and revocation model ↗</a><p className="cpHint">For HTTP grants, use the migration action in Grants. For Monad grants, revoke with the original signer, create a new grant with the new signer, then rotate affected credentials.</p></section></div>}
      </>}
      </main><footer className="cpFooter"><span>PACT PROTOCOL · Programmable authority for agents</span><span>Private gateway activity · Monad receipts only when anchored</span></footer></div>
    {review && <div className="cpReviewShade" role="presentation"><div className="cpReview" role="dialog" aria-modal="true" aria-label={review.title}><span className="cpEyebrow">REVIEW BEFORE APPLYING</span><h2>{review.title}</h2><ul>{review.summary.map((line,i)=><li key={i}>{line}</li>)}</ul><div className="cpActions"><button onClick={()=>setReview(undefined)}>Cancel</button><button className="cpPrimary" onClick={confirm} disabled={busy}>Confirm change</button></div></div></div>}
  </div>;
}
