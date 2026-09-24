import { randomUUID } from 'node:crypto';
import { isHex, type Address, type Hex } from 'viem';
import type { Database } from './db.js';

export type OperationState = 'prepared' | 'submitted' | 'confirmed' | 'reverted' | 'recoverable';
export type Operation = Readonly<{
  id: string; principal: Address; actor: Address; kind: string; idempotencyKey: string;
  actionHash: Hex; targetAddress: Address; expectedEvent: string; grantId: bigint | null;
  reservationId: bigint | null;
  txHash: Hex | null; state: OperationState; errorCode: string | null;
}>;
type OperationRow = { id: string; principal: Address; actor: Address; kind: string;
  idempotency_key: string; action_hash: Hex; target_address: Address; expected_event: string;
  grant_id: string | null; reservation_id: string | null;
  tx_hash: Hex | null; state: OperationState; error_code: string | null };
const fromRow = (row: OperationRow): Operation => ({ id: row.id, principal: row.principal, actor: row.actor,
  kind: row.kind, idempotencyKey: row.idempotency_key, actionHash: row.action_hash,
  targetAddress: row.target_address, expectedEvent: row.expected_event,
  grantId: row.grant_id === null ? null : BigInt(row.grant_id),
  reservationId: row.reservation_id === null ? null : BigInt(row.reservation_id),
  txHash: row.tx_hash, state: row.state, errorCode: row.error_code });

export class OperationStore {
  constructor(readonly database: Database) {}

  async prepare(input: { principal: Address; actor: Address; kind: string;
    idempotencyKey: string; actionHash: Hex; targetAddress: Address;
    expectedEvent: string; grantId?: bigint; reservationId?: bigint }): Promise<Operation> {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey))
      throw new Error('Invalid idempotency key');
    if (!isHex(input.actionHash) || input.actionHash.length !== 66) throw new Error('Invalid action hash');
    const result = await this.database.query<OperationRow>(
      `INSERT INTO pact_operations
       (id,principal,actor,kind,idempotency_key,action_hash,target_address,expected_event,grant_id,reservation_id,state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'prepared')
       ON CONFLICT (principal,kind,idempotency_key) DO UPDATE SET updated_at=pact_operations.updated_at
       RETURNING *`,
      [randomUUID(), input.principal.toLowerCase(), input.actor.toLowerCase(), input.kind,
        input.idempotencyKey, input.actionHash, input.targetAddress.toLowerCase(),
        input.expectedEvent, input.grantId?.toString() ?? null,
        input.reservationId?.toString() ?? null]);
    const row = result.rows[0]!;
    if (row.action_hash.toLowerCase() !== input.actionHash.toLowerCase() ||
        row.target_address.toLowerCase() !== input.targetAddress.toLowerCase() ||
        row.expected_event !== input.expectedEvent ||
        row.actor.toLowerCase() !== input.actor.toLowerCase() ||
        row.grant_id !== (input.grantId?.toString() ?? null) ||
        row.reservation_id !== (input.reservationId?.toString() ?? null))
      throw new Error('Idempotency key already binds another action');
    return fromRow(row);
  }

  async markSubmitted(id: string, principal: Address, txHash: Hex): Promise<Operation> {
    if (!isHex(txHash) || txHash.length !== 66) throw new Error('Invalid transaction hash');
    const result = await this.database.query<OperationRow>(
      `UPDATE pact_operations SET tx_hash=$3,state='submitted',submitted_at=coalesce(submitted_at,now()),
       updated_at=now() WHERE id=$1 AND principal=$2 AND state IN ('prepared','recoverable') RETURNING *`,
      [id, principal.toLowerCase(), txHash]);
    if (result.rows[0]) return fromRow(result.rows[0]);
    const current = await this.get(id, principal);
    if (current?.txHash?.toLowerCase() === txHash.toLowerCase()) return current;
    throw new Error('Operation state or transaction hash conflict');
  }

  async get(id: string, principal: Address): Promise<Operation | null> {
    const result = await this.database.query<OperationRow>(
      'SELECT * FROM pact_operations WHERE id=$1 AND principal=$2', [id, principal.toLowerCase()]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }
}
