import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createPactMcp, pactHttpApi } from './server.js';

const baseUrl = process.env.PACT_API_URL;
const token = process.env.PACT_SESSION_TOKEN;
if (!baseUrl || !token) throw new Error('PACT_API_URL and PACT_SESSION_TOKEN are required');
const api = pactHttpApi(baseUrl, token);
void serveStdio(() => createPactMcp(api));
