import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabase, migrate, OperationStore } from '../dist/index.js';

const url = process.env.PACT_TEST_DATABASE_URL;

test('migrations and idempotent operations persist across store instances', { skip: !url }, async () => {
  const database = createDatabase(url);
  try {
    await migrate(database);
    await migrate(database);
    const firstStore = new OperationStore(database);
    const principal = '0x0000000000000000000000000000000000000001';
    const actor = '0x0000000000000000000000000000000000000002';
    const targetAddress = '0x0000000000000000000000000000000000000003';
    const idempotencyKey = randomUUID();
    const actionHash = `0x${'11'.repeat(32)}`;
    const input = { principal, actor, targetAddress, expectedEvent: 'Reserved', grantId: 1n,
      kind: 'transfer-reservation', idempotencyKey, actionHash };
    const created = await firstStore.prepare(input);
    const secondStore = new OperationStore(database);
    const repeated = await secondStore.prepare(input);
    assert.equal(repeated.id, created.id);
    await assert.rejects(() => secondStore.prepare({ ...input, actionHash: `0x${'22'.repeat(32)}` }),
      /another action/);
    await assert.rejects(() => secondStore.prepare({ ...input,
      actor: '0x0000000000000000000000000000000000000004' }), /another action/);
    const txHash = `0x${'33'.repeat(32)}`;
    const submitted = await secondStore.markSubmitted(created.id, principal, txHash);
    assert.equal(submitted.state, 'submitted');
    assert.equal((await firstStore.get(created.id, principal)).txHash, txHash);
  } finally { await database.end(); }
});
