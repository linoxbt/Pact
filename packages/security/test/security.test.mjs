import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { DecryptCommand, GenerateDataKeyCommand } from '@aws-sdk/client-kms';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { AwsSecretProvider, CredentialCipher, EvidenceStore } from '../dist/index.js';

test('managed provider rotates after its short cache expires', async () => {
  let reads = 0;
  const provider = new AwsSecretProvider({ send: async command => {
    assert.ok(command instanceof GetSecretValueCommand);
    return { SecretString: `token-${++reads}` };
  } }, 'github/pact', 0);
  assert.equal(await provider.githubToken(), 'token-1');
  assert.equal(await provider.githubToken(), 'token-2');
});

test('evidence is encrypted, context-bound and detects tampering', async () => {
  const key = randomBytes(32);
  let blob;
  const kms = { send: async command => {
    if (command instanceof GenerateDataKeyCommand) {
      assert.equal(command.input.KeySpec, 'AES_256');
      return { Plaintext: Uint8Array.from(key), CiphertextBlob: Buffer.from('wrapped-key') };
    }
    assert.ok(command instanceof DecryptCommand);
    assert.equal(command.input.EncryptionContext.PactObligationId, '7');
    return { Plaintext: Uint8Array.from(key) };
  } };
  const s3 = { send: async command => {
    if (command instanceof PutObjectCommand) {
      blob = Buffer.from(command.input.Body);
      assert.equal(command.input.ServerSideEncryption, 'aws:kms');
      return {};
    }
    assert.ok(command instanceof GetObjectCommand);
    return { ContentLength: blob.length, Body: { transformToByteArray: async () => blob } };
  } };
  const store = new EvidenceStore(kms, s3, 'key-arn', 'private-bucket');
  const evidence = Buffer.from('private evidence material');
  const record = await store.put({ principal: '0xABC', obligationId: '7',
    contentType: 'text/plain', bytes: evidence });
  assert.equal(blob.includes(evidence), false);
  assert.deepEqual(await store.get(record), evidence);
  const original = Buffer.from(blob);
  blob[blob.length - 1] ^= 1;
  await assert.rejects(() => store.get(record));
  blob = original;
  await assert.rejects(() => store.get({ ...record, obligationId: '8' }));
});

test('tenant credential ciphertext is sealed to principal and provider', async () => {
  const key = randomBytes(32);
  const kms = { send: async command => command instanceof GenerateDataKeyCommand
    ? { Plaintext: Uint8Array.from(key), CiphertextBlob: Buffer.from('wrapped') }
    : { Plaintext: Uint8Array.from(key) } };
  const cipher = new CredentialCipher(kms, 'credential-key');
  const identity = { id: 'credential-1', principal: '0xABCD', provider: 'github' };
  const sealed = await cipher.seal(identity, 'ghp_private_token_value');
  assert.equal(sealed.ciphertext.includes('ghp_private_token_value'), false);
  assert.equal(await cipher.open(identity, sealed), 'ghp_private_token_value');
  await assert.rejects(cipher.open({ ...identity, principal: '0xDCBA' }, sealed));
  const corrupted = Buffer.from(sealed.ciphertext, 'base64');
  corrupted[corrupted.length - 1] ^= 1;
  await assert.rejects(cipher.open(identity, { ...sealed,
    ciphertext: corrupted.toString('base64') }));
});
