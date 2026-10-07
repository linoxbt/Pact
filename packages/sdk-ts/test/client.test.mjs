import assert from 'node:assert/strict';
import test from 'node:test';
import { PactClient, PactHttpClient } from '../dist/index.js';

const addresses = {
  registry: '0x0000000000000000000000000000000000000001',
  ledger: '0x0000000000000000000000000000000000000002',
  account: '0x0000000000000000000000000000000000000003',
  manager: '0x0000000000000000000000000000000000000004',
  receipts: '0x0000000000000000000000000000000000000005',
};
const intent = { grantId: 1n, agent: addresses.account, token: addresses.manager,
  to: addresses.receipts, amount: 100n, nonce: 3n, deadline: 2000n,
  policyHash: `0x${'11'.repeat(32)}` };

test('SDK prepares exact reserve and execute calls without holding a signer', async () => {
  const sdk = new PactClient({ getChainId: async () => 143 }, addresses);
  const reserve = await sdk.prepareReserveTransfer(intent, 1500n);
  assert.equal(reserve.address, addresses.ledger);
  assert.equal(reserve.functionName, 'reserve');
  assert.deepEqual(reserve.args.slice(0, 1), [1n]);
  assert.equal(reserve.args[2], 100n);
  const execute = sdk.prepareExecuteTransfer(intent, 7n);
  assert.equal(execute.address, addresses.account);
  assert.equal(execute.args[1], 7n);
  assert.equal(execute.args[2], '0x');
});

test('HTTP SDK serializes bigint transfer intents as decimal strings', async () => {
  const sdk = new PactHttpClient('https://pact.example', 'agent-token', async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.grantId, '1');
    assert.equal(body.amount, '100');
    assert.equal(body.nonce, '3');
    return new Response(JSON.stringify({ decision: 'ALLOW' }));
  });
  assert.deepEqual(await sdk.quoteTransfer(intent), { decision: 'ALLOW' });
});

test('execution simulation pins the block, account, sender, reservation and approval',async()=>{
  let seen;
  const sdk=new PactClient({getBlockNumber:async()=>99n,simulateContract:async call=>{seen=call;}},addresses);
  const result=await sdk.simulateExecuteTransfer(intent,7n,'0x1234');
  assert.equal(result.blockNumber,99n);
  assert.equal(seen.address,addresses.account);assert.equal(seen.account,intent.agent);
  assert.equal(seen.blockNumber,99n);assert.deepEqual(seen.args,[intent,7n,'0x1234']);
});
