import { mkdirSync, openSync, writeFileSync, closeSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const dir = resolve(import.meta.dirname, '../.secrets');
const keyPath = resolve(dir, 'monad-testnet-deployer.key');
if (existsSync(keyPath)) throw new Error('Testnet deployer already exists; refusing to replace it');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const key = generatePrivateKey();
const fd = openSync(keyPath, 'wx', 0o600);
try { writeFileSync(fd, `${key}\n`, { encoding: 'utf8' }); }
finally { closeSync(fd); }
console.log(`Monad testnet deployer: ${privateKeyToAccount(key).address}`);
console.log('Private key stored locally in .secrets/monad-testnet-deployer.key (mode 0600).');
