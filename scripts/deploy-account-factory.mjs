import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = resolve(import.meta.dirname, '..');
const rpcUrl = process.env.PACT_RPC_URL;
if (!rpcUrl?.startsWith('https://')) throw new Error('Set an HTTPS PACT_RPC_URL');
const manifestPath = resolve(root, 'deployments/monad-testnet.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const artifact = JSON.parse(readFileSync(resolve(root,
  'packages/contracts/out/PactAccountFactory.sol/PactAccountFactory.json'), 'utf8'));
const rpc = createPublicClient({ transport: http(rpcUrl) });
const chainId = await rpc.getChainId();
if (chainId !== 10143 || manifest.chainId !== 10143) throw new Error('Monad testnet only');
for (const name of ['registry','ledger']) {
  if (!manifest[name] || await rpc.getCode({ address: manifest[name] }) === '0x')
    throw new Error(`Missing deployed ${name}`);
}
if (manifest.accountFactory) {
  const code = await rpc.getCode({ address: manifest.accountFactory });
  if (!code || code === '0x') throw new Error('Manifest accountFactory has no code');
  console.log(`Existing factory: ${manifest.accountFactory}`);
  process.exit(0);
}
if (!process.argv.includes('--broadcast')) {
  console.log(`Ready to deploy per-user account factory on chain ${chainId}`);
  process.exit(0);
}
if (process.env.PACT_BROADCAST_TESTNET !== 'yes')
  throw new Error('Set PACT_BROADCAST_TESTNET=yes and pass --broadcast');
const key = readFileSync(resolve(root, '.secrets/monad-testnet-deployer.key'), 'utf8').trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Invalid testnet deployer key');
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, transport: http(rpcUrl) });
const tx = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object,
  args: [manifest.registry, manifest.ledger] });
const receipt = await rpc.waitForTransactionReceipt({ hash: tx, confirmations: 5 });
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`Factory deployment failed: ${tx}`);
const address = receipt.contractAddress;
if (await rpc.getCode({ address }) === '0x') throw new Error('Factory has no code');
const [registry, ledger] = await Promise.all(['registry','ledger'].map(functionName =>
  rpc.readContract({ address, abi: artifact.abi, functionName })));
if (registry.toLowerCase() !== manifest.registry.toLowerCase() ||
    ledger.toLowerCase() !== manifest.ledger.toLowerCase()) throw new Error('Factory links mismatch');
const next = { ...manifest, accountFactory: address };
const temp = `${manifestPath}.tmp`;
writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
renameSync(temp, manifestPath);
console.log(`PactAccountFactory: ${address} (${tx})`);
