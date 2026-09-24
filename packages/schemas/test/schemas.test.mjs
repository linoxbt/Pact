import assert from 'node:assert/strict';
import test from 'node:test';
import { availableCapacity, hashObligationTerms, hashTransferIntent, parseBaseUnits } from '../dist/index.js';

const account = '0x0000000000000000000000000000000000000001';
const token = '0x0000000000000000000000000000000000000002';
const agent = '0x0000000000000000000000000000000000000003';
const to = '0x0000000000000000000000000000000000000004';
const policyHash = `0x${'11'.repeat(32)}`;

test('amount parsing preserves base units and rejects excess precision', () => {
  assert.equal(parseBaseUnits('1.000001', 6), 1_000_001n);
  assert.equal(parseBaseUnits('0', 6), 0n);
  assert.throws(() => parseBaseUnits('1.0000001', 6));
  assert.throws(() => parseBaseUnits('-1', 6));
  assert.throws(() => parseBaseUnits('1e6', 6));
});

test('capacity detects corrupted projections instead of returning a negative number', () => {
  const grant = { ceiling: 500n };
  assert.equal(availableCapacity(grant, { allocated: 100n, reserved: 100n, committed: 100n, spent: 50n }), 150n);
  assert.throws(() => availableCapacity(grant, { allocated: 300n, reserved: 300n, committed: 0n, spent: 0n }));
});

test('typed action hash binds chain, account, recipient and amount', () => {
  const intent = { grantId: 1n, agent, token, to, amount: 500n, nonce: 7n, deadline: 9999999999n, policyHash };
  const hash = hashTransferIntent(143, account, intent);
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  assert.notEqual(hashTransferIntent(10143, account, intent), hash);
  assert.notEqual(hashTransferIntent(143, to, intent), hash);
  assert.notEqual(hashTransferIntent(143, account, { ...intent, amount: 501n }), hash);
  assert.notEqual(hashTransferIntent(143, account, { ...intent, to: agent }), hash);
});

test('obligation terms hash binds verifier and dispute window', () => {
  const terms = { grantId: 1n, reservationId: 2n, provider: to, verifier: agent,
    arbitrator: account, token, amount: 6000n, deliverBy: 10000n, verifyBy: 12000n,
    challengePeriod: 100n, specificationHash: policyHash };
  const hash = hashObligationTerms(143, account, terms);
  assert.notEqual(hashObligationTerms(143, account, { ...terms, verifier: token }), hash);
  assert.notEqual(hashObligationTerms(143, account, { ...terms, challengePeriod: 101n }), hash);
  assert.notEqual(hashObligationTerms(143, to, terms), hash);
});
