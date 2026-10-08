import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http, isAddress, parseEther,
  encodeDeployData, encodeFunctionData, keccak256, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = resolve(import.meta.dirname, '..');
const network = process.env.PACT_DEPLOY_NETWORK ?? 'testnet';
if (!['testnet','mainnet'].includes(network)) throw Error('Invalid deployment network');
const expectedChain = network === 'mainnet' ? 143 : 10143;
const keyPath = resolve(root, process.env.PACT_DEPLOYER_KEY_FILE ?? '.secrets/monad-testnet-deployer.key');
const rpcUrl = process.env.PACT_RPC_URL;
if (!rpcUrl || !rpcUrl.startsWith('https://')) throw new Error('Set an HTTPS PACT_RPC_URL');
const key = readFileSync(keyPath, 'utf8').trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Invalid local deployer key');
const account = privateKeyToAccount(key);
const rpc = createPublicClient({ transport: http(rpcUrl) });
const chainId = await rpc.getChainId();
if (chainId !== expectedChain) throw new Error(`Refusing deployment: expected Monad ${network} ${expectedChain}, got ${chainId}`);
const balance = await rpc.getBalance({ address: account.address });
console.log(`Monad ${network} deployer ${account.address}; balance ${balance.toString()} wei`);
if (!process.argv.includes('--broadcast')) process.exit(0);
if (process.env[network === 'mainnet' ? 'PACT_BROADCAST_MAINNET' : 'PACT_BROADCAST_TESTNET'] !== 'yes')
  throw new Error(`Set PACT_BROADCAST_${network.toUpperCase()}=yes and pass --broadcast to deploy`);
const maximumCost = network === 'mainnet' ? parseEther(process.env.PACT_MAX_DEPLOYMENT_COST_MON ?? '0') : null;
if (maximumCost !== null && maximumCost <= 0n) throw Error('Mainnet requires a positive PACT_MAX_DEPLOYMENT_COST_MON');
const principal = network === 'mainnet' ? null : process.env.PACT_PRINCIPAL;
if (network !== 'mainnet' && (!principal || !isAddress(principal) || principal === zeroAddress))
  throw new Error('Set the human-controlled PACT_PRINCIPAL address');
if (balance === 0n) throw new Error('Fund the deployer before broadcasting');

const wallet = createWalletClient({ account, transport: http(rpcUrl) });
const release = process.env.PACT_DEPLOYMENT_RELEASE ?? '';
if (release && !/^[a-z0-9-]{3,60}$/.test(release)) throw new Error('Invalid release name');
const suffix = release ? `-${release}` : '';
const checkpointPath = resolve(root, `.secrets/monad-${network}-deployment${suffix}.json`);
const checkpoint = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, 'utf8')) :
  { chainId, deployer: account.address, principal, startBlock: (await rpc.getBlockNumber()).toString(), spentWei: '0' };
if (checkpoint.chainId !== chainId || checkpoint.deployer !== account.address ||
    (checkpoint.principal?.toLowerCase() ?? null) !== (principal?.toLowerCase() ?? null))
  throw new Error('Deployment checkpoint does not match chain, deployer and principal');
const save = () => {
  writeFileSync(`${checkpointPath}.tmp`, JSON.stringify(checkpoint, null, 2) + '\n', { mode: 0o600 });
  renameSync(`${checkpointPath}.tmp`,checkpointPath);
};
const artifact = name => JSON.parse(readFileSync(resolve(root,
  `packages/contracts/out/${name}.sol/${name}.json`), 'utf8'));
