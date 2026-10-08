import { spawn } from 'node:child_process';

// Share one Railway service on Free. A failed child fails the deployment so
// the platform restarts the complete pair; neither child can silently vanish.
const children = ['worker', 'runner'].map(service => spawn(process.execPath,
  [`apps/${service}/dist/main.js`], {stdio:'inherit', env:process.env}));
// The optional live-test agent gets no database, owner session or vault keys.
// It shares infrastructure on Free, not the worker's application credentials.
if (process.env.PACT_ENABLE_TEST_AGENT === 'yes') {
  const names = ['PATH', 'NODE_ENV', 'PORT', 'PACT_TEST_AGENT_SECRET',
    'PACT_TEST_AGENT_EXPIRES', 'PACT_TEST_AGENT_KEY', 'RAILWAY_DEPLOYMENT_ID'];
  const env = Object.fromEntries(names.filter(name => process.env[name] !== undefined)
    .map(name => [name, process.env[name]]));
  children.push(spawn(process.execPath, ['scripts/live-agent/server.mjs'], {stdio:'inherit', env}));
}
let stopping = false;
let remaining = children.length;
let exitCode = 0;
let deadline;
function stop(code) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  deadline = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 20_000);
  deadline.unref();
}
for (const child of children) {
  child.once('error', () => stop(1));
  child.once('exit', () => {
    if (!stopping) stop(1);
    if (--remaining === 0) { clearTimeout(deadline); process.exitCode = exitCode; }
  });
}
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => stop(0));
