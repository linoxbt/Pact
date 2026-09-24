import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashTransferIntent } from '@pact/schemas';
import { AuthError, jsonSafe } from '@pact/operations';
import type { ApiContext } from './server.js';
import { bytes32, hex, id, transferIntent } from './validation.js';

const requestBody = z.object({ intent: transferIntent, reservationId: id }).strict();
type ApprovalRow = { id: string; principal: string; agent: string; grant_id: string;
  reservation_id: string; intent_hash: string; intent: Record<string, string>;
  state: string; signature: string | null; expires_at: Date };
const deny = (code: string, status = 403): never => { throw new AuthError(code, status); };

export function registerApprovalRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const get = async (requestId: string): Promise<ApprovalRow> => {
    if (!z.uuid().safeParse(requestId).success) deny('INVALID_APPROVAL_ID', 400);
    await ctx.database.query(
      `UPDATE pact_approval_requests SET state='expired',updated_at=now()
       WHERE id=$1 AND state IN ('pending','approved') AND expires_at<=now()`, [requestId]);
    const result = await ctx.database.query<ApprovalRow>(
      'SELECT * FROM pact_approval_requests WHERE id=$1', [requestId]);
    if (!result.rows[0]) deny('APPROVAL_NOT_FOUND', 404);
    return result.rows[0]!;
  };
  const scoped = async (requestId: string, header: string | undefined) => {
    const session = await ctx.auth.authenticate(header, 'read');
    const record = await get(requestId);
    if (record.principal.toLowerCase() !== session.principal.toLowerCase() ||
        (session.kind === 'agent' &&
          (record.agent.toLowerCase() !== session.address.toLowerCase() ||
           record.grant_id !== session.grantId?.toString()))) deny('APPROVAL_SCOPE_DENIED');
    return { session, record };
  };

  app.post('/v1/approvals/requests', async request => {
    const input = requestBody.parse(request.body);
    const session = await ctx.auth.authenticate(request.headers.authorization, 'approval.request');
    if (session.kind !== 'agent' || session.grantId !== input.intent.grantId ||
        session.address.toLowerCase() !== input.intent.agent.toLowerCase()) deny('AGENT_SCOPE_DENIED');
    const grant = await ctx.pact.grant(input.intent.grantId);
    if (grant.principal.toLowerCase() !== session.principal.toLowerCase()) deny('GRANT_SCOPE_DENIED');
    const proof = await ctx.pact.verifyTransfer(input.intent, input.reservationId);
    if (proof.reason !== 'APPROVAL_REQUIRED') deny(proof.reason === 'OK' ? 'APPROVAL_NOT_REQUIRED' : proof.reason);
    const hash = hashTransferIntent(await ctx.rpc.getChainId(), ctx.pact.addresses.account, input.intent);
    const intent = jsonSafe(input.intent);
    const result = await ctx.database.query<ApprovalRow>(
      `INSERT INTO pact_approval_requests
       (id,principal,agent,grant_id,reservation_id,intent_hash,intent,state,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',to_timestamp($8::double precision))
       ON CONFLICT (grant_id,reservation_id,intent_hash) DO UPDATE
       SET updated_at=pact_approval_requests.updated_at RETURNING *`,
      [randomUUID(), session.principal.toLowerCase(), session.address.toLowerCase(),
        input.intent.grantId.toString(), input.reservationId.toString(), hash,
        JSON.stringify(intent), input.intent.deadline.toString()]);
    const row = result.rows[0]!;
    if (row.principal.toLowerCase() !== session.principal.toLowerCase() ||
        row.agent.toLowerCase() !== session.address.toLowerCase()) deny('APPROVAL_CONFLICT', 409);
    return jsonSafe(row);
  });

  app.get('/v1/approvals', async request => {
    const session = await ctx.auth.authenticate(request.headers.authorization, 'read');
    await ctx.database.query(
      `UPDATE pact_approval_requests SET state='expired',updated_at=now()
       WHERE principal=$1 AND state IN ('pending','approved') AND expires_at<=now()`, [session.principal.toLowerCase()]);
    const result = await ctx.database.query<ApprovalRow>(
      `SELECT * FROM pact_approval_requests WHERE principal=$1
       AND ($2::text='principal' OR (agent=$3 AND grant_id=$4))
       ORDER BY created_at DESC LIMIT 100`,
      [session.principal.toLowerCase(), session.kind, session.address.toLowerCase(),
        session.grantId?.toString() ?? null]);
    return { approvals: jsonSafe(result.rows) };
  });
  app.get('/v1/approvals/:id', async request => {
    const { record } = await scoped((request.params as { id: string }).id, request.headers.authorization);
    return jsonSafe(record);
  });
  app.post('/v1/approvals/:id/approve', async request => {
    const { session, record } = await scoped(
      (request.params as { id: string }).id, request.headers.authorization);
    if (session.kind !== 'principal') deny('PRINCIPAL_ONLY');
    if (record.state !== 'pending') deny('APPROVAL_NOT_PENDING', 409);
    const input = z.object({ signature: hex }).strict().parse(request.body);
    const intent = transferIntent.parse(record.intent);
    const grant = await ctx.pact.grant(intent.grantId);
    if (!grant.active || grant.principal.toLowerCase() !== session.principal.toLowerCase())
      deny('GRANT_INACTIVE');
    const proof = await ctx.pact.verifyTransfer(intent, BigInt(record.reservation_id));
    if (proof.reason !== 'APPROVAL_REQUIRED') deny(proof.reason);
    const payload = await ctx.pact.transferApprovalPayload(intent, BigInt(record.reservation_id));
    if (!await ctx.rpc.verifyTypedData({ address: grant.principal, signature: input.signature, ...payload }))
      deny('INVALID_APPROVAL_SIGNATURE');
    const result = await ctx.database.query<ApprovalRow>(
      `UPDATE pact_approval_requests SET state='approved',signature=$2,decided_at=now(),updated_at=now()
       WHERE id=$1 AND state='pending' AND expires_at>now() RETURNING *`,
      [record.id, input.signature]);
    if (!result.rows[0]) deny('APPROVAL_NOT_PENDING', 409);
    return jsonSafe(result.rows[0]);
  });
  app.post('/v1/approvals/:id/reject', async request => {
    const { session, record } = await scoped(
      (request.params as { id: string }).id, request.headers.authorization);
    if (session.kind !== 'principal') deny('PRINCIPAL_ONLY');
    if (request.body && Object.keys(request.body as object).length > 0) deny('INVALID_INPUT', 400);
    const result = await ctx.database.query<ApprovalRow>(
      `UPDATE pact_approval_requests SET state='rejected',decided_at=now(),updated_at=now()
       WHERE id=$1 AND state='pending' AND expires_at>now() RETURNING *`, [record.id]);
    if (!result.rows[0]) deny('APPROVAL_NOT_PENDING', 409);
    return jsonSafe(result.rows[0]);
  });
}
