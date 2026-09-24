import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters, keccak256 } from 'viem';
import { hashTransferIntent } from '@pact/schemas';
import { verifyReceiptAnchor, verifyTransferReservation } from '../dist/index.js';

const registry = '0x0000000000000000000000000000000000000001';
const ledger = '0x0000000000000000000000000000000000000002';
const account = '0x0000000000000000000000000000000000000003';
const principal = '0x0000000000000000000000000000000000000004';
const agent = '0x0000000000000000000000000000000000000005';
const token = '0x0000000000000000000000000000000000000006';
const to = '0x0000000000000000000000000000000000000007';
const policyHash = `0x${'11'.repeat(32)}`;
const intent = { grantId: 1n, agent, token, to, amount: 600n, nonce: 2n,
  deadline: 2000n, policyHash };

test('reservation verifier rejects tampered amount with Pact API absent', async () => {
  const reservation = [1n, hashTransferIntent(143, account, intent), 600n, 1500n, false, false];
  const client = {
    getChainId: async () => 143,
    getBlock: async () => ({ timestamp: 1000n }),
    readContract: async ({ address, functionName }) => {
      if (functionName === 'getGrant') return { principal, agent, account, token, recipient: to,
        singleLimit: 1000n, approvalThreshold: 1000n, expiresAt: 3000n, policyHash };
      if (functionName === 'isActive') return true;
      if (functionName === 'reservations') return reservation;
      if (functionName === 'principal') return principal;
      if (functionName === 'registry') return registry;
      if (functionName === 'ledger') return ledger;
      throw new Error(`${address}: ${functionName}`);
    },
  };
  assert.equal((await verifyTransferReservation(client, { registry, ledger, account }, intent, 1n)).valid, true);
  assert.equal((await verifyTransferReservation(client, { registry, ledger, account },
    { ...intent, amount: 601n }, 1n)).reason, 'RESERVATION_MISMATCH');
  const approvalClient = { ...client, readContract: async (args) => {
    if (args.functionName === 'getGrant') return { principal, agent, account, token, recipient: to,
      singleLimit: 1000n, approvalThreshold: 500n, expiresAt: 3000n, policyHash };
    return client.readContract(args);
  } };
  assert.equal((await verifyTransferReservation(approvalClient,
    { registry, ledger, account }, intent, 1n)).reason, 'APPROVAL_REQUIRED');
});

test('receipt verifier detects disclosure mismatch', async () => {
  const termsDigest = `0x${'22'.repeat(32)}`;
  const evidenceHash = `0x${'33'.repeat(32)}`;
  const verdictHash = `0x${'44'.repeat(32)}`;
  const root = keccak256(encodeAbiParameters([
    { type: 'uint256' }, { type: 'address' }, { type: 'uint256' },
    { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bool' },
  ], [143n, registry, 1n, termsDigest, evidenceHash, verdictHash, true]));
  const client = { getChainId: async () => 143,
    readContract: async () => ({ termsDigest, evidenceHash, verdictHash, root, paid: true }) };
  assert.equal((await verifyReceiptAnchor(client, registry, 1n)).valid, true);
  assert.equal((await verifyReceiptAnchor(client, registry, 1n,
    { termsDigest, evidenceHash: termsDigest, verdictHash, paid: true })).reason, 'DISCLOSURE_MISMATCH');
});
