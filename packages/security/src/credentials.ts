import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from '@aws-sdk/client-kms';

export type CredentialIdentity = Readonly<{ id: string; principal: string; provider: string }>;
export type SealedCredential = Readonly<{ ciphertext: string; encryptedKey: string; kmsKeyId: string;
  version: number }>;
const maxBytes = 16 * 1024;
const version = 1;
const context = (identity: CredentialIdentity) => ({ PactCredentialId: identity.id,
  PactPrincipal: identity.principal.toLowerCase(), PactProvider: identity.provider });
const aad = (identity: CredentialIdentity) => Buffer.from(JSON.stringify(context(identity)));

/** Envelope encryption for tenant-provided API credentials. Plaintext is never persisted. */
export class CredentialCipher {
  constructor(readonly kms: Pick<KMSClient, 'send'>, readonly kmsKeyId: string) {
    if (!kmsKeyId) throw new Error('Credential KMS key required');
  }

  async seal(identity: CredentialIdentity, secret: string): Promise<SealedCredential> {
    const plain = Buffer.from(secret, 'utf8');
    if (plain.length < 8 || plain.length > maxBytes) throw new Error('Invalid credential length');
    const dataKey = await this.kms.send(new GenerateDataKeyCommand({ KeyId: this.kmsKeyId,
      KeySpec: 'AES_256', EncryptionContext: context(identity) }));
    if (!dataKey.Plaintext || dataKey.Plaintext.length !== 32 || !dataKey.CiphertextBlob)
      throw new Error('KMS data key unavailable');
    const key = Buffer.from(dataKey.Plaintext);
    const nonce = randomBytes(12);
    try {
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(aad(identity));
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      return { ciphertext: Buffer.concat([Buffer.from([version]), nonce, cipher.getAuthTag(),
        encrypted]).toString('base64'), encryptedKey: Buffer.from(dataKey.CiphertextBlob).toString('base64'),
        kmsKeyId: this.kmsKeyId, version };
    } finally { key.fill(0); dataKey.Plaintext.fill(0); plain.fill(0); }
  }

  async open(identity: CredentialIdentity, record: SealedCredential): Promise<string> {
    if (record.version !== version || record.kmsKeyId !== this.kmsKeyId)
      throw new Error('Unsupported credential record');
    const blob = Buffer.from(record.ciphertext, 'base64');
    if (blob.length < 30 || blob.length > maxBytes + 29 || blob[0] !== version)
      throw new Error('Invalid credential object');
    const dataKey = await this.kms.send(new DecryptCommand({ KeyId: this.kmsKeyId,
      CiphertextBlob: Buffer.from(record.encryptedKey, 'base64'), EncryptionContext: context(identity) }));
    if (!dataKey.Plaintext || dataKey.Plaintext.length !== 32) throw new Error('KMS data key unavailable');
    const key = Buffer.from(dataKey.Plaintext);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(1, 13));
      decipher.setAAD(aad(identity));
      decipher.setAuthTag(blob.subarray(13, 29));
      const plain = Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]);
      try { return plain.toString('utf8'); } finally { plain.fill(0); }
    } finally { key.fill(0); dataKey.Plaintext.fill(0); }
  }
}