const fees = async gas => {
  const gasPrice = await rpc.getGasPrice();
  const cap = gasPrice * 2n;
  if (maximumCost !== null && BigInt(checkpoint.spentWei ?? '0') + gas * cap > maximumCost)
    throw Error('Deployment spending cap would be exceeded');
  if (await rpc.getBalance({address:account.address}) < gas * cap) throw Error('Insufficient deployer gas balance');
  return {gas,gasPrice:cap};
};
const recordReceipt = receipt => {
  checkpoint.transactions ??= [];
  if (!checkpoint.transactions.includes(receipt.transactionHash)) {
    checkpoint.spentWei=(BigInt(checkpoint.spentWei ?? '0')+receipt.gasUsed*receipt.effectiveGasPrice).toString();
    checkpoint.transactions.push(receipt.transactionHash);
  }
};
// Persist signed bytes before sending. A restart rebroadcasts the identical transaction,
// preserving its nonce and cost cap, rather than deploying a second stack accidentally.
const transact = async (id,data,to) => {
  checkpoint.pending ??= {};
  let pending=checkpoint.pending[id];
  if (pending && (pending.data!==data || pending.to!==to)) throw Error(`Pending transaction mismatch: ${id}`);
  if (!pending) {
    const estimate=await rpc.estimateGas({account:account.address,data,...(to?{to}:{})});
    const prepared=await wallet.prepareTransactionRequest({account,chain:null,data,...(to?{to}:{}),
      ...await fees(estimate*12n/10n),type:'legacy'});
    const serializedTransaction=await wallet.signTransaction(prepared);
    pending={serializedTransaction,hash:keccak256(serializedTransaction),data,to};
    checkpoint.pending[id]=pending;save();
  }
  let receipt=await rpc.getTransactionReceipt({hash:pending.hash}).catch(()=>null);
  if (!receipt) {
    try {await rpc.sendRawTransaction({serializedTransaction:pending.serializedTransaction});}
    catch {
      // An already known transaction is safe; any missing hash is an unresolved send.
      await rpc.getTransaction({hash:pending.hash});
    }
    receipt=await rpc.waitForTransactionReceipt({hash:pending.hash,confirmations:5});
  }
  recordReceipt(receipt);save();
  if (receipt.status!=='success') throw Error(`Transaction failed: ${id} ${pending.hash}`);
  return receipt;
};
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
  const receipt = await transact(name,encodeDeployData({abi:compiled.abi,bytecode,args}));
  const hash=receipt.transactionHash;
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
  const receipt = await transact(`${name}.${functionName}`,encodeFunctionData({abi:artifact(name).abi,functionName,args}),address);
  const hash=receipt.transactionHash;
  if (receipt.status !== 'success') throw new Error(`${name}.${functionName} failed: ${hash}`);
  console.log(`${name}.${functionName}: ${hash}`);
};

const ledger = await deploy('CommitmentLedger');
const registry = await deploy('AuthorityRegistry', [ledger]);
// Mainnet has no deployment-wide principal. Each user creates their own account through the factory.
const accountAddress = network === 'mainnet' ? zeroAddress : await deploy('PactAccount', [principal, registry, ledger]);
const accountFactory = await deploy('PactAccountFactory', [registry, ledger]);
const manager = await deploy('ObligationManager', [registry, ledger]);
const vault = await deploy('SettlementVault', [manager]);
const receipts = await deploy('ReceiptRegistry', [manager]);
await configure('CommitmentLedger', ledger, 'configure', [registry]);
await configure('CommitmentLedger', ledger, 'configureObligationManager', [manager]);
await configure('ObligationManager', manager, 'configure', [vault, receipts]);
const output = { chainId, deployer: account.address, principal, accountMode: network === 'mainnet' ? 'per_user_factory' : 'legacy_and_factory', ledger, registry,
  account: accountAddress, accountFactory, manager, vault, receipts,
  startBlock: checkpoint.startBlock, transactions: checkpoint.transactions, spentWei: checkpoint.spentWei, deployedAt: new Date().toISOString() };
mkdirSync(resolve(root, 'deployments'), { recursive: true });
const manifestPath=resolve(root, `deployments/monad-${network}${suffix}.json`);
if (!existsSync(manifestPath)) writeFileSync(manifestPath, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
else {
  const existing=JSON.parse(readFileSync(manifestPath,'utf8'));
  for(const field of ['ledger','registry','account','accountFactory','manager','vault','receipts'])
    if(existing[field]!==output[field]) throw new Error(`Existing manifest disagrees: ${field}`);
}
console.log(`Deployment manifest verified: ${manifestPath}`);
