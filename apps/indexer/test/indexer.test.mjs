import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase, migrate } from '@pact/operations';
import { PactIndexer } from '../dist/indexer.js';
import { encodeEventTopics, encodeAbiParameters } from 'viem';
import { PactAccountFactoryAbi } from '@pact/abis';

const url = process.env.PACT_TEST_DATABASE_URL;

test('historical catch-up bounds block RPC calls without skipping event validation',{skip:!url},async()=>{
  const database=createDatabase(url);const chainId=1_100_000+Math.floor(Math.random()*100_000);const headers=[];
  const rpc={getBlockNumber:async()=>100000n,getLogs:async()=>[],getBlock:async({blockNumber})=>{
    headers.push(blockNumber);return {number:blockNumber,hash:`0x${blockNumber.toString(16).padStart(64,'0')}`};}};
  try {
    await migrate(database);
    assert.equal(await new PactIndexer(database,rpc,chainId,['0x0000000000000000000000000000000000000001'],4090n,0,100n).tick(),4189n);
    assert.deepEqual(headers,[4096n,4189n]);
  } finally {await database.end();}
});

test('adding a factory replays old creation events and indexes account logs in the same batch', {skip:!url}, async()=>{
  const database=createDatabase(url);
  const chainId=1_000_000+Math.floor(Math.random()*100_000);
  const address=n=>`0x${n.toString(16).padStart(40,'0')}`;
  const hash=n=>`0x${n.toString(16).padStart(64,'0')}`;
  const factory=address(1),account=address(2),principal=address(3);
  const calls=[];
  const created={address:factory,blockNumber:1n,blockHash:hash(1),transactionHash:hash(10),logIndex:0,
    data:'0x',topics:encodeEventTopics({abi:PactAccountFactoryAbi,eventName:'AccountCreated',args:{principal,account}})};
  const accountLog={address:account,blockNumber:1n,blockHash:hash(1),transactionHash:hash(10),logIndex:1,
    data:encodeAbiParameters([{type:'uint256'}],[5n]),topics:[]};
  const rpc={getBlockNumber:async()=>2n,getBlock:async({blockNumber})=>({number:blockNumber,hash:hash(Number(blockNumber))}),
    getLogs:async request=>{calls.push(request);return request.address.includes(factory)?[created]:request.address.includes(account)?[accountLog]:[];}};
  try {
    await migrate(database);
    await new PactIndexer(database,rpc,chainId,[address(9)],0n,0,10n).tick();
    calls.length=0;
    await new PactIndexer(database,rpc,chainId,[address(9)],0n,0,10n,factory).tick();
    assert.equal(calls[0].fromBlock,0n);
    assert.ok(calls.some(call=>call.address.includes(account) && call.fromBlock===0n));
    const rows=(await database.query('SELECT address,principal FROM pact_indexed_accounts WHERE chain_id=$1',[chainId])).rows;
    assert.deepEqual(rows,[{address:account,principal}]);
    assert.equal((await database.query("SELECT count(*)::int n FROM pact_chain_events WHERE chain_id=$1 AND event_name='AccountCreated'",[chainId])).rows[0].n,1);
  } finally {await database.end();}
});

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

test('indexer retains sparse checkpoints and a dense recent reorg window',
  { skip: !url }, async () => {
    const database = createDatabase(url);
    const chainId = 900_000 + Math.floor(Math.random() * 100_000);
    const hash = number => `0x${number.toString(16).padStart(64, '0')}`;
    const rpc = { getBlockNumber: async () => 4399n,
      getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: hash(blockNumber) }),
      getLogs: async () => [] };
    try {
      await migrate(database);
      const indexer = new PactIndexer(database, rpc, chainId,
        ['0x0000000000000000000000000000000000000001'], 4090n, 0, 310n);
      assert.equal(await indexer.tick(), 4399n);
      const rows = await database.query(
        'SELECT block_number FROM pact_indexer_blocks WHERE chain_id=$1 ORDER BY block_number',
        [chainId]);
      assert.equal(rows.rows.length, 257);
      assert.equal(rows.rows[0].block_number, '4096');
      assert.equal(rows.rows[1].block_number, '4144');
      assert.equal(rows.rows.at(-1).block_number, '4399');
    } finally { await database.end(); }
  });
