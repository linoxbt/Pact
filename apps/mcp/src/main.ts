import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createPactMcp, pactGatewayApi, pactHttpApi, type PactApi } from './server.js';

const baseUrl = process.env.PACT_API_URL;
const token = process.env.PACT_SESSION_TOKEN;
const gatewayUrl = process.env.PACT_GATEWAY_URL;
const agentKey = process.env.PACT_AGENT_KEY;
if ((!baseUrl || !token) && (!gatewayUrl || !agentKey))
  throw new Error('Set PACT_API_URL and PACT_SESSION_TOKEN, or PACT_GATEWAY_URL and PACT_AGENT_KEY');
const api: PactApi = baseUrl && token ? pactHttpApi(baseUrl, token) : {
  get: async () => { throw new Error('PACT_API_URL and PACT_SESSION_TOKEN required'); },
  post: async () => { throw new Error('PACT_API_URL and PACT_SESSION_TOKEN required'); },
};
if (gatewayUrl && agentKey) api.proxy = pactGatewayApi(gatewayUrl, agentKey);
void serveStdio(() => createPactMcp(api));
