import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const apiUrl = import.meta.env.VITE_PACT_API_URL as string | undefined;
async function lookup(path: string): Promise<Record<string, unknown>> {
  if (!apiUrl) throw Error('Explorer API URL is not configured');
  const response = await fetch(new URL(path, apiUrl), { redirect: 'error' });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || `API ${response.status}`);
  return data;
}
function Fields({ value }: { value: unknown }) {
  if (value === null || typeof value !== 'object') return <code>{String(value)}</code>;
  return <dl>{Object.entries(value).map(([key, child]) => <div key={key}><dt>{key}</dt><dd>{typeof child === 'object' && child !== null ? <Fields value={child}/> : <code>{String(child)}</code>}</dd></div>)}</dl>;
}
function App() {
  const [kind, setKind] = useState<'receipt' | 'grant'>('receipt');
  const [id, setId] = useState('');
  const [result, setResult] = useState<Record<string, unknown>>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const search = async () => {
    setBusy(true); setError(''); setResult(undefined);
    try {
      if (!/^[1-9]\d*$/.test(id)) throw Error('Enter a positive numeric ID');
      setResult(await lookup(kind === 'receipt' ? `/v1/receipts/${id}` : `/v1/public/grants/${id}`));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Lookup failed'); }
    finally { setBusy(false); }
  };
  return <main><header><span className="eyebrow">PACT / EXPLORER</span><div className="top"><h1>Follow the authority.<br/><em>Verify the outcome.</em></h1><p>Inspect public grant disclosures and onchain economic receipts on Monad. Every lookup reads current chain state through the Pact API.</p></div></header>
    <section className="search"><div className="tabs"><button className={kind === 'receipt' ? 'active' : ''} onClick={() => { setKind('receipt'); setResult(undefined); }}>Receipt</button><button className={kind === 'grant' ? 'active' : ''} onClick={() => { setKind('grant'); setResult(undefined); }}>Public grant</button></div><div className="row"><input aria-label={`${kind} ID`} value={id} onChange={e => setId(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder={kind === 'receipt' ? 'Obligation ID' : 'Grant ID'}/><button onClick={search} disabled={busy}>Inspect →</button></div><p>{kind === 'grant' ? 'Grant details appear only when the principal published a matching policy that allows public authority disclosure.' : 'A receipt anchor shows the recorded verdict and settlement. Private evidence truth depends on the named verifier.'}</p></section>
    {error && <div role="alert" className="error">{error}</div>}{result && <section className="result"><div className="resultTitle"><span className="eyebrow">LIVE RECORD</span><h2>{kind === 'receipt' ? `Receipt #${id}` : `Grant #${id}`}</h2></div><Fields value={result}/><p className="caveat">Chain data is independently readable. A named verifier attestation does not independently prove private evidence or legal enforceability.</p></section>}
    <footer><span>PACT PROTOCOL</span><span>Authority · Obligations · Receipts</span></footer></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
