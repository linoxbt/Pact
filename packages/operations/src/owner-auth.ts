import { createHash, createPublicKey, randomBytes, randomUUID, verify as verifySignature, type JsonWebKey } from 'node:crypto';
import { isAddress, isHex, type Address, type Hex, type PublicClient } from 'viem';
import { AuthError } from './auth.js';
import type { Database } from './db.js';

export type Owner = Readonly<{ id: string; did: string; principalAddress: Address | null;
  principalStatus: 'verified' | 'account_assigned' | 'unverified' }>;
type JwtClaims = { sub: string; aud: string; iss: string; exp: number; iat: number };
type UserRow = { id: string; privy_did: string; principal_address: string | null;
  principal_status: Owner['principalStatus'] };
const decode = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Verify Privy's signed JWT using its app-specific JWKS. Never trust a client supplied DID. */
export class PrivyTokenVerifier {
  private keys: { kid: string; jwk: JsonWebKey }[] = [];
  private fetchedAt = 0;
  constructor(readonly appId: string, readonly fetcher: typeof fetch = fetch) {
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(appId)) throw new Error('PACT_PRIVY_APP_ID required');
  }

  async verify(token: string): Promise<{ did: string; issuedAt: number }> {
    if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
      throw new AuthError('INVALID_OWNER_TOKEN');
    const [headerPart, payloadPart, signaturePart] = token.split('.') as [string,string,string];
    let header: { alg?: string; kid?: string }; let claims: JwtClaims;
    try { header = decode(headerPart) as typeof header; claims = decode(payloadPart) as JwtClaims; }
    catch { throw new AuthError('INVALID_OWNER_TOKEN'); }
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'ES256' || !header.kid || claims.iss !== 'privy.io' ||
        claims.aud !== this.appId || !/^did:privy:[A-Za-z0-9_-]+$/.test(claims.sub) ||
        !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) ||
        claims.exp <= now || claims.iat > now + 60 || claims.iat < now - 86_400)
      throw new AuthError('INVALID_OWNER_TOKEN');
    if (Date.now() - this.fetchedAt > 300_000 || !this.keys.some(key => key.kid === header.kid)) {
      const response = await this.fetcher(`https://auth.privy.io/api/v1/apps/${this.appId}/jwks.json`,
        { signal: AbortSignal.timeout(5_000), redirect: 'error' });
      if (!response.ok) throw new AuthError('IDENTITY_PROVIDER_UNAVAILABLE', 503);
      const data = await response.json() as { keys?: Array<JsonWebKey & { kid?: string; alg?: string }> };
      this.keys = (data.keys ?? []).filter(key => key.kty === 'EC' && key.crv === 'P-256' &&
        typeof key.kid === 'string' && (!key.alg || key.alg === 'ES256'))
        .map(key => ({ kid: key.kid!, jwk: key }));
      this.fetchedAt = Date.now();
    }
    const key = this.keys.find(item => item.kid === header.kid);
    if (!key || !verifySignature('sha256', Buffer.from(`${headerPart}.${payloadPart}`),
      { key: createPublicKey({ key: key.jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(signaturePart, 'base64url'))) throw new AuthError('INVALID_OWNER_TOKEN');
    return { did: claims.sub, issuedAt: claims.iat };
  }
}

export class OwnerAuthService {
  constructor(readonly database: Database, readonly rpc: PublicClient,
    readonly verifier: Pick<PrivyTokenVerifier,'verify'>, readonly domain: string) {}

  async authenticate(header: string | undefined): Promise<Owner> {
    if (!header?.startsWith('Bearer ')) throw new AuthError('OWNER_TOKEN_REQUIRED');
    const identity = await this.verifier.verify(header.slice(7));
    const existing = await this.database.query<UserRow>(
      'SELECT * FROM pact_users WHERE privy_did=$1', [identity.did]);
    let user = existing.rows[0] ?? (await this.database.query<UserRow>(
      `INSERT INTO pact_users(id,privy_did,principal_address,principal_status)
       VALUES ($1,$2,$3,'account_assigned')
       ON CONFLICT (privy_did) DO UPDATE SET updated_at=pact_users.updated_at RETURNING *`,
      [randomUUID(), identity.did, `0x${randomBytes(20).toString('hex')}`])).rows[0]!;
    // Upgrade users created before account-assigned principals were introduced.
    if (!user.principal_address) user = (await this.database.query<UserRow>(
      `UPDATE pact_users SET principal_address=$2,principal_status='account_assigned',updated_at=now()
       WHERE id=$1 AND principal_address IS NULL RETURNING *`,
      [user.id, `0x${randomBytes(20).toString('hex')}`])).rows[0] ??
      (await this.database.query<UserRow>('SELECT * FROM pact_users WHERE id=$1', [user.id])).rows[0]!;
    return { id: user.id, did: user.privy_did,
      principalAddress: user.principal_address as Address | null,
      principalStatus: user.principal_status };
  }

  async challenge(owner: Owner, address: string) {
    if (!isAddress(address)) throw new AuthError('INVALID_PRINCIPAL_ADDRESS', 400);
    const existing = await this.database.query<{ id: string }>(
      'SELECT id FROM pact_users WHERE principal_address=$1 AND id<>$2',
      [address.toLowerCase(), owner.id]);
    if (existing.rowCount) throw new AuthError('ADDRESS_ALREADY_ASSIGNED', 409);
    const action = owner.principalAddress ? 'change' : 'enroll';
    const recent = await this.database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pact_address_challenges
       WHERE user_id=$1 AND expires_at>now() - interval '5 minutes'`, [owner.id]);
    if (Number(recent.rows[0]?.count ?? 0) >= 5) throw new AuthError('CHALLENGE_RATE_LIMITED', 429);
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const message = `Verify Pact account address\nDomain: ${this.domain}\nOwner: ${owner.did}\nAction: ${action}\nAddress: ${address.toLowerCase()}\nNonce: ${id}\nExpires: ${expiresAt.toISOString()}`;
    await this.database.query(
      `INSERT INTO pact_address_challenges(id,user_id,address,action,message,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`, [id, owner.id, address.toLowerCase(), action, message, expiresAt]);
    return { challengeId: id, message, expiresAt: expiresAt.toISOString() };
  }

  async verifyAddress(owner: Owner, challengeId: string, signature: string) {
    if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !isHex(signature))
      throw new AuthError('INVALID_ADDRESS_PROOF', 400);
    const result = await this.database.query<{ address: string; action: string; message: string;
      expires_at: Date; used_at: Date | null }>(
      'SELECT * FROM pact_address_challenges WHERE id=$1 AND user_id=$2', [challengeId, owner.id]);
    const challenge = result.rows[0];
    if (!challenge || challenge.used_at || challenge.expires_at.getTime() <= Date.now())
      throw new AuthError('ADDRESS_CHALLENGE_EXPIRED', 409);
    if (challenge.action === 'change' && !owner.principalAddress)
      throw new AuthError('PRINCIPAL_STATE_CHANGED', 409);
    if (challenge.action === 'enroll' && owner.principalAddress)
      throw new AuthError('PRINCIPAL_STATE_CHANGED', 409);
    if (!await this.rpc.verifyMessage({ address: challenge.address as Address,
      message: challenge.message, signature: signature as Hex }))
      throw new AuthError('INVALID_ADDRESS_PROOF', 403);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const used = await client.query(
        `UPDATE pact_address_challenges SET used_at=now() WHERE id=$1 AND user_id=$2
         AND used_at IS NULL AND expires_at>now() RETURNING id`, [challengeId, owner.id]);
      if (used.rowCount !== 1) throw new AuthError('ADDRESS_CHALLENGE_EXPIRED', 409);
      const update = await client.query<UserRow>(
        `UPDATE pact_users SET principal_address=$2,principal_status='verified',updated_at=now()
         WHERE id=$1 AND principal_address IS NOT DISTINCT FROM $3 RETURNING *`,
        [owner.id, challenge.address, owner.principalAddress]);
      if (update.rowCount !== 1) throw new AuthError('PRINCIPAL_STATE_CHANGED', 409);
      await client.query(
        `INSERT INTO pact_principal_history(user_id,previous_address,new_address,proof_hash)
         VALUES ($1,$2,$3,$4)`, [owner.id, owner.principalAddress, challenge.address, digest(signature)]);
      await client.query('COMMIT');
      return { principalAddress: challenge.address, verificationStatus: 'verified',
        existingGrantsRetainOriginalPrincipal: true };
    } catch (cause) { await client.query('ROLLBACK'); throw cause; }
    finally { client.release(); }
  }
}
