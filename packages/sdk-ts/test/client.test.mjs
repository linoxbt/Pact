import assert from 'node:assert/strict';
import test from 'node:test';
import { PactClient } from '../dist/index.js';

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
