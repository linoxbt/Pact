import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { CredentialIdentity, SealedCredential } from './credentials.js';

/** Development/staging envelope encryption using a deployment-managed 256-bit secret. */
export class DeploymentSecretCipher {
  private readonly master: Buffer;
  readonly keyId: string;
  constructor(hexKey: string, keyId = 'deployment-secret-v1') {
    if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) throw new Error('PACT_VAULT_MASTER_KEY must be 32 random bytes in hex');
    this.master = Buffer.from(hexKey, 'hex');
    this.keyId = keyId;
  }
  private aad(identity: CredentialIdentity) {
    return Buffer.from(JSON.stringify({ id: identity.id, principal: identity.principal.toLowerCase(),
      provider: identity.provider }));
  }
  async seal(identity: CredentialIdentity, secret: string): Promise<SealedCredential> {
    const plain = Buffer.from(secret, 'utf8');
    if (plain.length < 8 || plain.length > 16_384) throw new Error('Invalid credential length');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.master, nonce);
    cipher.setAAD(this.aad(identity));
    try {
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      return { ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64'),
        encryptedKey: '', kmsKeyId: this.keyId, version: 1 };
    } finally { plain.fill(0); }
  }
  async open(identity: CredentialIdentity, record: SealedCredential): Promise<string> {
    if (record.kmsKeyId !== this.keyId || record.version !== 1 || record.encryptedKey !== '')
      throw new Error('Unsupported deployment secret record');
    const blob = Buffer.from(record.ciphertext, 'base64');
    if (blob.length < 29 || blob.length > 16_412) throw new Error('Invalid secret record');
    const cipher = createDecipheriv('aes-256-gcm', this.master, blob.subarray(0,12));
    cipher.setAAD(this.aad(identity));
    cipher.setAuthTag(blob.subarray(12,28));
    const plain = Buffer.concat([cipher.update(blob.subarray(28)), cipher.final()]);
    try { return plain.toString('utf8'); } finally { plain.fill(0); }
  }
}
