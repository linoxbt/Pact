import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isAddress, isHex, type Address, type Hex, type PublicClient } from 'viem';
import type { PactClient } from '@pact/sdk-ts';
import type { CoreConfig } from './config.js';
import type { Database } from './db.js';

export class AuthError extends Error {
  constructor(message: string, readonly statusCode = 401) { super(message); }
}

export type Session = Readonly<{
  address: Address;
  principal: Address;
  grantId: bigint | null;
  kind: 'principal' | 'agent';
  credential?: 'wallet' | 'key';
  scopes?: readonly string[];
}>;

type ChallengeRow = { address: string; grant_id: string | null; message: string; expires_at: Date;
  consumed_at: Date | null };
type SessionRow = { address: string; principal: string; grant_id: string | null; kind: Session['kind'];
  expires_at: Date; revoked_at: Date | null };
type KeyRow = { operational_address: string; principal: string; grant_id: string;
  scopes: string[]; expires_at: Date; revoked_at: Date | null; status: string };

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export class AuthService {
  constructor(readonly database: Database, readonly rpc: PublicClient,
    readonly pact: PactClient, readonly config: CoreConfig) {}

  async challenge(address: string, grantId?: bigint) {
    if (!isAddress(address)) throw new AuthError('Invalid address', 400);
    if (grantId !== undefined && grantId <= 0n) throw new AuthError('Invalid grant', 400);
    const nonce = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const message = [
      'Sign in to Pact', `Domain: ${this.config.authDomain}`,
      `Chain ID: ${this.config.chainId}`, `Address: ${address.toLowerCase()}`,
      `Grant ID: ${grantId?.toString() ?? 'principal'}`, `Nonce: ${nonce}`,
      `Expires: ${expiresAt.toISOString()}`,
    ].join('\n');
    await this.database.query(
      'INSERT INTO pact_challenges (nonce,address,grant_id,message,expires_at) VALUES ($1,$2,$3,$4,$5)',
      [nonce, address.toLowerCase(), grantId?.toString() ?? null, message, expiresAt]);
    return { nonce, message, expiresAt: expiresAt.toISOString() };
  }

  async session(nonce: string, signature: string) {
    if (!isHex(signature)) throw new AuthError('Invalid signature', 400);
    const result = await this.database.query<ChallengeRow>(
      'SELECT address,grant_id,message,expires_at,consumed_at FROM pact_challenges WHERE nonce=$1', [nonce]);
    const challenge = result.rows[0];
    if (!challenge || challenge.consumed_at || challenge.expires_at.getTime() <= Date.now())
      throw new AuthError('Challenge expired or used');
    const address = challenge.address as Address;
    const verified = await this.rpc.verifyMessage({ address, message: challenge.message, signature: signature as Hex });
    if (!verified) throw new AuthError('Signature did not match challenge');
    let principal = address;
    let grantId: bigint | null = null;
    let kind: Session['kind'] = 'principal';
    if (challenge.grant_id !== null) {
      grantId = BigInt(challenge.grant_id);
      const grant = await this.pact.grant(grantId);
      if (!grant.active || grant.agent.toLowerCase() !== address.toLowerCase())
        throw new AuthError('Agent grant is inactive or mismatched');
      principal = grant.principal;
      kind = 'agent';
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.sessionTtlSeconds * 1000);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const consumed = await client.query(
        'UPDATE pact_challenges SET consumed_at=now() WHERE nonce=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING nonce',
        [nonce]);
      if (consumed.rowCount !== 1) throw new AuthError('Challenge already used');
      await client.query(
        'INSERT INTO pact_sessions (token_hash,address,principal,grant_id,kind,expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [hashToken(token), address.toLowerCase(), principal.toLowerCase(), grantId?.toString() ?? null,
          kind, expiresAt]);
      await client.query('COMMIT');
    } catch (cause) { await client.query('ROLLBACK'); throw cause; }
    finally { client.release(); }
    return { token, kind, principal, grantId: grantId?.toString() ?? null, expiresAt: expiresAt.toISOString() };
  }

  async authenticate(header: string | undefined, requiredScope?: string): Promise<Session> {
    if (!header?.startsWith('Bearer ')) throw new AuthError('Bearer token required');
    const token = header.slice(7);
    if (token.startsWith('pk_')) {
      if (!/^pk_[A-Za-z0-9_-]{43}$/.test(token)) throw new AuthError('Invalid agent key');
      if (!requiredScope) throw new AuthError('AGENT_KEY_SCOPE_REQUIRED', 403);
      const result = await this.database.query<KeyRow>(
        `SELECT a.operational_address,k.principal,k.grant_id,k.scopes,k.expires_at,k.revoked_at,a.status
         FROM pact_agent_keys k JOIN pact_agents a ON a.id=k.agent_id
         WHERE k.token_hash=$1`, [hashToken(token)]);
      const row = result.rows[0];
      if (!row || row.revoked_at || row.expires_at.getTime() <= Date.now() || row.status !== 'active')
        throw new AuthError('Agent key expired or revoked');
      if (!row.scopes.includes(requiredScope)) throw new AuthError('AGENT_KEY_SCOPE_DENIED', 403);
      const grantId = BigInt(row.grant_id);
      const grant = await this.pact.grant(grantId);
      if (!grant.active || grant.agent.toLowerCase() !== row.operational_address ||
          grant.principal.toLowerCase() !== row.principal) throw new AuthError('Agent authority changed');
      await this.database.query('UPDATE pact_agent_keys SET last_used_at=now() WHERE token_hash=$1',
        [hashToken(token)]);
      return { address: row.operational_address as Address, principal: row.principal as Address,
        grantId, kind: 'agent', credential: 'key', scopes: row.scopes };
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AuthError('Invalid bearer token');
    const result = await this.database.query<SessionRow>(
      'SELECT address,principal,grant_id,kind,expires_at,revoked_at FROM pact_sessions WHERE token_hash=$1',
      [hashToken(token)]);
    const row = result.rows[0];
    if (!row || row.revoked_at || row.expires_at.getTime() <= Date.now())
      throw new AuthError('Session expired or revoked');
    const grantId = row.grant_id === null ? null : BigInt(row.grant_id);
    if (row.kind === 'agent') {
      if (grantId === null) throw new AuthError('Invalid agent session');
      const grant = await this.pact.grant(grantId);
      if (!grant.active || grant.agent.toLowerCase() !== row.address ||
          grant.principal.toLowerCase() !== row.principal) throw new AuthError('Agent authority changed');
    }
    return { address: row.address as Address, principal: row.principal as Address, grantId,
      kind: row.kind, credential: 'wallet' };
  }

  async revoke(header: string | undefined): Promise<void> {
    if (!header?.startsWith('Bearer ')) throw new AuthError('Bearer token required');
    await this.database.query('UPDATE pact_sessions SET revoked_at=now() WHERE token_hash=$1',
      [hashToken(header.slice(7))]);
  }
}
