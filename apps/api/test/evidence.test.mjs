import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../dist/server.js';

const principal = '0x0000000000000000000000000000000000000001';
const agent = '0x0000000000000000000000000000000000000002';
const address = '0x0000000000000000000000000000000000000003';
const id = '04cf8d9f-6416-4188-a6de-0d8137abe062';
const record = { id, principal, obligationId: '7', digest: `sha256:${'ab'.repeat(32)}`,
  storageKey: `evidence/v1/${id}`, encryptedKey: 'wrapped', contentType: 'text/plain',
  byteLength: 7, kmsKeyId: 'key-arn', cipherVersion: 1 };

test('evidence upload and read enforce obligation scope', async () => {
  let stored = false;
  let currentGrant = 1n;
  const ctx = {
    allowedOrigin: 'http://localhost:5173',
    database: { query: async sql => {
      if (sql.startsWith('INSERT INTO pact_evidence')) { stored = true; return { rows: [] }; }
      if (sql.startsWith('SELECT * FROM pact_evidence')) return { rows: [{
        id, principal, obligation_id: '7', digest: record.digest, storage_key: record.storageKey,
        encrypted_key: record.encryptedKey, content_type: 'text/plain', byte_length: 7,
        kms_key_id: 'key-arn', cipher_version: 1 }] };
      return { rows: [] };
    } },
    rpc: { readContract: async () => [currentGrant] },
    pact: { addresses: { manager: address }, grant: async () => ({ principal }) },
    auth: { authenticate: async () => ({ kind: 'agent', principal, address: agent, grantId: 1n }) },
    operations: {}, evidence: { put: async input => {
      assert.deepEqual(input.bytes, Buffer.from('private'));
      return record;
    }, get: async () => Buffer.from('private') },
  };
  const app = await createApi(ctx);
  try {
    const upload = await app.inject({ method: 'POST', url: '/v1/evidence/7',
      headers: { authorization: 'Bearer fake', 'content-type': 'application/octet-stream',
        'x-pact-evidence-type': 'text/plain' }, payload: Buffer.from('private') });
    assert.equal(upload.statusCode, 200);
    assert.equal(upload.json().evidenceHash, `0x${'ab'.repeat(32)}`);
    assert.equal(stored, true);
    const download = await app.inject({ method: 'GET', url: `/v1/evidence/${id}`,
      headers: { authorization: 'Bearer fake' } });
    assert.equal(download.statusCode, 200);
    assert.equal(download.body, 'private');
    currentGrant = 2n;
    const denied = await app.inject({ method: 'GET', url: `/v1/evidence/${id}`,
      headers: { authorization: 'Bearer fake' } });
    assert.equal(denied.statusCode, 403);
  } finally { await app.close(); }
});
