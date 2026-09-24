import { useState } from 'react';
import { decodeEventLog, encodeFunctionData, isAddress, isHex, type Address, type Hex } from 'viem';
import { AuthorityRegistryAbi } from '@pact/abis';
import { canonicalGatewayPolicy, hashGatewayPolicy, policyApprovalPayload } from '@pact/policies';
import './style.css';
import './inbox.css';
import { AgentWorkbench } from './AgentWorkbench.js';

type Provider = { request(input: { method: string; params?: unknown[] }): Promise<unknown> };
type Config = { chainId: number; registry: Address; account: Address; accountPrincipal: Address };
type Grant = { id: string; principal: Address; agent: Address; account: Address; token: Address;
  recipient: Address; ceiling: string; singleLimit: string; approvalThreshold: string;
  expiresAt: string; policyHash: Hex; active: boolean };
type Operation = { id: string; kind: string; state: string; tx_hash: string | null; error_code: string | null };
type Approval = { id: string; grant_id: string; reservation_id: string; intent_hash: Hex;
  intent: { grantId: string; agent: Address; token: Address; to: Address; amount: string;
    nonce: string; deadline: string; policyHash: Hex }; state: string; signature: string | null };
const apiUrl = import.meta.env.VITE_PACT_API_URL as string | undefined;
export const provider = () => (window as Window & { ethereum?: Provider }).ethereum;
const json = (value: unknown) => JSON.stringify(value, (_, field) => typeof field === 'bigint' ? field.toString() : field);
export async function request(path: string, token?: string, body?: unknown,
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') {
  if (!apiUrl) throw Error('Set VITE_PACT_API_URL');
  const response = await fetch(new URL(path, apiUrl), { method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : json(body), redirect: 'error' });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || `API ${response.status}`);
  return data;
}
async function walletTx(to: Address, data: Hex, from: Address): Promise<Hex> {
  const wallet = provider();
  if (!wallet) throw Error('Connect an EVM wallet');
  return await wallet.request({ method: 'eth_sendTransaction', params: [{ from, to, data }] }) as Hex;
}
async function receipt(hash: Hex) {
  const wallet = provider()!;
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await wallet.request({ method: 'eth_getTransactionReceipt', params: [hash] });
    if (value) return value as { status: string; logs: { address: Address; data: Hex; topics: Hex[] }[] };
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw Error('Transaction still pending; check your wallet using the transaction hash');
}

