import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { CommitmentLedgerAbi } from '@pact/abis';
import { matchesExpectedEvent, Reconciler } from '../dist/reconcile.js';

const ledger = '0x0000000000000000000000000000000000000001';
const actor = '0x0000000000000000000000000000000000000002';
const hash = `0x${'11'.repeat(32)}`;
const row = { id: 'op-1', actor, kind: 'transfer-reservation', action_hash: hash, target_address: ledger,
  expected_event: 'Reserved', grant_id: '1', reservation_id: null, tx_hash: `0x${'22'.repeat(32)}`,
  submitted_at: new Date() };
const log = { address: ledger,
  topics: encodeEventTopics({ abi: CommitmentLedgerAbi, eventName: 'Reserved',
    args: { reservationId: 7n, grantId: 1n, intentHash: hash } }),
  data: encodeAbiParameters([{ type: 'uint256' }], [100n]) };

test('reconciliation accepts only the exact Pact event from the expected contract', () => {
  assert.equal(matchesExpectedEvent(row, [log]), true);
  assert.equal(matchesExpectedEvent({ ...row, action_hash: `0x${'33'.repeat(32)}` }, [log]), false);
  assert.equal(matchesExpectedEvent({ ...row, target_address: actor }, [log]), false);
});

test('pending operation stays pending until finality, then confirms', async () => {
  const updates = [];
  const database = { query: async (sql, args) => {
    if (sql.includes('SELECT id,actor')) return { rows: [row] };
    updates.push(args);
    return { rows: [] };
  }, connect: async () => ({ query: async (sql, args) => {
    if (sql.startsWith('UPDATE')) updates.push([sql, args]);
    return { rows: [] };
  }, release: () => {} }) };
  let head = 10n;
  const rpc = { getTransactionReceipt: async () => ({ blockNumber: 10n, blockHash: hash,
    status: 'success', to: ledger, logs: [log] }),
    getBlockNumber: async () => head,
    getBlock: async () => ({ hash }) };
  const reconciler = new Reconciler(database, rpc, 2);
  await reconciler.tick();
  assert.equal(updates.length, 0);
  head = 12n;
  await reconciler.tick();
  assert.match(updates[0][0], /state='confirmed'/);
  assert.equal(updates[0][1][0], row.id);
});
