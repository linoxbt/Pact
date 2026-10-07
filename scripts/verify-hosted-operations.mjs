import {spawnSync} from 'node:child_process';
// Run inside Railway's private network; never export database credentials.
// Register your SSH key first, then optionally set PACT_SSH_IDENTITY_FILE.
const identity=process.env.PACT_SSH_IDENTITY_FILE;
const result=spawnSync('railway',['ssh',...(identity?['--identity-file',identity]:[]),
  '--project','0fd7f850-661f-41d9-b924-e3ede54c3097',
  '--environment','41195367-81d8-4ed6-9cbf-9567b2c5e48f',
  '--service','a358e675-4c51-4c7e-9947-f9ab41ae7064',
  '--','node','scripts/ops-status.mjs'],{stdio:'inherit',env:{...process.env,
    RAILWAY_CALLER:'skill:use-railway@1.6.1',RAILWAY_AGENT_SESSION:'pact-remediation-20261007'}});
process.exitCode=result.status??1;
