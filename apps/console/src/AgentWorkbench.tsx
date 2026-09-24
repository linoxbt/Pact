import { useEffect, useState } from 'react';
import { encodeFunctionData, erc20Abi } from 'viem';

type Agent = { id: string; grant_id: string; operational_address: string; name: string;
  description: string; status: string };
type Key = { id: string; name: string; prefix: string; scopes: string[];
  expires_at: string; revoked_at: string | null };
type Credential = { id: string; provider: string; label: string; revoked_at: string | null };
type Run = { id: string; state: string; provider: string; model: string; error_code: string | null };
type Billing = { enabled: boolean; chainId?: number; token?: string; treasury?: string;
  tokenDecimals?: number; markupBps?: number };
type Request = (path: string, token?: string, body?: unknown,
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') => Promise<any>;
type Provider = { request(input: { method: string; params?: unknown[] }): Promise<unknown> };
const scopes = ['read', 'quote', 'prepare', 'approval.request', 'provider.read',
  'evidence.write', 'runs.trigger'];

export function AgentWorkbench({ token, request, provider }: { token: string;
  request: Request; provider: () => Provider | undefined }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<Agent>();
  const [keys, setKeys] = useState<Key[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runInput, setRunInput] = useState('');
  const [runOutput, setRunOutput] = useState('');
  const [modelProvider, setModelProvider] = useState('openai');
  const [model, setModel] = useState('');
  const [instructions, setInstructions] = useState('');
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [fundingMode, setFundingMode] = useState<'byo' | 'pact'>('byo');
  const [billing, setBilling] = useState<Billing>();
  const [balance, setBalance] = useState('0');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositHash, setDepositHash] = useState('');
  const [grantId, setGrantId] = useState('');
  const [name, setName] = useState('');
  const [keyName, setKeyName] = useState('');
  const [keyScopes, setKeyScopes] = useState<string[]>(['read', 'quote']);
  const [newKey, setNewKey] = useState('');
  const [providerName, setProviderName] = useState('github');
  const [providerLabel, setProviderLabel] = useState('');
  const [providerSecret, setProviderSecret] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const data = await request('/v1/agents', token);
    setAgents(data.agents);
  };
  const detail = async (agent: Agent) => {
    setSelected(agent); setNewKey('');
    const [keyData, credentialData, configData, runData] = await Promise.all([
      request(`/v1/agents/${agent.id}/keys`, token),
      request(`/v1/agents/${agent.id}/credentials`, token),
      request(`/v1/agents/${agent.id}/config`, token),
      request(`/v1/agents/${agent.id}/runs`, token),
    ]);
    setKeys(keyData.keys); setCredentials(credentialData.credentials);
    setRuns(runData.runs); setModelProvider(configData?.provider ?? 'openai');
    setModel(configData?.model ?? ''); setInstructions(configData?.instructions ?? '');
    setCustomEndpoint(configData?.custom_endpoint ?? '');
    setFundingMode(configData?.funding_mode ?? 'byo');
  };
  const refreshBalance = async () => {
    const [config, account] = await Promise.all([
      request('/v1/billing/config'), request('/v1/billing/balance', token),
    ]);
    setBilling(config); setBalance(account.balanceMicro);
  };
  useEffect(() => {
    void refresh().catch(() => setNotice('Could not load agents'));
    void refreshBalance().catch(() => setBilling({ enabled: false }));
  }, [token]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setNotice('');
    try { await work(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Action failed'); }
    finally { setBusy(false); }
  };
  const register = () => run(async () => {
    const agent = await request('/v1/agents', token, { grantId, name });
    await refresh(); await detail(agent);
    setNotice(`Agent ${agent.name} registered to grant #${agent.grant_id}.`);
  });
  const issueKey = () => run(async () => {
    if (!selected || !provider()) throw Error('Select an agent and connect a wallet');
    if (keyScopes.length === 0) throw Error('Choose at least one scope');
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const challenge = await request(`/v1/agents/${selected.id}/keys/challenge`, token,
      { name: keyName, scopes: keyScopes, expiresAt });
    const accounts = await provider()!.request({ method: 'eth_accounts' }) as string[];
    if (!accounts[0]) throw Error('Connect the principal wallet');
    const signature = await provider()!.request({ method: 'personal_sign',
      params: [challenge.message, accounts[0]] });
    const result = await request(`/v1/agents/${selected.id}/keys`, token,
      { challengeId: challenge.challengeId, signature });
    setNewKey(result.key);
    setNotice('Copy this key now. Pact will never show its raw value again.');
    await detail(selected); setNewKey(result.key);
  });
  const saveCredential = () => run(async () => {
    if (!selected) throw Error('Select an agent');
    await request(`/v1/agents/${selected.id}/credentials`, token,
      { provider: providerName, label: providerLabel, secret: providerSecret });
    setProviderSecret(''); await detail(selected);
    setNotice('Provider credential stored under KMS envelope encryption.');
  });
  const saveModel = () => run(async () => {
    if (!selected) throw Error('Select an agent');
    await request(`/v1/agents/${selected.id}/config`, token,
      { provider: modelProvider, model, instructions, maxOutputTokens: 1024,
        fundingMode,
        ...(modelProvider === 'custom' ? { customEndpoint } : {}) }, 'PUT');
    setNotice('Managed model configuration saved. A matching provider credential is required.');
  });
  const startRun = () => run(async () => {
    if (!selected) throw Error('Select an agent');
    const started = await request(`/v1/agents/${selected.id}/runs`, token,
      { input: runInput, idempotencyKey: crypto.randomUUID() });
    setRunOutput(`Run ${started.id} queued. Refresh its status below.`);
    const data = await request(`/v1/agents/${selected.id}/runs`, token);
    setRuns(data.runs);
    await refreshBalance();
  });
  const sendDeposit = () => run(async () => {
    if (!billing?.enabled || !billing.token || !billing.treasury || !provider())
      throw Error('Testnet billing or wallet unavailable');
    if (!/^\d+(\.\d{1,6})?$/.test(depositAmount)) throw Error('Enter up to six decimal places');
    const [whole, fraction = ''] = depositAmount.split('.');
    const units = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
    if (units <= 0n) throw Error('Amount must be positive');
    const chain = await provider()!.request({ method: 'eth_chainId' }) as string;
    if (Number(BigInt(chain)) !== billing.chainId) throw Error('Switch wallet to the configured Monad testnet');
    const accounts = await provider()!.request({ method: 'eth_accounts' }) as string[];
    if (!accounts[0]) throw Error('Connect the principal wallet');
    const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer',
      args: [billing.treasury as `0x${string}`, units] });
    const hash = await provider()!.request({ method: 'eth_sendTransaction',
      params: [{ from: accounts[0], to: billing.token, data }] }) as string;
    setDepositHash(hash);
    setNotice('Deposit submitted. Wait for finality, then claim the transaction below.');
  });
  const claimDeposit = () => run(async () => {
    const result = await request('/v1/billing/deposits', token, { txHash: depositHash });
    await refreshBalance(); setNotice(`Credited ${result.amountMicro} testnet micro-units.`);
  });
  const toggleScope = (scope: string) => setKeyScopes(current => current.includes(scope)
    ? current.filter(value => value !== scope) : [...current, scope]);
  return <section className="agentWorkbench" id="agents"><div className="sectionHeading"><div>
      <span className="eyebrow">IDENTITY / ACCESS</span><h2>Agents and credentials</h2>
      <p>Register an onchain grant, issue bounded Pact access, and vault provider keys. An API key never replaces a grant or principal approval.</p>
    </div><button className="secondary" onClick={() => void run(refresh)} disabled={busy}>Refresh</button></div>
    {notice && <p role="status" className="inlineNotice">{notice}</p>}
    <div className="grid"><article><h3>Register an agent</h3><p>First create a grant above. The registered operational address comes from live chain state.</p>
      <label>Grant ID<input value={grantId} onChange={e => setGrantId(e.target.value)} placeholder="1"/></label>
      <label>Agent name<input value={name} onChange={e => setName(e.target.value)} placeholder="Procurement agent"/></label>
      <button onClick={register} disabled={busy || !grantId || !name}>Register grant</button>
      <h3>Your agents</h3><div className="agentList">{agents.length === 0 ? <p>No agents registered.</p> : agents.map(agent =>
        <button key={agent.id} className={selected?.id === agent.id ? 'activeAgent' : ''}
          onClick={() => void run(() => detail(agent))}><strong>{agent.name}</strong><span>Grant #{agent.grant_id} · {agent.status}</span></button>)}</div>
    </article><article>{selected ? <><h3>{selected.name}</h3><p>Grant #{selected.grant_id} · Operational key <code>{selected.operational_address}</code></p>
      <div className="actions"><button className="secondary" onClick={() => void run(async () => {
        const updated = await request(`/v1/agents/${selected.id}/sync`, token, {});
        await detail(updated); await refresh(); setNotice('Agent synchronized to the live grant. Old keys were revoked if authority changed.');
      })} disabled={busy}>Sync chain state</button><button className="danger" onClick={() => void run(async () => {
        const updated = await request(`/v1/agents/${selected.id}`, token,
          { status: selected.status === 'active' ? 'disabled' : 'active' }, 'PATCH');
        await detail(updated); await refresh();
      })} disabled={busy}>{selected.status === 'active' ? 'Disable agent' : 'Enable agent'}</button></div>
      <h3>Issue Pact API key</h3><p>Wallet signature binds this key to the exact agent, scopes, and 30-day expiry.</p>
      <label>Key name<input value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="Local MCP client"/></label>
      <fieldset className="scopeGrid"><legend>Allowed operations</legend>{scopes.map(scope => <label key={scope}>
        <input type="checkbox" checked={keyScopes.includes(scope)} onChange={() => toggleScope(scope)}/>{scope}</label>)}</fieldset>
      <button onClick={issueKey} disabled={busy || !keyName || selected.status !== 'active'}>Sign and issue key</button>
      {newKey && <div className="keyReveal" role="alert"><strong>Copy once</strong><code>{newKey}</code><button className="secondary" onClick={() => void navigator.clipboard.writeText(newKey)}>Copy key</button></div>}
      <div className="credentialList">{keys.filter(key => !key.revoked_at).map(key => <div key={key.id}><code>{key.prefix}…</code><span>{key.name} · {key.scopes.join(', ')}</span><button className="text" onClick={() => void run(async () => {
        await request(`/v1/agents/${selected.id}/keys/${key.id}`, token, undefined, 'DELETE');
        await detail(selected);
      })}>Revoke</button></div>)}</div>
      <h3>Provider credential</h3><p>Vault a GitHub or model key for this agent. Raw values never return through the API.</p>
      <label>Provider<select value={providerName} onChange={e => setProviderName(e.target.value)}><option value="github">GitHub</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="custom">Approved custom model</option></select></label>
      <label>Label<input value={providerLabel} onChange={e => setProviderLabel(e.target.value)} placeholder="Production repository access"/></label>
      <label>Secret<input type="password" autoComplete="off" value={providerSecret} onChange={e => setProviderSecret(e.target.value)} placeholder="Paste provider key"/></label>
      <button onClick={saveCredential} disabled={busy || providerSecret.length < 8 || !providerLabel}>Store or rotate</button>
      <div className="credentialList">{credentials.filter(item => !item.revoked_at).map(item => <div key={item.id}><strong>{item.provider}</strong><span>{item.label}</span><button className="text" onClick={() => void run(async () => {
        await request(`/v1/agents/${selected.id}/credentials/${item.id}`, token, undefined, 'DELETE');
        await detail(selected);
      })}>Revoke</button></div>)}</div>
      <h3>Managed model</h3><p>Configure a one-shot, text-only run. Every run checks the live grant before the model call. Provider billing uses your vaulted key.</p>
      <label>Funding<select value={fundingMode} onChange={e => setFundingMode(e.target.value as 'byo' | 'pact')}><option value="byo">Bring your own provider key</option><option value="pact">Pact-funded testnet credit (+20%)</option></select></label>
      <label>Model provider<select value={modelProvider} onChange={e => setModelProvider(e.target.value)}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="custom">Approved custom endpoint</option></select></label>
      <label>Model ID<input value={model} onChange={e => setModel(e.target.value)} placeholder="Provider model ID"/></label>
      {modelProvider === 'custom' && <label>Approved HTTPS endpoint<input value={customEndpoint} onChange={e => setCustomEndpoint(e.target.value)} placeholder="https://approved.example/v1/responses"/></label>}
      <label>System instructions<textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={4} placeholder="The agent's task and boundaries"/></label>
      <button onClick={saveModel} disabled={busy || !model}>Save model</button>
      {fundingMode === 'pact' && <div className="billingBox"><h3>Testnet checkout</h3><p>Balance: <strong>{(Number(balance) / 1_000_000).toFixed(6)}</strong> stablecoin units. Credit is testnet-only and has no cash redemption. Token: <code>{billing?.token ?? 'not configured'}</code></p>
        <label>Deposit amount<input value={depositAmount} onChange={e => setDepositAmount(e.target.value)} placeholder="1.000000"/></label>
        <button onClick={sendDeposit} disabled={busy || !billing?.enabled}>Send token transfer</button>
        <label>Finalized transaction hash<input value={depositHash} onChange={e => setDepositHash(e.target.value)} placeholder="0x…"/></label>
        <button className="secondary" onClick={claimDeposit} disabled={busy || !depositHash}>Claim finalized deposit</button>
      </div>}
      <h3>Run a task</h3><label>Task input<textarea value={runInput} onChange={e => setRunInput(e.target.value)} rows={4} placeholder="Describe the task"/></label>
      <button onClick={startRun} disabled={busy || !runInput}>Queue run</button>
      {runOutput && <p className="notice" role="status">{runOutput}</p>}
      <div className="credentialList">{runs.map(item => <div key={item.id}><strong>{item.state}</strong><span>{item.provider} / {item.model}</span><button className="text" onClick={() => void run(async () => {
        const detail = await request(`/v1/agents/${selected.id}/runs/${item.id}`, token);
        setRunOutput(detail.output ?? detail.error_code ?? detail.state);
        const data = await request(`/v1/agents/${selected.id}/runs`, token);
        setRuns(data.runs);
      })}>Inspect</button></div>)}</div>
    </> : <><h3>Select an agent</h3><p>Inspect keys, provider access, and live grant binding.</p></>}</article></div>
  </section>;
}
