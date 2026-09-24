import type { FastifyInstance } from 'fastify';
import { ObligationManagerAbi } from '@pact/abis';
import { AuthError, type Session } from '@pact/operations';
import { MAX_EVIDENCE_BYTES, type StoredEvidence } from '@pact/security';
import type { ApiContext } from './server.js';
import { id } from './validation.js';

type EvidenceRow = { id: string; principal: string; obligation_id: string;
  digest: string; storage_key: string; encrypted_key: string;
  content_type: string; byte_length: number; kms_key_id: string; cipher_version: number };
const contentTypes = new Set(['application/pdf', 'application/json', 'image/png', 'image/jpeg', 'text/plain']);
const fail = (code: string, status = 403): never => { throw new AuthError(code, status); };

export function registerEvidenceRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer',
    bodyLimit: MAX_EVIDENCE_BYTES }, (_request, body, done) => done(null, body));
  const authorize = async (session: Session, obligationId: bigint) => {
    const obligation = await ctx.rpc.readContract({ address: ctx.pact.addresses.manager,
      abi: ObligationManagerAbi, functionName: 'obligations', args: [obligationId] });
    const grantId = obligation[0];
    if (grantId === 0n) fail('OBLIGATION_NOT_FOUND', 404);
    const grant = await ctx.pact.grant(grantId);
    if (grant.principal.toLowerCase() !== session.principal.toLowerCase() ||
        (session.kind === 'agent' && session.grantId !== grantId)) fail('EVIDENCE_SCOPE_DENIED');
    return grantId;
  };

  app.post('/v1/evidence/:obligationId', { bodyLimit: MAX_EVIDENCE_BYTES }, async request => {
    const evidence = ctx.evidence;
    if (!evidence) throw new AuthError('EVIDENCE_STORE_UNAVAILABLE', 503);
    const obligationId = id.parse((request.params as { obligationId: string }).obligationId);
    const session = await ctx.auth.authenticate(request.headers.authorization, 'evidence.write');
    await authorize(session, obligationId);
    const contentType = request.headers['x-pact-evidence-type'];
    if (typeof contentType !== 'string' || !contentTypes.has(contentType))
      throw new AuthError('INVALID_EVIDENCE_TYPE', 400);
    const bytes = request.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0)
      throw new AuthError('INVALID_EVIDENCE_BODY', 400);
    const stored = await evidence.put({ principal: session.principal,
      obligationId: obligationId.toString(), contentType, bytes });
    try {
      await ctx.database.query(
        `INSERT INTO pact_evidence
         (id,principal,obligation_id,digest,storage_key,content_type,byte_length,
          encrypted_key,kms_key_id,cipher_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [stored.id, stored.principal, stored.obligationId, stored.digest, stored.storageKey,
          stored.contentType, stored.byteLength, stored.encryptedKey, stored.kmsKeyId, stored.cipherVersion]);
    } catch (cause) {
      try { await evidence.removeOrphan(stored.storageKey); }
      catch (cleanup) { app.log.error({ cleanup, evidenceId: stored.id }, 'orphan evidence cleanup failed'); }
      throw cause;
    }
    return { id: stored.id, digest: stored.digest, evidenceHash: `0x${stored.digest.slice(7)}`,
      byteLength: stored.byteLength, contentType: stored.contentType,
      trust: 'encrypted_object_hash_only' };
  });

  app.get('/v1/evidence/:id', async (request, reply) => {
    const evidence = ctx.evidence;
    if (!evidence) throw new AuthError('EVIDENCE_STORE_UNAVAILABLE', 503);
    const evidenceId = (request.params as { id: string }).id;
    if (!/^[0-9a-f-]{36}$/i.test(evidenceId)) fail('INVALID_EVIDENCE_ID', 400);
    const session = await ctx.auth.authenticate(request.headers.authorization, 'read');
    const result = await ctx.database.query<EvidenceRow>(
      'SELECT * FROM pact_evidence WHERE id=$1', [evidenceId]);
    const row = result.rows[0];
    if (!row || row.principal.toLowerCase() !== session.principal.toLowerCase())
      throw new AuthError('EVIDENCE_NOT_FOUND', 404);
    await authorize(session, BigInt(row.obligation_id));
    const record: StoredEvidence = { id: row.id, principal: row.principal,
      obligationId: row.obligation_id, digest: row.digest, storageKey: row.storage_key,
      encryptedKey: row.encrypted_key, contentType: row.content_type,
      byteLength: row.byte_length, kmsKeyId: row.kms_key_id, cipherVersion: row.cipher_version };
    const bytes = await evidence.get(record);
    await ctx.database.query(
      `INSERT INTO pact_audit_events (principal,actor,action,ref_hash,details)
       VALUES ($1,$2,'evidence.read',$3,$4)`,
      [session.principal.toLowerCase(), session.address.toLowerCase(), row.digest,
        JSON.stringify({ evidenceId: row.id, obligationId: row.obligation_id })]);
    return reply.header('Cache-Control', 'no-store').header('Content-Disposition',
      `attachment; filename="pact-evidence-${row.id}"`).header('X-Pact-Evidence-Digest', row.digest)
      .type('application/octet-stream').send(bytes);
  });
}
