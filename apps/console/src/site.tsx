import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, request } from './main.js';
import './site.css';
import './agent.css';

const apiUrl = import.meta.env.VITE_PACT_API_URL as string | undefined;
const nav = [{ href: '/', label: 'Protocol' }, { href: '/docs', label: 'Docs' },
  { href: '/explorer', label: 'Explorer' }];
function Brand() { return <a className="brand" href="/" aria-label="Pact home"><span className="brandMark"><span/></span>PACT<span className="brandDot">.</span></a>; }
function Shell({ children, active }: { children: React.ReactNode; active: string }) {
  return <div className="siteShell"><div className="topline"><span>PROGRAMMABLE AUTHORITY FOR AUTONOMOUS AGENTS</span><span>MONAD TESTNET · UNAUDITED</span></div>
    <nav className="siteNav" aria-label="Primary"><Brand/><div className="navLinks">{nav.map(item =>
      <a key={item.href} className={active === item.href ? 'isActive' : ''} href={item.href}>{item.label}</a>)}</div>
      <a className="navCta" href="/app">Open Console <span aria-hidden="true">↗</span></a></nav>{children}
    <footer className="siteFooter"><div><Brand/><p>Authority, obligations, and economic receipts for agents acting in the world.</p></div>
      <div><a href="/docs">Documentation</a><a href="/explorer">Explorer</a><a href="/app">Console</a></div>
      <small>Testnet infrastructure. No independent audit or real-fund custody.</small></footer></div>;
}
function AuthorityGraphic() {
  return <div className="authorityGraphic" aria-label="Principal authority flows through a bounded grant to an agent and a verified economic receipt" role="img">
    <div className="graphicHead"><span>AUTHORITY GRAPH</span><span className="livePill"><i/> LIVE MODEL</span></div>
    <svg viewBox="0 0 640 420" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#315047"/></pattern></defs>
      <rect width="640" height="420" fill="url(#dots)"/>
      <path className="flowLine" d="M128 210H260M380 210H512" fill="none" stroke="#9CE8BE" strokeWidth="2" strokeDasharray="7 8"/>
      <path d="M320 128V82M320 292V338" fill="none" stroke="#526B60" strokeWidth="2" strokeDasharray="5 7"/>
      <circle cx="320" cy="210" r="76" fill="#19352B" stroke="#98E7BB" strokeWidth="1.5"/>
      <circle className="graphicPulse" cx="320" cy="210" r="95" fill="none" stroke="#98E7BB" opacity=".25"/>
      <circle cx="100" cy="210" r="52" fill="#16251F" stroke="#526B60"/>
      <circle cx="540" cy="210" r="52" fill="#16251F" stroke="#526B60"/>
      <rect x="270" y="33" width="100" height="48" rx="5" fill="#172A22" stroke="#526B60"/>
      <rect x="270" y="338" width="100" height="48" rx="5" fill="#172A22" stroke="#526B60"/>
      <text x="100" y="206" textAnchor="middle" fill="#F1F8F1" fontSize="11" fontWeight="700">PRINCIPAL</text>
      <text x="100" y="225" textAnchor="middle" fill="#A3B8A8" fontSize="10">signs scope</text>
      <text x="320" y="204" textAnchor="middle" fill="#B8F2D1" fontSize="13" fontWeight="700">PACT GRANT</text>
      <text x="320" y="227" textAnchor="middle" fill="#BBD1BE" fontSize="10">policy · capacity · expiry</text>
      <text x="540" y="206" textAnchor="middle" fill="#F1F8F1" fontSize="11" fontWeight="700">AGENT</text>
      <text x="540" y="225" textAnchor="middle" fill="#A3B8A8" fontSize="10">acts in bounds</text>
      <text x="320" y="62" textAnchor="middle" fill="#BBD1BE" fontSize="10">RESERVATION</text>
      <text x="320" y="367" textAnchor="middle" fill="#BBD1BE" fontSize="10">RECEIPT</text>
      <circle className="flowDot" cx="128" cy="210" r="5" fill="#B8F2D1"/>
    </svg><div className="graphicFoot"><span>01 / IDENTITY</span><span>02 / BOUNDED ACTION</span><span>03 / VERIFIABLE OUTCOME</span></div></div>;
}
function Landing() {
  const [step, setStep] = useState(0);
  const stages = [
    { n: '01', title: 'Define authority', body: 'The principal binds an agent to a grant: asset, recipient, ceiling, expiry, and policy hash.' },
    { n: '02', title: 'Reserve capacity', body: 'Pact checks an exact action and reserves its maximum liability before execution.' },
    { n: '03', title: 'Approve exceptions', body: 'A human signs the precise request. Changed terms require a fresh approval.' },
    { n: '04', title: 'Prove the outcome', body: 'An obligation, evidence hash, verifier verdict, and settlement are linked in a receipt.' },
  ];
  return <Shell active="/"><main className="landing"><section className="hero"><div className="heroCopy"><div className="eyebrow"><span className="signal"/> THE AUTHORITY LAYER</div>
    <h1>Give agents power.<br/><em>Keep authority.</em></h1>
    <p className="heroLead">Pact lets autonomous agents act within explicit limits, proves who authorized them, tracks the obligations they create, and records what actually settled.</p>
    <div className="heroActions"><a className="primaryLink" href="/app">Explore the Console <span>↗</span></a><a className="quietLink" href="/docs">Read the developer docs <span>→</span></a></div>
    <div className="heroMeta"><span><strong>06</strong> protocol layers</span><span><strong>01</strong> source of authority</span><span><strong>∞</strong> accountable actions</span></div>
    </div><AuthorityGraphic/></section>
    <section className="thesis"><span className="eyebrow">THE PROBLEM</span><p>Agents are gaining access to wallets, APIs, and business workflows. A wallet key or API token gives an agent power without showing a counterparty <em>who allowed this action, under what limits, and what happened next.</em></p></section>
    <section className="systemSection"><div className="sectionIntro"><span className="eyebrow">HOW PACT WORKS</span><h2>One line of accountability.<br/>From intent to receipt.</h2><p>Authority is checked at the execution boundary. A policy preview alone cannot move controlled funds or reveal a vaulted credential.</p></div>
      <div className="stepPanel"><div className="stepList">{stages.map((item, index) => <button key={item.n} className={step === index ? 'selectedStep' : ''} onClick={() => setStep(index)}><span>{item.n}</span><strong>{item.title}</strong><span aria-hidden="true">↗</span></button>)}</div><div className="stepDetail"><span>PACT / {stages[step]!.n}</span><div className="stepOrbit"><span>{stages[step]!.n}</span></div><h3>{stages[step]!.title}</h3><p>{stages[step]!.body}</p></div></div></section>
    <section className="products"><div><span className="eyebrow">BUILT FOR THE WHOLE TRANSACTION</span><h2>One protocol.<br/>Six product surfaces.</h2></div><div className="productGrid">{[
      ['Protocol','Monad contracts and enforceable limits'],['Engine','Quotes, decisions, and reservations'],
      ['SDK','Typed tools for agent developers'],['MCP','Scoped tools for AI runtimes'],
      ['Console','Human oversight and approvals'],['Explorer','Public proofs and receipts']
    ].map(([title, body], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{body}</p></article>)}</div></section>
    <section className="closing"><span className="eyebrow">START WITH A BOUNDARY</span><h2>Autonomous commerce<br/><em>with someone accountable.</em></h2><p>See what is implemented on testnet, integrate through the SDK, and inspect the trust assumptions before using Pact.</p><div className="heroActions"><a className="primaryLink" href="/docs">Start building <span>↗</span></a><a className="quietLink" href="/explorer">Inspect public records <span>→</span></a></div></section>
  </main></Shell>;
}
const blocks = [
  { id: 'overview', title: 'Overview', body: 'Pact is a programmable authority and economic accountability layer for autonomous agents. The current implementation supports bounded ERC-20 transfers, one funded obligation milestone, a scoped GitHub gateway, an approval inbox, and evidence hashing. It is unaudited testnet infrastructure.' },
  { id: 'authority', title: 'Authority model', body: 'A principal creates an onchain grant for an operational address. The grant fixes token, recipient, ceiling, single-action limit, approval threshold, expiry, delegation depth, and policy hash. Revocation stops new actions; existing obligations retain their written settlement rights.' },
  { id: 'agents', title: 'Agents and credentials', body: 'After a grant confirms, register it in the Console. Agent API keys are scoped to read, quote, prepare, approval request, provider read, evidence write, or run trigger operations. Key issuance requires a principal wallet signature. Provider credentials are envelope-encrypted with AWS KMS and never returned by the API.' },
  { id: 'managed-runs', title: 'Managed agent runs', body: 'Configure a bounded text model for OpenAI, Anthropic, or an operator-approved custom HTTPS endpoint. Runs are idempotent and queued. The runner checks the live grant again before calling the provider. It does not execute model tool calls or sign transactions. Bring your own provider key through the KMS vault, or use testnet Pact credit when that model is enabled by the operator.' },
  { id: 'testnet-billing', title: 'Testnet model credit', body: 'Pact-funded model access accepts a configured six-decimal Monad testnet stablecoin transferred to a configured treasury. The API verifies the finalized ERC-20 Transfer log and credits each transaction hash once. A run reserves the maximum configured model charge; actual reported token usage is charged at the configured provider rate plus 20%, with unused credit returned. This checkout is unaudited testnet software, not a production payment or redemption service.' },
  { id: 'approvals', title: 'Approval flow', body: 'An agent requests approval for a live exact transfer reservation. The principal reviews amount, recipient, token, nonce, deadline, and intent hash, then signs the bound EIP-712 payload. The signature is visible to the scoped agent only after approval; the account rechecks authority during execution.' },
  { id: 'evidence', title: 'Evidence and receipts', body: 'Evidence is AES-256-GCM encrypted with a per-object KMS data key before private S3 storage. The chain anchors hashes and a named verifier verdict. A receipt proves recorded state and integrity of disclosed content; it does not prove subjective evidence truth.' },
];
function Docs() {
  return <Shell active="/docs"><main className="docsPage"><div className="docsHero"><span className="eyebrow">DEVELOPER DOCUMENTATION</span><h1>Build with explicit authority.</h1><p>Integrate a bounded agent, inspect the exact limits, and keep signing keys out of prompts and browser bundles.</p></div>
    <div className="docsLayout"><aside aria-label="Documentation sections"><span>GET STARTED</span>{blocks.map(block => <a key={block.id} href={`#${block.id}`}>{block.title}</a>)}<span>REFERENCES</span><a href="https://github.com/linoxbt/Pact">Source repository ↗</a><a href="/explorer">Public Explorer ↗</a></aside>
      <div className="docsContent"><section className="docsCallout"><strong>Current status</strong><p>Local implementation and testnet release work are in progress. No independent audit, live Monad deployment, or real-fund custody is claimed.</p></section>
        {blocks.map(block => <section id={block.id} key={block.id}><span className="eyebrow">PACT / {block.id.toUpperCase()}</span><h2>{block.title}</h2><p>{block.body}</p></section>)}
        <section id="quickstart"><span className="eyebrow">FIRST INTEGRATION</span><h2>Quickstart</h2><ol><li>Create and confirm a root grant from the Console.</li><li>Register the agent to that grant and issue a scoped key.</li><li>Authenticate the operational wallet or use the scoped key for read and quote operations.</li><li>Quote an exact intent, reserve authority, and inspect operation finality.</li></ol><pre><code>{`# Install the workspace and run checks\npnpm install --frozen-lockfile\npnpm check\n\n# Run the local MCP server with a scoped session\nPACT_API_URL=https://your-api.example PACT_SESSION_TOKEN=... pnpm --filter @pact/mcp start`}</code></pre><p>TypeScript contract client: <code>@pact/sdk-ts</code>. Python HTTP client: <code>packages/sdk-python</code>. SDK and MCP calls prepare or inspect actions; the required wallet still signs onchain transactions.</p></section>
      </div></div></main></Shell>;
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
  return <Shell active="/explorer"><main className="explorerPage"><div className="docsHero"><span className="eyebrow">PACT / EXPLORER</span><h1>Follow authority.<br/><em>Verify the outcome.</em></h1><p>Inspect public grant disclosures and economic receipt anchors. Private evidence remains subject to its named verifier and disclosure policy.</p></div>
    <section className="explorerSearch"><div className="segmented"><button className={kind === 'receipt' ? 'chosen' : ''} onClick={() => { setKind('receipt'); setResult(undefined); }}>Economic receipt</button><button className={kind === 'grant' ? 'chosen' : ''} onClick={() => { setKind('grant'); setResult(undefined); }}>Public grant</button></div>
      <div className="searchRow"><input aria-label={`${kind} ID`} value={id} onChange={e => setId(e.target.value)} onKeyDown={e => e.key === 'Enter' && void search()} placeholder={kind === 'receipt' ? 'Enter obligation ID' : 'Enter grant ID'}/><button onClick={() => void search()} disabled={busy}>Inspect record ↗</button></div></section>
    {error && <p className="inlineNotice" role="alert">{error}</p>}{result !== undefined && <section className="recordPanel"><span className="eyebrow">CHAIN-BOUND RECORD</span><h2>{kind === 'receipt' ? 'Receipt' : 'Grant'} #{id}</h2><RecordFields value={result}/><p>A chain anchor records a verdict and settlement. It does not establish the truth of private evidence or legal enforceability.</p></section>}
  </main></Shell>;
}
function Console() { return <Shell active="/app"><div className="consoleFrame"><App/></div></Shell>; }
const path = window.location.pathname.replace(/\/$/, '') || '/';
createRoot(document.getElementById('root')!).render(path === '/docs' ? <Docs/> :
  path === '/explorer' ? <Explorer/> : path === '/app' ? <Console/> : <Landing/>);
