import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createDatabase,migrate} from '@pact/operations';
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
    if (sql.includes('RETURNING o.id')) return { rows: [row] };
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

test('a hundred unresolved operations do not starve the next operation',
  {skip:!process.env.PACT_TEST_DATABASE_URL},async()=>{
    const database=createDatabase(process.env.PACT_TEST_DATABASE_URL);
    const principal=randomUUID();const seen=[];
    try {
      await migrate(database);
      for(let i=0;i<101;i++) await database.query(`INSERT INTO pact_operations
        (id,principal,actor,kind,idempotency_key,action_hash,target_address,expected_event,tx_hash,state,submitted_at)
        VALUES($1,$2,$3,'transfer-reservation',$4,$5,$6,'Reserved',$7,'submitted',now()-interval '1 day')`,
        [randomUUID(),principal,actor,String(i),hash,ledger,`0x${(i+1).toString(16).padStart(64,'0')}`]);
      const rpc={getTransactionReceipt:async({hash})=>{seen.push(hash);throw Error('not found');}};
      const worker=new Reconciler(database,rpc,2);
      await worker.tick();await worker.tick();
      const observed=new Set(seen);
      for(let i=0;i<101;i++) assert.ok(observed.has(`0x${(i+1).toString(16).padStart(64,'0')}`));
    } finally {await database.query('DELETE FROM pact_operations WHERE principal=$1',[principal]);await database.end();}
  });
