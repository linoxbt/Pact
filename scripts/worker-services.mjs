import { spawn } from 'node:child_process';

// Share one Railway service on Free. A failed child fails the deployment so
// the platform restarts the complete pair; neither child can silently vanish.
const children = ['worker', 'runner'].map(service => spawn(process.execPath,
  [`apps/${service}/dist/main.js`], {stdio:'inherit', env:process.env}));
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
