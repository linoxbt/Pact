import { createServer } from 'node:http';

const port = Number(process.env.PACT_DEMO_UPSTREAM_PORT ?? 4602);
const secret = process.env.PACT_DEMO_UPSTREAM_SECRET ?? 'demo-local-secret-only';
let forwarded = 0;
const server = createServer((request, response) => {
  if (request.url === '/__metrics') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ forwarded }));
    return;
  }
  forwarded++;
  if (request.headers.authorization !== `Bearer ${secret}`) {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'UPSTREAM_AUTH_REQUIRED' }));
    return;
  }
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'healthy', service: 'pact-demo' }));
    return;
  }
  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: 'NOT_FOUND' }));
});
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Pact demo upstream listening on http://127.0.0.1:${port}\n`);
});
