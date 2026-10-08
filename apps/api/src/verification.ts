import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AuthError, enforceRequestLimit } from '@pact/operations';
import { z } from 'zod';
import type { ApiContext } from './server.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function registerVerificationRoutes(app: FastifyInstance, ctx: ApiContext) {
  app.post('/v2/verification/probes', async request => {
    const owner = await ctx.ownerAuth!.authenticate(request.headers.authorization);
    await enforceRequestLimit(ctx.database, `verification:${owner.id}`, 3);
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    await ctx.database.query(`INSERT INTO pact_verification_probes(id,owner_id,secret_hash)
      VALUES($1,$2,$3)`, [id, owner.id, digest(secret)]);
    return { id, secret, path: `/v2/verification/upstream/${id}`, expiresInSeconds: 1800 };
  });
  app.get('/v2/verification/probes/:id', async request => {
    const owner = await ctx.ownerAuth!.authenticate(request.headers.authorization);
    const id = z.uuid().parse((request.params as {id:string}).id);
    const result = await ctx.database.query(`SELECT id,requests,authenticated_requests,expires_at
      FROM pact_verification_probes WHERE id=$1 AND owner_id=$2`, [id, owner.id]);
    if (!result.rows[0]) throw new AuthError('NOT_FOUND', 404);
    return result.rows[0];
  });
  app.delete('/v2/verification/probes/:id', async request => {
    const owner = await ctx.ownerAuth!.authenticate(request.headers.authorization);
    const id = z.uuid().parse((request.params as {id:string}).id);
    await ctx.database.query(`UPDATE pact_verification_probes SET expires_at=now()
      WHERE id=$1 AND owner_id=$2`, [id, owner.id]);
    return { status: 'expired' };
  });
  app.all('/v2/verification/upstream/:id/:operation', async (request, reply) => {
    const id = z.uuid().parse((request.params as {id:string}).id);
    const supplied = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const row = await ctx.database.query<{authenticated:boolean}>(`
      UPDATE pact_verification_probes SET requests=requests+1,
      authenticated_requests=authenticated_requests+CASE WHEN secret_hash=$2 THEN 1 ELSE 0 END
      WHERE id=$1 AND expires_at>now() RETURNING secret_hash=$2 AS authenticated`, [id, digest(supplied)]);
    if (!row.rows[0]) throw new AuthError('PROBE_EXPIRED', 404);
    if (!row.rows[0].authenticated) throw new AuthError('PROBE_SECRET_REQUIRED', 401);
    // Deliberately includes a sensitive field to verify the gateway's disclosure allowlist.
    return reply.send({ ok: true, method: request.method, privateMarker: 'must-not-reach-agent' });
  });
}
