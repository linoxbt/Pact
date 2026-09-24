import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID,
  timingSafeEqual } from 'node:crypto';
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const version = 1;
const header = Buffer.from('PACT');

export type EvidenceIdentity = Readonly<{ id: string; principal: string; obligationId: string }>;
export type StoredEvidence = EvidenceIdentity & Readonly<{
  digest: string; storageKey: string; encryptedKey: string; contentType: string;
  byteLength: number; kmsKeyId: string; cipherVersion: number;
}>;

const context = (identity: EvidenceIdentity) => ({ PactEvidenceId: identity.id,
  PactPrincipal: identity.principal.toLowerCase(), PactObligationId: identity.obligationId });
const aad = (identity: EvidenceIdentity) => Buffer.from(JSON.stringify(context(identity)));

export class EvidenceStore {
  constructor(readonly kms: Pick<KMSClient, 'send'>, readonly s3: Pick<S3Client, 'send'>,
    readonly kmsKeyId: string, readonly bucket: string) {
    if (!kmsKeyId || !bucket) throw new Error('KMS key and private bucket required');
  }

  async put(input: { principal: string; obligationId: string; contentType: string;
    bytes: Buffer }): Promise<StoredEvidence> {
    if (input.bytes.length === 0 || input.bytes.length > MAX_EVIDENCE_BYTES)
      throw new Error('Evidence size out of bounds');
    if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(input.contentType))
      throw new Error('Invalid evidence content type');
    const identity = { id: randomUUID(), principal: input.principal.toLowerCase(),
      obligationId: input.obligationId };
    const key = await this.kms.send(new GenerateDataKeyCommand({ KeyId: this.kmsKeyId,
      KeySpec: 'AES_256', EncryptionContext: context(identity) }));
    if (!key.Plaintext || key.Plaintext.length !== 32 || !key.CiphertextBlob)
      throw new Error('KMS data key unavailable');
    const rawKey = Buffer.from(key.Plaintext);
    const nonce = randomBytes(12);
    let blob: Buffer;
    try {
      const cipher = createCipheriv('aes-256-gcm', rawKey, nonce);
      cipher.setAAD(aad(identity));
      const ciphertext = Buffer.concat([cipher.update(input.bytes), cipher.final()]);
      blob = Buffer.concat([header, Buffer.from([version]), nonce, cipher.getAuthTag(), ciphertext]);
    } finally { rawKey.fill(0); key.Plaintext.fill(0); }
    const storageKey = `evidence/v1/${identity.id}`;
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: storageKey,
      Body: blob, ContentType: 'application/octet-stream', IfNoneMatch: '*',
      ServerSideEncryption: 'aws:kms', SSEKMSKeyId: this.kmsKeyId }));
    return { ...identity, digest: `sha256:${createHash('sha256').update(input.bytes).digest('hex')}`,
      storageKey, encryptedKey: Buffer.from(key.CiphertextBlob).toString('base64'),
      contentType: input.contentType, byteLength: input.bytes.length,
      kmsKeyId: this.kmsKeyId, cipherVersion: version };
  }

  async get(record: StoredEvidence): Promise<Buffer> {
    if (record.cipherVersion !== version || record.kmsKeyId !== this.kmsKeyId ||
        record.storageKey !== `evidence/v1/${record.id}` ||
        record.byteLength < 1 || record.byteLength > MAX_EVIDENCE_BYTES)
      throw new Error('Unsupported evidence record');
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: record.storageKey }));
    if (!object.Body || object.ContentLength === undefined ||
        object.ContentLength < 33 || object.ContentLength > MAX_EVIDENCE_BYTES + 33)
      throw new Error('Evidence object unavailable or oversized');
    const blob = Buffer.from(await object.Body.transformToByteArray());
    if (blob.length < 33 || blob.length > MAX_EVIDENCE_BYTES + 33 ||
        !blob.subarray(0, 4).equals(header) || blob[4] !== version)
      throw new Error('Invalid evidence object');
    const key = await this.kms.send(new DecryptCommand({ CiphertextBlob: Buffer.from(record.encryptedKey, 'base64'),
      KeyId: this.kmsKeyId, EncryptionContext: context(record) }));
    if (!key.Plaintext || key.Plaintext.length !== 32) throw new Error('KMS data key unavailable');
    const rawKey = Buffer.from(key.Plaintext);
    let plain: Buffer;
    try {
      const decipher = createDecipheriv('aes-256-gcm', rawKey, blob.subarray(5, 17));
      decipher.setAAD(aad(record));
      decipher.setAuthTag(blob.subarray(17, 33));
      plain = Buffer.concat([decipher.update(blob.subarray(33)), decipher.final()]);
    } finally { rawKey.fill(0); key.Plaintext.fill(0); }
    const digest = Buffer.from(createHash('sha256').update(plain).digest('hex'), 'hex');
    const expected = Buffer.from(record.digest.slice(7), 'hex');
    if (plain.length !== record.byteLength || expected.length !== 32 ||
        !timingSafeEqual(digest, expected)) throw new Error('Evidence digest mismatch');
    return plain;
  }

  async removeOrphan(storageKey: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
  }
}
