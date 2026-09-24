import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase, migrate } from '@pact/operations';
import { PactIndexer } from '../dist/indexer.js';

const url = process.env.PACT_TEST_DATABASE_URL;

test('indexer rolls back orphaned blocks and rebuilds the canonical cursor', { skip: !url }, async () => {
  const database = createDatabase(url);
  const chainId = 800_000 + Math.floor(Math.random() * 100_000);
  const hashes = new Map([0n, 1n, 2n, 3n].map(number => [number, `0x${(Number(number) + 1).toString(16).padStart(64, '0')}`]));
  const rpc = { getBlockNumber: async () => 3n,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: hashes.get(blockNumber) }),
    getLogs: async () => [] };
  try {
    await migrate(database);
    const indexer = new PactIndexer(database, rpc, chainId,
      ['0x0000000000000000000000000000000000000001'], 0n, 0, 10n);
    assert.equal(await indexer.tick(), 3n);
    hashes.set(2n, `0x${'a2'.repeat(32)}`);
    hashes.set(3n, `0x${'a3'.repeat(32)}`);
    assert.equal(await indexer.tick(), 3n);
    const cursor = await database.query('SELECT block_number,block_hash FROM pact_indexer_cursor WHERE chain_id=$1', [chainId]);
    assert.equal(cursor.rows[0].block_number, '3');
    assert.equal(cursor.rows[0].block_hash, hashes.get(3n));
    const blocks = await database.query('SELECT block_number,block_hash FROM pact_indexer_blocks WHERE chain_id=$1 ORDER BY block_number', [chainId]);
    assert.equal(blocks.rows.length, 4);
    assert.equal(blocks.rows[2].block_hash, hashes.get(2n));
  } finally { await database.end(); }
});
