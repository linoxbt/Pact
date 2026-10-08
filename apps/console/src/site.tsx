import { activeNetwork, networkNotice } from './networks.js';
import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { request } from './api.js';
import { Brand, Icon } from './ui.js';
import { DocsContent } from './Docs.js';
import { LandingContent } from './Landing.js';
import './site.css';
import './agent.css';

const apiUrl = import.meta.env.VITE_PACT_API_URL as string | undefined;
const ConsoleApp = lazy(() => import('./PrivyConsole.js'));
const nav = [{ href: '/#product', label: 'Product' }, { href: '/docs', label: 'Developers' }, { href: '/explorer', label: 'Explorer' }];
function Shell({ children, active }: { children: React.ReactNode; active: string }) {
  const [open, setOpen] = useState(false);
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('revealed'); observer.unobserve(entry.target); }
    }), { threshold: 0.08 });
    document.querySelectorAll('[data-reveal]').forEach(item => observer.observe(item));
    return () => observer.disconnect();
  }, []);
  return <div className={`siteShell ${active==='/'?'marketingShell':''}`}><a href="#main-content" className="skipLink">Skip to content</a>
    <nav className="siteNav" aria-label="Primary"><Brand/><div id="site-navigation" className={`navLinks ${open ? 'navOpen' : ''}`} onClick={()=>setOpen(false)}>{nav.map(item => <a key={item.href} aria-current={active === item.href ? 'page' : undefined} href={item.href}>{item.label}</a>)}{active==='/'&&<a href="#use-cases">Use cases</a>}<a href="https://github.com/linoxbt/Pact">GitHub <Icon name="external" size={13}/></a></div><a className="navCta" href="/app">Open app <Icon name="arrow" size={16}/></a><button className="mobileMenu" onClick={() => setOpen(!open)} aria-controls="site-navigation" aria-expanded={open} aria-label={open ? 'Close navigation' : 'Open navigation'}><Icon name={open ? 'close' : 'menu'}/></button></nav>
    {children}
    <footer className="siteFooter"><div className="footerTop"><div><Brand/><p>Built for agents.<br/>Accountable to you.</p></div><div className="footerLinks"><div><span>PRODUCT</span><a href="/app">Console</a><a href="/explorer">Explorer</a><a href="/#architecture">Architecture</a></div><div><span>DEVELOPERS</span><a href="/docs/quickstart">Quickstart</a><a href="/docs/sdk">SDKs & integrations</a><a href="https://github.com/linoxbt/Pact">GitHub ↗</a></div><div><span>NETWORK</span><a href="/docs/network">{activeNetwork.name}</a><a href="/docs/authority">Authority model</a><a href="/docs/evidence">Trust & verification</a></div></div></div><div className="footerBottom"><span>© {new Date().getFullYear()} Pact Protocol</span><span><i className="statusDot"/> {networkNotice}</span><span>Permission with a paper trail.</span></div></footer>
  </div>;
}
function Landing() { return <Shell active="/"><LandingContent/></Shell>; }
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
function Docs() { return <div className="siteShell docsShell"><a href="#main-content" className="skipLink">Skip to documentation</a><header className="docsTopbar"><Brand/><span>Developer documentation</span><nav aria-label="Documentation utilities"><a href="/app/overview">Console</a><a href="https://github.com/linoxbt/Pact">GitHub <Icon name="external" size={13}/></a></nav></header><DocsContent/></div>; }
const path = window.location.pathname.replace(/\/$/, '') || '/';
createRoot(document.getElementById('root')!).render(path === '/docs' || path.startsWith('/docs/') ? <Docs/> : path === '/explorer' ? <Explorer/> : path === '/app' || path.startsWith('/app/') ? <Console/> : <Landing/>);
