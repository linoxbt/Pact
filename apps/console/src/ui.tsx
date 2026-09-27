import { useState, type ReactNode } from 'react';

export function Icon({ name = 'arrow', size = 20 }: { name?: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>, external: <path d="M7 17 17 7M7 7h10v10"/>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    agent: <><rect x="4" y="6" width="16" height="14" rx="4"/><path d="M12 3v3M8 11v3m8-3v3m-7 3h6M1 11v4m22-4v4"/></>,
    key: <><circle cx="8" cy="9" r="5"/><path d="m12 13 8 8m-4-4 3-3m-6 0 3-3"/></>,
    layers: <><path d="m12 3 10 5-10 5L2 8l10-5Zm-10 10 10 5 10-5M2 18l10 5 10-5"/></>,
    book: <><path d="M12 6c-4-3-7-2-10-1v15c3-1 6-2 10 1 4-3 7-2 10-1V5c-3-1-6-2-10 1Zm0 0v15"/></>,
    activity: <path d="M2 12h4l3-8 6 16 3-8h4"/>,
    inbox: <><path d="m6 4-4 9v7h20v-7l-4-9H6Zm-4 9h6l2 3h4l2-3h6"/></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8V5l13-3v3m5 6h-6v5h6m-4-3h1"/></>,
    code: <><path d="m7 6-6 6 6 6m10-12 6 6-6 6M14 3l-4 18"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
    receipt: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z"/><path d="M8 8h8m-8 4h8m-8 4h4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.arrow}</svg>;
}

export function Brand() {
  return <a className="brand" href="/" aria-label="Pact home"><svg width="30" height="32" viewBox="0 0 30 32" fill="none" aria-hidden="true"><path d="m15 1 14 8v14l-14 8L1 23V9L15 1Z" stroke="currentColor" strokeWidth="1.6"/><path d="m15 8 8 4.5v7L15 24l-8-4.5v-7L15 8Z" fill="currentColor"/><path d="M15 8v16m-8-11.5 16 7m0-7-16 7" stroke="var(--brand-cut,#f5f6f0)" strokeWidth="1.2"/></svg><span>pact<span className="brandDot">.</span></span></a>;
}

export function CodeBlock({ code, label = 'Terminal' }: { code: string; label?: string }) {
  const [status, setStatus] = useState('Copy');
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setStatus('Copied'); }
    catch { setStatus('Select to copy'); }
  };
  return <div className="codeBlock"><div className="codeToolbar"><span><i/><i/><i/>{label}</span><button onClick={() => void copy()} aria-label={`Copy ${label} example`}><Icon name={status === 'Copied' ? 'check' : 'copy'} size={14}/><span aria-live="polite">{status}</span></button></div><pre><code>{code}</code></pre></div>;
}
