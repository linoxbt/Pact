import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = resolve(import.meta.dirname, '..');
const keyPath = resolve(root, '.secrets/monad-testnet-deployer.key');
const rpcUrl = process.env.PACT_RPC_URL;
if (!rpcUrl || !rpcUrl.startsWith('https://')) throw new Error('Set an HTTPS PACT_RPC_URL');
const key = readFileSync(keyPath, 'utf8').trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Invalid local deployer key');
const account = privateKeyToAccount(key);
const rpc = createPublicClient({ transport: http(rpcUrl) });
const chainId = await rpc.getChainId();
if (chainId !== 10143) throw new Error(`Refusing deployment: expected Monad testnet 10143, got ${chainId}`);
const balance = await rpc.getBalance({ address: account.address });
console.log(`Testnet deployer ${account.address}; balance ${balance.toString()} wei`);
if (!process.argv.includes('--broadcast')) process.exit(0);
if (process.env.PACT_BROADCAST_TESTNET !== 'yes')
  throw new Error('Set PACT_BROADCAST_TESTNET=yes and pass --broadcast to deploy');
const principal = process.env.PACT_PRINCIPAL;
if (!principal || !isAddress(principal)) throw new Error('Set the human-controlled PACT_PRINCIPAL address');
if (balance === 0n) throw new Error('Fund the testnet deployer before broadcasting');

const wallet = createWalletClient({ account, transport: http(rpcUrl) });
const checkpointPath = resolve(root, '.secrets/monad-testnet-deployment.json');
const checkpoint = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, 'utf8')) :
  { chainId, deployer: account.address, principal };
if (checkpoint.chainId !== chainId || checkpoint.deployer !== account.address ||
    checkpoint.principal.toLowerCase() !== principal.toLowerCase())
  throw new Error('Deployment checkpoint does not match chain, deployer and principal');
const save = () => writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2) + '\n',
  { mode: 0o600 });
const artifact = name => JSON.parse(readFileSync(resolve(root,
  `packages/contracts/out/${name}.sol/${name}.json`), 'utf8'));
const deploy = async (name, args = []) => {
  if (checkpoint[name]) {
    const code = await rpc.getCode({ address: checkpoint[name] });
    if (!code || code === '0x') throw new Error(`Checkpoint ${name} has no code`);
    console.log(`${name}: ${checkpoint[name]} (existing)`);
    return checkpoint[name];
  }
  const compiled = artifact(name);
  const bytecode = compiled.bytecode.object;
  if (!bytecode || bytecode === '0x') throw new Error(`Missing bytecode for ${name}`);
  const hash = await wallet.deployContract({ abi: compiled.abi, bytecode, args });
  const receipt = await rpc.waitForTransactionReceipt({ hash, confirmations: 5 });
  if (receipt.status !== 'success' || !receipt.contractAddress)
    throw new Error(`${name} deployment failed: ${hash}`);
  const code = await rpc.getCode({ address: receipt.contractAddress });
  if (!code || code === '0x') throw new Error(`${name} has no deployed code`);
  checkpoint[name] = receipt.contractAddress;
  save();
  console.log(`${name}: ${receipt.contractAddress} (${hash})`);
  return receipt.contractAddress;
};
const configure = async (name, address, functionName, args) => {
  const current = await rpc.readContract({ address, abi: artifact(name).abi,
    functionName: functionName === 'configureObligationManager' ? 'obligationManager' :
      name === 'CommitmentLedger' ? 'registry' : 'vault' });
  if (current.toLowerCase() === args[0].toLowerCase()) {
    if (name === 'ObligationManager') {
      const currentReceipts = await rpc.readContract({ address,
        abi: artifact(name).abi, functionName: 'receipts' });
      if (currentReceipts.toLowerCase() !== args[1].toLowerCase())
        throw new Error('ObligationManager.receipts points to a different address');
    }
    console.log(`${name}.${functionName}: already configured`);
    return;
  }
  if (current !== '0x0000000000000000000000000000000000000000')
    throw new Error(`${name}.${functionName} points to a different address`);
  const hash = await wallet.writeContract({ address, abi: artifact(name).abi, functionName, args });
  const receipt = await rpc.waitForTransactionReceipt({ hash, confirmations: 5 });
  if (receipt.status !== 'success') throw new Error(`${name}.${functionName} failed: ${hash}`);
  console.log(`${name}.${functionName}: ${hash}`);
};

const ledger = await deploy('CommitmentLedger');
const registry = await deploy('AuthorityRegistry', [ledger]);
const accountAddress = await deploy('PactAccount', [principal, registry, ledger]);
const manager = await deploy('ObligationManager', [registry, ledger]);
const vault = await deploy('SettlementVault', [manager]);
const receipts = await deploy('ReceiptRegistry', [manager]);
await configure('CommitmentLedger', ledger, 'configure', [registry]);
await configure('CommitmentLedger', ledger, 'configureObligationManager', [manager]);
await configure('ObligationManager', manager, 'configure', [vault, receipts]);
const output = { chainId, deployer: account.address, principal, ledger, registry,
  account: accountAddress, manager, vault, receipts, deployedAt: new Date().toISOString() };
mkdirSync(resolve(root, 'deployments'), { recursive: true });
writeFileSync(resolve(root, 'deployments/monad-testnet.json'), JSON.stringify(output, null, 2) + '\n',
  { flag: 'wx' });
console.log('Deployment manifest written to deployments/monad-testnet.json');
