/** Scoped HTTP client for the hosted Pact API. API keys are sent only to the configured HTTPS origin. */
export class PactHttpClient {
  readonly baseUrl: URL;
  constructor(baseUrl: string, readonly token: string, readonly fetcher: typeof fetch = fetch) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('HTTPS required');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
      throw new Error('API URL must be an origin');
    if (!token || /[\r\n]/.test(token)) throw new Error('Invalid Pact credential');
    this.baseUrl = url;
  }

  async request<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string,
    body?: unknown): Promise<T> {
    if (!/^\/v1\/[A-Za-z0-9/_-]+$/.test(path)) throw new Error('Invalid API path');
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    if (raw.length > 1024 * 1024) throw new Error('Pact response too large');
    const data = raw ? JSON.parse(raw) as unknown : {};
    if (!response.ok) {
      const code = typeof data === 'object' && data !== null && 'error' in data ?
        String(data.error) : 'REQUEST_FAILED';
      throw new Error(`Pact API ${response.status}: ${code}`);
    }
    return data as T;
  }

  grant(grantId: bigint) { return this.request('GET', `/v1/grants/${grantId}`); }
  myAuthority() { return this.request('GET', '/v1/agent/me'); }
  quoteTransfer(intent: unknown) { return this.request('POST', '/v1/transfers/quote', intent); }
  prepareTransferReservation(intent: unknown, idempotencyKey: string) {
    return this.request('POST', '/v1/transfers/prepare-reservation', { intent, idempotencyKey });
  }
  prepareTransferExecution(intent: unknown, reservationId: bigint, idempotencyKey: string,
    approval?: string) { return this.request('POST', '/v1/transfers/prepare-execution',
      { intent, reservationId: reservationId.toString(), idempotencyKey, ...(approval ? { approval } : {}) }); }
  operation(id: string) { return this.request('GET', `/v1/operations/${id}`); }
  receipt(id: bigint) { return this.request('GET', `/v1/receipts/${id}`); }
  approvals() { return this.request('GET', '/v1/approvals'); }
  approval(id: string) { return this.request('GET', `/v1/approvals/${id}`); }
  requestApproval(intent: unknown, reservationId: bigint) {
    return this.request('POST', '/v1/approvals/requests', { intent, reservationId: reservationId.toString() });
  }
  registerAgent(grantId: bigint, name: string, description = '') {
    return this.request('POST', '/v1/agents', { grantId: grantId.toString(), name, description });
  }
  agents() { return this.request('GET', '/v1/agents'); }
  agent(id: string) { return this.request('GET', `/v1/agents/${id}`); }
  updateAgent(id: string, patch: { name?: string; description?: string; status?: 'active' | 'disabled' }) {
    return this.request('PATCH', `/v1/agents/${id}`, patch);
  }
  keyChallenge(id: string, name: string, scopes: string[], expiresAt: string) {
    return this.request<{ challengeId: string; message: string }>('POST',
      `/v1/agents/${id}/keys/challenge`, { name, scopes, expiresAt });
  }
  issueKey(id: string, challengeId: string, signature: string) {
    return this.request('POST', `/v1/agents/${id}/keys`, { challengeId, signature });
  }
  keys(id: string) { return this.request('GET', `/v1/agents/${id}/keys`); }
  revokeKey(id: string, keyId: string) { return this.request('DELETE', `/v1/agents/${id}/keys/${keyId}`); }
  credentials(id: string) { return this.request('GET', `/v1/agents/${id}/credentials`); }
  saveCredential(id: string, provider: 'github' | 'openai' | 'anthropic' | 'custom',
    label: string, secret: string) { return this.request('POST', `/v1/agents/${id}/credentials`,
      { provider, label, secret }); }
  revokeCredential(id: string, credentialId: string) {
    return this.request('DELETE', `/v1/agents/${id}/credentials/${credentialId}`);
  }
  agentConfig(id: string) { return this.request('GET', `/v1/agents/${id}/config`); }
  configureAgent(id: string, config: { provider: 'openai' | 'anthropic' | 'custom'; model: string;
    instructions: string; maxOutputTokens: number; customEndpoint?: string }) {
    return this.request('PUT', `/v1/agents/${id}/config`, config);
  }
  runAgent(id: string, input: string, idempotencyKey: string) {
    return this.request('POST', `/v1/agents/${id}/runs`, { input, idempotencyKey });
  }
  runs(id: string) { return this.request('GET', `/v1/agents/${id}/runs`); }
  run(id: string, runId: string) { return this.request('GET', `/v1/agents/${id}/runs/${runId}`); }
}
