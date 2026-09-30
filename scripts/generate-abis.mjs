import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contracts = [
  'AuthorityRegistry', 'CommitmentLedger', 'PactAccount', 'PactAccountFactory', 'ObligationManager',
  'SettlementVault', 'ReceiptRegistry',
];
const output = [
  '// Generated from Foundry artifacts by scripts/generate-abis.mjs. Do not edit by hand.',
  '',
];
for (const name of contracts) {
  const path = resolve(root, 'packages/contracts/out', `${name}.sol`, `${name}.json`);
  const artifact = JSON.parse(readFileSync(path, 'utf8'));
  output.push(`export const ${name}Abi = ${JSON.stringify(artifact.abi, null, 2)} as const;`, '');
}
const target = resolve(root, 'packages/abis/src/index.ts');
const content = `${output.join('\n').trimEnd()}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== content) {
    console.error('Generated ABI bindings are stale. Run pnpm generate:abis.');
    process.exitCode = 1;
  }
} else {
  writeFileSync(target, content);
}
