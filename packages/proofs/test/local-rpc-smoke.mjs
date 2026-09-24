import assert from 'node:assert/strict';
import { createPublicClient, http, keccak256, toBytes } from 'viem';
import { hashTransferIntent } from '@pact/schemas';
import { verifyTransferReservation } from '../dist/index.js';

const registry = process.env.PACT_REGISTRY;
const ledger = process.env.PACT_LEDGER;
const account = process.env.PACT_ACCOUNT;
const principal = process.env.PACT_PRINCIPAL;
const rpc = process.env.PACT_RPC;
if (!registry || !ledger || !account || !principal || !rpc) throw new Error('missing local smoke environment');

const client = createPublicClient({ transport: http(rpc) });
const intent = { grantId: 1n, agent: principal, token: '0x0000000000000000000000000000000000001234',
  to: '0x0000000000000000000000000000000000005678', amount: 100n, nonce: 1n,
  deadline: 2_000_000_000n, policyHash: keccak256(toBytes('local-smoke-policy')) };
const digest = hashTransferIntent(await client.getChainId(), account, intent);
const accountAbi = [{ type: 'function', name: 'hashIntent', stateMutability: 'view', inputs: [
  { name: 'intent', type: 'tuple', components: [
    { name: 'grantId', type: 'uint256' }, { name: 'agent', type: 'address' },
    { name: 'token', type: 'address' }, { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' }, { name: 'policyHash', type: 'bytes32' },
  ] },
], outputs: [{ type: 'bytes32' }] }];
assert.equal(await client.readContract({ address: account, abi: accountAbi,
  functionName: 'hashIntent', args: [intent] }), digest);
const result = await verifyTransferReservation(client, { registry, ledger, account }, intent, 1n);
assert.deepEqual(result, { valid: true, reason: 'OK' });
const tampered = await verifyTransferReservation(client, { registry, ledger, account },
  { ...intent, amount: 101n }, 1n);
assert.equal(tampered.valid, false);
console.log('Local RPC proof smoke passed');
