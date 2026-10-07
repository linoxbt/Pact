/** Owner-authenticated Pact HTTP control plane. Pass a short-lived Privy access token. */
export class PactControlClient {
  private readonly origin: URL;
  constructor(baseUrl: string, readonly accessToken: string, readonly fetcher: typeof fetch = fetch) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('HTTPS required');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
      throw new Error('Control API URL must be an origin');
    if (!accessToken || /[\r\n]/.test(accessToken)) throw new Error('Invalid owner token');
    this.origin = url;
  }

  async request<T = unknown>(method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', path: string,
    body?: unknown): Promise<T> {
    if (!/^\/v2\/[A-Za-z0-9/_?=&.%+-]+$/.test(path) || path.includes('..') || path.includes('//'))
      throw new Error('Invalid control API path');
    const response = await this.fetcher(new URL(path, this.origin), {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${this.accessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    if (raw.length > 1_000_000) throw new Error('Pact response too large');
    const data = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    if (!response.ok) throw new Error(`Pact control ${response.status}: ${String(data.error ?? 'REQUEST_FAILED')}`);
    return data as T;
  }

  account() { return this.request('GET', '/v2/account'); }
  agents(cursor?: string) { return this.request('GET', `/v2/agents${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); }
  createAgent(input: { name: string; environment: 'development'|'staging'|'production'; description?: string }) {
    return this.request('POST', '/v2/agents', input); }
  updateAgent(id: string, patch: { name?: string; description?: string; status?: 'active'|'disabled' }) {
    return this.request('PATCH', `/v2/agents/${id}`, patch); }
  grants(cursor?: string) { return this.request('GET', `/v2/grants${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); }
  createGrant(input: Record<string, unknown>) { return this.request('POST', '/v2/grants', input); }
  narrowGrant(id: string, patch: Record<string, unknown>) {
    return this.request('PATCH', `/v2/grants/${id}`, patch); }
  migrateGrant(id: string) { return this.request('POST', `/v2/grants/${id}/migrate`, {}); }
  policies(cursor?: string) { return this.request('GET', `/v2/policies${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); }
  createPolicy(input: Record<string, unknown>) { return this.request('POST', '/v2/policies', input); }
  updatePolicy(id: string, patch: Record<string, unknown>) {
    return this.request('PATCH', `/v2/policies/${id}`, patch); }
  services(cursor?: string) { return this.request('GET', `/v2/services${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); }
  createService(input: Record<string, unknown>) { return this.request('POST', '/v2/services', input); }
  updateService(id: string, patch: { name?: string; status?: 'active'|'disabled' }) {
    return this.request('PATCH', `/v2/services/${id}`, patch); }
  saveServiceSecret(id: string, secret: string) {
    return this.request('PUT', `/v2/services/${id}/secret`, { secret }); }
  revokeServiceSecret(id: string) { return this.request('DELETE', `/v2/services/${id}/secret`); }
  endpoints(cursor?: string) { return this.request('GET', `/v2/endpoints${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); }
  createEndpoint(input: Record<string, unknown>) { return this.request('POST', '/v2/endpoints', input); }
  updateEndpoint(id: string, patch: Record<string, unknown>) {
    return this.request('PATCH', `/v2/endpoints/${id}`, patch); }
  previewOpenApi(spec: unknown) { return this.request('POST', '/v2/openapi/preview', { spec }); }
  importOpenApi(serviceId: string, input: Record<string, unknown>) {
    return this.request('POST', `/v2/services/${serviceId}/import`, input); }
  keys(agentId: string, cursor?:string) { return this.request('GET', `/v2/agents/${agentId}/keys${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); }
  issueKey(agentId: string, input: { name: string; scopes: ('proxy.read'|'proxy.write')[]; expiresAt: string }) {
    return this.request('POST', `/v2/agents/${agentId}/keys`, input); }
  rotateKey(agentId: string, keyId: string) {
    return this.request('POST', `/v2/agents/${agentId}/keys/${keyId}/rotate`, {}); }
  revokeKey(agentId: string, keyId: string) {
    return this.request('DELETE', `/v2/agents/${agentId}/keys/${keyId}`); }
  approvals(cursor?: string) { return this.request('GET', `/v2/approvals${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); }
  approvalIntent(id:string) { return this.request('GET', `/v2/approvals/${id}/intent`); }
  prepareAccountDeployment() { return this.request('POST', '/v2/account/onchain/prepare', {}); }
  decideApproval(id: string, decision: 'approved'|'rejected') {
    return this.request('POST', `/v2/approvals/${id}/decision`, { decision }); }
  activity(query?: URLSearchParams) {
    return this.request('GET', `/v2/activity${query?.size ? `?${query}` : ''}`); }
  activityDetail(id: string) { return this.request('GET', `/v2/activity/${id}`); }
  audit(cursor?: string) { return this.request('GET', `/v2/audit${cursor ? `?cursor=${cursor}` : ''}`); }
}