export function App() {
  const [config, setConfig] = useState<Config>();
  const [address, setAddress] = useState<Address>();
  const [token, setToken] = useState<string>();
  const [message, setMessage] = useState('Connect a principal wallet to manage authority.');
  const [grants, setGrants] = useState<Grant[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [selected, setSelected] = useState<Grant>();
  const [agent, setAgent] = useState('');
  const [asset, setAsset] = useState('');
  const [recipient, setRecipient] = useState('');
  const [ceiling, setCeiling] = useState('');
  const [singleLimit, setSingleLimit] = useState('');
  const [threshold, setThreshold] = useState('');
  const [expiry, setExpiry] = useState('');
  const [repositories, setRepositories] = useState('');
  const [maxRequests, setMaxRequests] = useState('100');
  const [periodSeconds, setPeriodSeconds] = useState('3600');
  const [publicAuthority, setPublicAuthority] = useState(false);
  const [grantToPublish, setGrantToPublish] = useState('');
  const [approvalAmount, setApprovalAmount] = useState('');
  const [approvalNonce, setApprovalNonce] = useState('');
  const [approvalDeadline, setApprovalDeadline] = useState('');
  const [approvalReservationId, setApprovalReservationId] = useState('');
  const [approvalSignature, setApprovalSignature] = useState('');
  const [obligationId, setObligationId] = useState('');
  const [obligation, setObligation] = useState<Record<string, unknown>>();
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Request failed'); }
    finally { setBusy(false); }
  };
  const refresh = async (session: string) => {
    const [list, recent, inbox] = await Promise.all([request('/v1/grants', session),
      request('/v1/operations', session), request('/v1/approvals', session)]);
    setGrants((list.grants as { args: { grantId: string } }[]).map(item => ({ id: item.args.grantId } as Grant)));
    setOperations(recent.operations);
    setApprovals(inbox.approvals);
  };
  const connect = () => run(async () => {
    const wallet = provider();
    if (!wallet) throw Error('Install an EVM wallet');
    const settings = await request('/v1/config') as Config;
    const accounts = await wallet.request({ method: 'eth_requestAccounts' }) as Address[];
    const current = accounts[0];
    if (!current) throw Error('Wallet returned no address');
    const chain = Number(BigInt(await wallet.request({ method: 'eth_chainId' }) as string));
    if (chain !== settings.chainId) throw Error(`Switch wallet to chain ${settings.chainId}`);
    const challenge = await request('/v1/auth/challenge', undefined, { address: current });
    const signature = await wallet.request({ method: 'personal_sign', params: [challenge.message, current] });
    const session = await request('/v1/auth/session', undefined, { nonce: challenge.nonce, signature });
    setConfig(settings); setAddress(current); setToken(session.token);
    await refresh(session.token);
    setMessage(`Signed in as ${current}`);
  });
  const policy = () => canonicalGatewayPolicy({ version: 1, provider: 'github', operation: 'repository.read',
    repositories: repositories.split(',').map(item => item.trim()).filter(Boolean),
    maxRequests: Number(maxRequests), periodSeconds: Number(periodSeconds),
    expiresAt: String(Math.floor(new Date(expiry).getTime() / 1000)), publicAuthority });
  const createGrant = () => run(async () => {
    if (!config || !address || !token) throw Error('Connect first');
    if (address.toLowerCase() !== config.accountPrincipal.toLowerCase())
      throw Error('This wallet is not the deployed PactAccount principal');
    if (![agent, asset, recipient].every(value => isAddress(value))) throw Error('Enter valid agent, token, and recipient addresses');
    const data = encodeFunctionData({ abi: AuthorityRegistryAbi, functionName: 'createRoot', args: [
      agent as Address, config.account, asset as Address, recipient as Address,
      BigInt(ceiling), BigInt(singleLimit), BigInt(threshold),
      BigInt(Math.floor(new Date(expiry).getTime() / 1000)), 0, hashGatewayPolicy(policy()),
    ] });
    const hash = await walletTx(config.registry, data, address);
    setMessage(`Grant transaction submitted: ${hash}`);
    const mined = await receipt(hash);
    if (mined.status !== '0x1') throw Error(`Grant transaction reverted: ${hash}`);
    const log = mined.logs.find(item => item.address.toLowerCase() === config.registry.toLowerCase());
    if (log) {
      const event = decodeEventLog({ abi: AuthorityRegistryAbi, data: log.data,
        topics: log.topics as [Hex, ...Hex[]] });
      if (event.eventName === 'GrantCreated') setGrantToPublish(String(event.args.grantId));
    }
    setMessage(`Grant mined: ${hash}. Publish its signed gateway policy below after finality.`);
    await refresh(token);
  });
  const publishPolicy = () => run(async () => {
    if (!config || !address || !token) throw Error('Connect first');
    const grantId = BigInt(grantToPublish);
    const currentPolicy = policy();
    const hash = hashGatewayPolicy(currentPolicy);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const payload = policyApprovalPayload(config.chainId, config.registry, grantId, hash, deadline);
    const signature = await provider()!.request({ method: 'eth_signTypedData_v4',
      params: [address, json(payload)] });
    await request('/v1/policies', token, { grantId: String(grantId), policy: currentPolicy,
      signature, signatureDeadline: String(deadline) });
    setMessage(`Policy published for grant ${grantId}`);
  });
  const inspectGrant = (id: string) => run(async () => {
    if (!token) throw Error('Connect first');
    setApprovalSignature('');
    const detail = await request(`/v1/grants/${id}`, token);
    setSelected(detail.grant);
  });
  const revoke = () => run(async () => {
    if (!selected || !config || !address) throw Error('Select a grant');
    const data = encodeFunctionData({ abi: AuthorityRegistryAbi, functionName: 'revoke', args: [BigInt(selected.id)] });
    const hash = await walletTx(config.registry, data, address);
    setMessage(`Revocation submitted: ${hash}`);
    const mined = await receipt(hash);
    if (mined.status !== '0x1') throw Error(`Revocation reverted: ${hash}`);
    await inspectGrant(selected.id);
    setMessage(`Revocation mined: ${hash}`);
  });
  const approveTransfer = () => run(async () => {
    if (!selected || !config || !address || !token) throw Error('Select a grant first');
    const intent = { grantId: selected.id, agent: selected.agent, token: selected.token,
      to: selected.recipient, amount: approvalAmount, nonce: approvalNonce,
      deadline: String(Math.floor(new Date(approvalDeadline).getTime() / 1000)),
      policyHash: selected.policyHash };
    const checked = await request('/v1/transfers/approval-payload', token,
      { intent, reservationId: approvalReservationId });
    const signature = await provider()!.request({ method: 'eth_signTypedData_v4',
      params: [address, json(checked.payload)] }) as string;
    setApprovalSignature(signature);
    setMessage('Exact transfer approval signed. Share the signature with the authorized agent through a trusted channel.');
  });
  const inspectObligation = () => run(async () => {
    if (!token || !/^[1-9]\d*$/.test(obligationId)) throw Error('Enter an obligation ID');
    setObligation(await request(`/v1/obligations/${obligationId}`, token));
  });
  const approveInbox = (item: Approval) => run(async () => {
    if (!address || !token) throw Error('Connect first');
    const checked = await request('/v1/transfers/approval-payload', token,
      { intent: item.intent, reservationId: item.reservation_id });
    const signature = await provider()!.request({ method: 'eth_signTypedData_v4',
      params: [address, json(checked.payload)] });
    await request(`/v1/approvals/${item.id}/approve`, token, { signature });
    await refresh(token);
    setMessage(`Approved exact transfer request ${item.id}. The agent can now retrieve the signature.`);
  });
  const rejectInbox = (item: Approval) => run(async () => {
    if (!token) throw Error('Connect first');
    await request(`/v1/approvals/${item.id}/reject`, token, {});
    await refresh(token);
    setMessage(`Rejected request ${item.id}.`);
  });
  const logout = () => run(async () => {
    if (token) await request('/v1/auth/logout', token, {});
    setToken(undefined); setAddress(undefined); setSelected(undefined);
    setGrants([]); setOperations([]); setApprovals([]);
    setMessage('Session ended.');
  });
  return <main><header><div><span className="eyebrow">PACT / CONSOLE</span><h1>Authority, under control.</h1><p>Manage grants, policy, and economic operations from the principal wallet.</p></div><div className="wallet">{address ? <><code>{address}</code><button onClick={logout} disabled={busy}>Sign out</button></> : <button onClick={connect} disabled={busy}>Connect wallet</button>}</div></header>
    <div role="status" className="notice">{message}</div>
    {token && <><section className="grid"><article><h2>Create a root grant</h2><p>Funds remain in the controlled PactAccount. Values are ERC-20 base units.</p>
      <label>Agent address<input value={agent} onChange={e => setAgent(e.target.value)} placeholder="0x…"/></label>
      <label>Token address<input value={asset} onChange={e => setAsset(e.target.value)} placeholder="0x…"/></label>
      <label>Fixed recipient<input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x…"/></label>
      <div className="cols"><label>Total ceiling<input value={ceiling} onChange={e => setCeiling(e.target.value)} placeholder="1000000"/></label><label>Single action limit<input value={singleLimit} onChange={e => setSingleLimit(e.target.value)} placeholder="100000"/></label></div>
      <label>Approval threshold<input value={threshold} onChange={e => setThreshold(e.target.value)} placeholder="50000"/></label>
      <label>Expires at<input type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)}/></label>
      <h3>Gateway policy</h3><p>Only allowlisted GitHub repository reads. This policy hash is bound to the grant.</p>
      <label>Repositories, comma separated<input value={repositories} onChange={e => setRepositories(e.target.value)} placeholder="owner/repository"/></label>
      <div className="cols"><label>Maximum requests<input value={maxRequests} onChange={e => setMaxRequests(e.target.value)}/></label><label>Period in seconds<input value={periodSeconds} onChange={e => setPeriodSeconds(e.target.value)}/></label></div>
      <label className="check"><input type="checkbox" checked={publicAuthority} onChange={e => setPublicAuthority(e.target.checked)}/> Show this grant in the public Explorer</label>
      <button onClick={createGrant} disabled={busy}>Create grant in wallet</button>
      <h3>Publish policy</h3><p>Publish after the grant transaction reaches chain finality.</p><label>Grant ID<input value={grantToPublish} onChange={e => setGrantToPublish(e.target.value)}/></label><button onClick={publishPolicy} disabled={busy}>Sign and publish policy</button>
    </article><article><h2>Grants</h2><button className="secondary" onClick={() => token && run(() => refresh(token))}>Refresh indexed grants</button><p className="small">The list is an indexed projection. Select a grant for a live chain read.</p>
      <ul>{grants.map(item => <li key={item.id}><button className="text" onClick={() => inspectGrant(item.id)}>Grant #{item.id} →</button></li>)}</ul>
      {selected && <div className="detail"><h3>Grant #{selected.id}</h3><dl><dt>Agent</dt><dd>{selected.agent}</dd><dt>Token</dt><dd>{selected.token}</dd><dt>Recipient</dt><dd>{selected.recipient}</dd><dt>Ceiling</dt><dd>{selected.ceiling}</dd><dt>Single limit</dt><dd>{selected.singleLimit}</dd><dt>Approval threshold</dt><dd>{selected.approvalThreshold}</dd><dt>Policy hash</dt><dd>{selected.policyHash}</dd><dt>Status</dt><dd>{selected.active ? 'Active' : 'Inactive'}</dd></dl>{selected.active && <button className="danger" onClick={revoke} disabled={busy}>Revoke in wallet</button>}</div>}
    </article></section>
    <AgentWorkbench token={token} request={request} provider={provider} />
    <section><h2>Approval inbox</h2><p>Each request is tied to a live reservation and exact transfer. Review every term before signing. The agent receives the signature only after your wallet approves it.</p><button className="secondary" onClick={() => token && run(() => refresh(token))} disabled={busy}>Refresh inbox</button>
      <div className="operations">{approvals.length === 0 ? <p>No approval requests.</p> : approvals.map(item => <div key={item.id} className="approvalItem"><strong>Grant #{item.grant_id} · {item.state}</strong><code>Request {item.id}</code><dl><dt>Agent</dt><dd>{item.intent.agent}</dd><dt>Recipient</dt><dd>{item.intent.to}</dd><dt>Token</dt><dd>{item.intent.token}</dd><dt>Amount</dt><dd>{item.intent.amount} base units</dd><dt>Nonce</dt><dd>{item.intent.nonce}</dd><dt>Deadline</dt><dd>{new Date(Number(item.intent.deadline) * 1000).toLocaleString()}</dd><dt>Reservation</dt><dd>{item.reservation_id}</dd><dt>Intent hash</dt><dd>{item.intent_hash}</dd></dl>{item.state === 'pending' && <div className="actions"><button onClick={() => approveInbox(item)} disabled={busy}>Sign exact approval</button><button className="danger" onClick={() => rejectInbox(item)} disabled={busy}>Reject</button></div>}</div>)}</div>
    </section>
    <section className="grid"><article><h2>Sign an external request</h2><p>Select a grant above. Pact checks the live reservation before your wallet signs an approval bound to its action hash, ID and deadline.</p>
      <div className="cols"><label>Amount in base units<input value={approvalAmount} onChange={e => { setApprovalAmount(e.target.value); setApprovalSignature(''); }}/></label><label>Intent nonce<input value={approvalNonce} onChange={e => { setApprovalNonce(e.target.value); setApprovalSignature(''); }}/></label></div>
      <div className="cols"><label>Reservation ID<input value={approvalReservationId} onChange={e => { setApprovalReservationId(e.target.value); setApprovalSignature(''); }}/></label><label>Intent deadline<input type="datetime-local" value={approvalDeadline} onChange={e => { setApprovalDeadline(e.target.value); setApprovalSignature(''); }}/></label></div>
      <button onClick={approveTransfer} disabled={busy || !selected}>Review and sign exact approval</button>
      {approvalSignature && <div className="detail"><p>Approval signature</p><code>{approvalSignature}</code><button className="secondary" onClick={() => navigator.clipboard.writeText(approvalSignature)}>Copy signature</button></div>}
    </article><article><h2>Inspect an obligation</h2><p>Read the current obligation state for a grant owned by this principal.</p><label>Obligation ID<input value={obligationId} onChange={e => setObligationId(e.target.value)}/></label><button onClick={inspectObligation} disabled={busy}>Read obligation</button>{obligation && <pre>{JSON.stringify(obligation, null, 2)}</pre>}</article></section>
    <section><h2>Recent operations</h2><p>Only finalized operations are confirmed. A submitted transaction is still pending.</p><div className="operations">{operations.length === 0 ? 'No operations yet.' : operations.map(op => <div key={op.id}><strong>{op.kind}</strong><span>{op.state}</span><code>{op.id}</code>{op.error_code && <small>{op.error_code}</small>}</div>)}</div></section></>}
    <footer>Pact Console · Chain state and principal signatures determine authority.</footer></main>;
}
