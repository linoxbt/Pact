import { activeNetwork, networkNotice } from './networks.js';
import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { request } from './api.js';
import { Brand, CodeBlock, Icon } from './ui.js';
import { DocsContent } from './Docs.js';
import './site.css';
import './agent.css';

const apiUrl = import.meta.env.VITE_PACT_API_URL as string | undefined;
const ConsoleApp = lazy(() => import('./PrivyConsole.js'));
const nav = [{ href: '/', label: 'Protocol' }, { href: '/docs', label: 'Developers' }, { href: '/explorer', label: 'Explorer' }];
function Shell({ children, active }: { children: React.ReactNode; active: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('revealed'); observer.unobserve(entry.target); }
    }), { threshold: 0.08 });
    document.querySelectorAll('[data-reveal]').forEach(item => observer.observe(item));
    return () => observer.disconnect();
  }, []);
  return <div className="siteShell"><a href="#main-content" className="skipLink">Skip to content</a>
    <div className="announcement"><span className="statusDot"/> Pact is live on {activeNetwork.name} <a href="/docs#quickstart">Start building <Icon name="arrow" size={13}/></a></div>
    <nav className="siteNav" aria-label="Primary"><Brand/><div className={`navLinks ${open ? 'navOpen' : ''}`}>{nav.map(item => <a key={item.href} aria-current={active === item.href ? 'page' : undefined} href={item.href}>{item.label}</a>)}<a href="https://github.com/linoxbt/Pact">GitHub <Icon name="external" size={13}/></a></div><a className="navCta" href="/app">Launch app <Icon name="external" size={16}/></a><button className="mobileMenu" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Close navigation' : 'Open navigation'}><Icon name={open ? 'close' : 'menu'}/></button></nav>
    {children}
    <footer className="siteFooter"><div className="footerTop"><div><Brand/><p>Built for agents.<br/>Accountable to you.</p></div><div className="footerLinks"><div><span>PRODUCT</span><a href="/app">Console</a><a href="/explorer">Explorer</a><a href="/#architecture">Architecture</a></div><div><span>DEVELOPERS</span><a href="/docs#quickstart">Quickstart</a><a href="/docs#sdk">SDKs & integrations</a><a href="https://github.com/linoxbt/Pact">GitHub ↗</a></div><div><span>NETWORK</span><a href="/docs#network">{activeNetwork.name}</a><a href="/docs#authority">Authority model</a><a href="/docs#evidence">Trust & verification</a></div></div></div><div className="footerBottom"><span>© {new Date().getFullYear()} Pact Protocol</span><span><i className="statusDot"/> {networkNotice}</span><span>Permission with a paper trail.</span></div></footer>
  </div>;
}
function AuthorityGraphic() {
  return <div className="authorityGraphic" role="img" aria-label="An illustrated authority flow: an owner defines a grant and policy, an agent acts within it, and Pact records the decision.">
    <div className="graphGrid"/><div className="graphTop"><span><i className="statusDot"/> AUTHORITY NETWORK</span><span>ILLUSTRATION / 001</span></div>
    <svg className="authoritySvg" viewBox="0 0 620 520" fill="none" aria-hidden="true">
      <defs><linearGradient id="prism" x1="190" y1="140" x2="420" y2="390" gradientUnits="userSpaceOnUse"><stop stopColor="#b5f8d2"/><stop offset="1" stopColor="#3b8a70" stopOpacity=".08"/></linearGradient><radialGradient id="halo"><stop stopColor="#85e6b1" stopOpacity=".22"/><stop offset="1" stopColor="#85e6b1" stopOpacity="0"/></radialGradient></defs>
      <circle cx="310" cy="260" r="245" fill="url(#halo)"/>
      <g className="orbitRing"><ellipse cx="310" cy="260" rx="255" ry="117" transform="rotate(-30 310 260)" stroke="#76aa94" strokeOpacity=".35"/><ellipse cx="310" cy="260" rx="255" ry="117" transform="rotate(30 310 260)" stroke="#76aa94" strokeOpacity=".25"/></g>
      <path className="signalPath" d="M80 167 310 260 540 351M80 350 310 260 540 167" stroke="#a9f5cb" strokeWidth="1.2" strokeDasharray="4 12"/>
      <g className="prismFloat"><path d="m310 137 112 64v128l-112 64-112-64V201l112-64Z" fill="url(#prism)" fillOpacity=".4" stroke="#b6f4d2"/><path d="m198 201 112 64 112-64M310 265v128m0-256v128m-112 64 112-64 112 64" stroke="#c9ffe2" strokeOpacity=".7"/><path d="m310 177 77 44v88l-77 44-77-44v-88l77-44Z" stroke="#c9ffe2" strokeOpacity=".4"/><path d="m310 223 37 21v42l-37 21-37-21v-42l37-21Z" fill="#b5f8d2"/><path d="m292 262 12 12 26-28" stroke="#153b2f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></g>
      {[[80,167],[540,351],[80,350],[540,167]].map(([x,y],i)=><g key={i}><circle cx={x} cy={y} r="7" fill="#15382b" stroke="#b6f4d2"/><circle className="nodePulse" style={{animationDelay:`${i*.6}s`}} cx={x} cy={y} r="14" stroke="#b6f4d2" strokeOpacity=".3"/></g>)}
    </svg>
    <div className="graphCard principalCard"><span className="graphIcon"><Icon name="wallet" size={17}/></span><div><small>PRINCIPAL</small><strong>Your authority.</strong></div><Icon name="check" size={15}/></div>
    <div className="graphCard agentCard"><span className="graphIcon"><Icon name="agent" size={17}/></span><div><small>AUTONOMOUS AGENT</small><strong>Bound by your rules.</strong></div></div>
    <div className="graphReceipt"><span><Icon name="activity" size={15}/> Policy decision</span><div><span>Authority → Activity</span><Icon name="check" size={15}/></div></div>
    <div className="graphBottom"><span>EXPLICIT SCOPE</span><span>RECORDED OUTCOME <span>↗</span></span></div>
  </div>;
}
const stages = [
  { icon:'agent', title:'Connect your agent.', body:'Register an agent and the HTTP services or tools it may call. Pact keeps the upstream credential protected.', code:'agent.connected', value:'A named integration', detail:'Agent · service · operation' },
  { icon:'shield', title:'Define authority.', body:'Create an owner-backed grant, ordered policy rules, and a scoped integration key.', code:'policy.boundary', value:'Explicit permissions', detail:'Methods · paths · limits · expiry' },
  { icon:'layers', title:'Check before forwarding.', body:'Every proposed action passes through Pact. Denied calls stop before reaching the upstream.', code:'policy.decision', value:'Allow, deny, or approve', detail:'Matched rule · exact reason' },
  { icon:'activity', title:'Watch what happened.', body:'See each decision and upstream outcome in live private activity. Monad receipts are separate when anchored.', code:'activity.recorded', value:'An attributable event', detail:'Agent · request ID · latency' },
];
function Landing() {
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState<'TypeScript'|'MCP'>('TypeScript');
  const examples = { TypeScript: `import { PactHttpClient } from '@pact/sdk-ts';\n\nconst pact = new PactHttpClient(\n  process.env.PACT_GATEWAY_URL!,\n  process.env.PACT_AGENT_KEY!\n);\n\n// Pact checks the grant and ordered policy first.\nconst result = await pact.proxy(\n  'AGENT_ID', 'SERVICE_ID', 'GET', '/health'\n);`, MCP: `# From the Pact workspace\npnpm install --frozen-lockfile\npnpm --filter @pact/mcp build\n\n# A scoped key cannot sign chain transactions\nexport PACT_GATEWAY_URL="${import.meta.env.VITE_PACT_GATEWAY_URL || 'https://YOUR_PACT_GATEWAY'}"\nexport PACT_AGENT_KEY="pat_YOUR_ONE_TIME_SECRET"\n\npnpm --filter @pact/mcp start` };
  return <Shell active="/"><main id="main-content" className="landing">
    <section className="hero"><div className="heroCopy"><span className="eyebrow"><span className="tinyLine"/> THE AUTHORITY LAYER FOR AGENTS</span><h1>Autonomy.<br/>With <span className="serifWord">authority.</span></h1><p className="heroLead">Connect your agent. Set the rules. See every decision.<br/>Pact checks each API request before it reaches the upstream and records what happened.</p><div className="heroActions"><a className="primaryLink" href="/app">Connect an agent <Icon name="arrow" size={17}/></a><a className="quietLink" href="/docs">Explore the docs <Icon name="external" size={16}/></a></div><div className="heroProof"><span className="monadMark">◈</span><div>Built on <strong>Monad</strong><small>Onchain authority and receipts when transactions are required.</small></div></div></div><AuthorityGraphic/></section>
    <div className="principlesBar"><span>THE COMPLETE CHAIN OF ACCOUNTABILITY</span><div><span><Icon name="shield"/> Explicit permissions</span><span><Icon name="layers"/> Bounded execution</span><span><Icon name="activity"/> Live decisions</span></div></div>
    <section className="thesis contentSection" data-reveal><div><span className="eyebrow">POWER NEEDS PERMISSION</span><h2>Your agents can do more.<br/>You should know <em>exactly what.</em></h2></div><p>As agents gain access to money, APIs, and workflows, every action needs a clear line back to the person who authorized it. Pact makes that line explicit in grants, policy decisions, and activity.</p></section>
    <section className="workflow contentSection" id="how-it-works" data-reveal><div className="sectionHeading"><div><span className="eyebrow">01 / THE TRANSACTION LIFECYCLE</span><h2>From intention<br/>to accountability.</h2></div><p>Four steps. One continuous record.<br/>Every action stays connected to its authority.</p></div><div className="workflowGrid"><div className="stepList" role="group" aria-label="Transaction lifecycle">{stages.map((item,i)=><button key={item.title} aria-pressed={step===i} aria-controls="lifecycle-detail" id={`lifecycle-tab-${i}`} className={step===i?'selectedStep':''} onClick={()=>setStep(i)}><span className="stepNumber">0{i+1}</span><div><strong>{item.title}</strong>{step===i&&<p>{item.body}</p>}</div><Icon name="arrow" size={18}/></button>)}</div><div className="stepVisual" role="region" id="lifecycle-detail" aria-labelledby={`lifecycle-tab-${step}`}><div className="visualWindow"><span className="windowLabel">PACT / EXECUTION TRACE</span><div className="visualOrbit"><span className="orbitLine"/><span className="orbitLine second"/><div className="visualCore" key={step}><Icon name={stages[step].icon} size={48}/></div><span className="orbitPoint"/></div><div className="traceCard" key={`trace-${step}`}><span><i className="statusDot"/>{stages[step].code}</span><strong>{stages[step].value}</strong><small>{stages[step].detail}</small></div><span className="illustrationLabel">Illustrated protocol flow</span></div></div></div></section>
    <section className="architecture contentSection" id="architecture"><div className="sectionHeading" data-reveal><div><span className="eyebrow">02 / ONE CONNECTED SYSTEM</span><h2>Infrastructure for the<br/><em>agent economy.</em></h2></div><p>Six layers connect your policies to an agent’s actions. Integrate the parts you need. Preserve the same chain of authority.</p></div><div className="productGrid">{[
      ['shield','Protocol','The foundation of authority.','Monad contracts for grants, capacity, obligations, and settlement.','authority'],
      ['layers','Engine','Decisions before actions.','Policy evaluation, exact intent quotes, and commitment analysis.','authority'],
      ['code','SDK','Bring your own agent.','TypeScript and Python clients for scoped integrations.','sdk'],
      ['agent','MCP Server','Authority, in context.','Give MCP-capable agents tools to understand and use their scope.','mcp'],
      ['grid','Console','The human control plane.','Manage agents, permissions, provider keys, and approval requests.','agents'],
      ['globe','Explorer','Make outcomes inspectable.','Public authority disclosures and economic receipt anchors.','evidence'],
    ].map(([icon,title,tag,body,anchor],i)=><a className="productCard" key={title} href={`/docs#${anchor}`} data-reveal><div className="productTop"><Icon name={icon} size={25}/><span>0{i+1}</span></div><h3>Pact {title}</h3><strong>{tag}</strong><p>{body}</p><span className="cardLink">Explore layer <Icon name="external" size={16}/></span></a>)}</div></section>
    <section className="developerSection contentSection" data-reveal><div><span className="eyebrow">03 / BUILT TO BE INTEGRATED</span><h2>Your agent.<br/>Your stack.<br/><em>Explicit authority.</em></h2><p>Connect through the SDK or an MCP server. Read live authority, prepare bounded actions, and inspect the outcome.</p><div className="integrationTags"><span>TypeScript</span><span>Python</span><span>MCP</span><span>EVM</span></div><a className="quietLink" href="/docs#quickstart">Start with the quickstart <Icon name="arrow" size={17}/></a></div><div className="developerCode"><div className="codeTabs" aria-label="Integration examples">{(['TypeScript','MCP'] as const).map(item=><button key={item} aria-pressed={language===item} className={language===item?'active':''} onClick={()=>setLanguage(item)}>{item}</button>)}</div><CodeBlock label={language==='MCP'?'Terminal':'agent.ts'} code={examples[language]}/><p className="codeNote"><Icon name="lock" size={14}/> Signing keys stay with the wallet. Scope travels with the agent.</p></div></section>
    <section className="closing contentSection" data-reveal><div className="closingGlyph" aria-hidden="true"><Icon name="shield" size={50}/></div><span className="eyebrow">BUILD WITH A BOUNDARY</span><h2>More autonomous.<br/><span className="serifWord">Still accountable.</span></h2><p>Start your agent’s next chapter with clear permissions.</p><div className="heroActions"><a className="primaryLink" href="/app">Launch Pact Console <Icon name="arrow" size={17}/></a><a className="quietLink" href="/docs">Read the documentation <Icon name="external" size={16}/></a></div><div className="closingNote"><i className="statusDot"/> Available on {activeNetwork.name}</div></section>
  </main></Shell>;
}
function RecordFields({ value }: { value: unknown }) {
  if (value === null || typeof value !== 'object') return <code>{String(value)}</code>;
  return <dl>{Object.entries(value).map(([key, child]) => <div key={key}><dt>{key}</dt><dd>{typeof child === 'object' && child !== null ? <RecordFields value={child}/> : <code>{String(child)}</code>}</dd></div>)}</dl>;
}
function Explorer() {
  const [kind, setKind] = useState<'receipt' | 'grant'>('receipt');
  const [id, setId] = useState('');
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const search = async () => {
    setBusy(true); setError(''); setResult(undefined);
    try {
      if (!/^[1-9]\d*$/.test(id)) throw Error('Enter a positive numeric ID');
      if (!apiUrl) throw Error('API URL is not configured');
      const data = await request(kind === 'receipt' ? `/v1/receipts/${id}` : `/v1/public/grants/${id}`);
      setResult(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Lookup failed'); }
    finally { setBusy(false); }
  };
  return <Shell active="/explorer"><main id="main-content" className="explorerPage"><div className="docsHero"><span className="eyebrow">PACT / EXPLORER</span><h1>Follow authority.<br/><em>Verify the outcome.</em></h1><p>Inspect public grant disclosures and economic receipt anchors. Private evidence remains subject to its named verifier and disclosure policy.</p></div>
    <section className="explorerSearch"><div className="segmented"><button className={kind === 'receipt' ? 'chosen' : ''} onClick={() => { setKind('receipt'); setResult(undefined); }}>Economic receipt</button><button className={kind === 'grant' ? 'chosen' : ''} onClick={() => { setKind('grant'); setResult(undefined); }}>Public grant</button></div>
      <div className="searchRow"><input aria-label={`${kind} ID`} value={id} onChange={e => setId(e.target.value)} onKeyDown={e => e.key === 'Enter' && void search()} placeholder={kind === 'receipt' ? 'Enter obligation ID' : 'Enter grant ID'}/><button onClick={() => void search()} disabled={busy}>Inspect record ↗</button></div></section>
    {error && <p className="inlineNotice" role="alert">{error}</p>}{result !== undefined && <section className="recordPanel"><span className="eyebrow">CHAIN-BOUND RECORD</span><h2>{kind === 'receipt' ? 'Receipt' : 'Grant'} #{id}</h2><RecordFields value={result}/><p>A chain anchor records a verdict and settlement. It does not establish the truth of private evidence or legal enforceability.</p></section>}
  </main></Shell>;
}
function Console() { return <div className="siteShell appShell"><a href="#main-content" className="skipLink">Skip to workspace</a><Suspense fallback={<div className="appLoading"><Brand/><span className="loadingSpinner"/><p>Opening your workspace…</p></div>}><ConsoleApp/></Suspense></div>; }
const path = window.location.pathname.replace(/\/$/, '') || '/';
createRoot(document.getElementById('root')!).render(path === '/docs' ? <Shell active="/docs"><DocsContent/></Shell> : path === '/explorer' ? <Explorer/> : path === '/app' ? <Console/> : <Landing/>);
