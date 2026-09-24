import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateTransfer, quoteTransfer } from '../dist/index.js';

const principal = '0x0000000000000000000000000000000000000001';
const account = '0x0000000000000000000000000000000000000002';
const agent = '0x0000000000000000000000000000000000000003';
const token = '0x0000000000000000000000000000000000000004';
const recipient = '0x0000000000000000000000000000000000000005';
const policyHash = `0x${'11'.repeat(32)}`;
const grant = { id: 1n, principal, account, agent, token, recipient, parentId: 0n,
  ceiling: 15_000n, singleLimit: 10_000n, approvalThreshold: 5_000n,
  expiresAt: 10_000n, policyHash, active: true };
const balance = { allocated: 6_000n, reserved: 0n, committed: 0n, spent: 0n };
const intent = { grantId: 1n, agent, token, to: recipient, amount: 6_000n,
  nonce: 1n, deadline: 9_000n, policyHash };

test('quote counts full transfer in cash and liability', () => {
  assert.deepEqual(quoteTransfer(intent), { cashNow: 6_000n, grossLiability: 6_000n,
    requiredReservation: 6_000n, token, adapter: 'erc20-transfer-v1' });
});

test('approval is required above threshold', () => {
  assert.equal(evaluateTransfer(grant, balance, intent, 1n).result, 'REQUIRE_APPROVAL');
});

test('denial precedes approval for insufficient capacity or wrong recipient', () => {
  assert.equal(evaluateTransfer(grant, { ...balance, reserved: 4_000n }, intent, 1n).reason,
    'INSUFFICIENT_CAPACITY');
  assert.equal(evaluateTransfer(grant, balance, { ...intent, to: agent }, 1n).reason, 'RECIPIENT_DENIED');
});

test('agent may use a valid amount below threshold', () => {
  assert.equal(evaluateTransfer(grant, balance, { ...intent, amount: 4_000n }, 1n).result, 'ALLOW');
});
