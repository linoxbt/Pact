import type { Database } from '@pact/operations';
import type { CredentialCipher, SecretProvider } from '@pact/security';

type CredentialRow = { id: string; principal: string; provider: string; ciphertext: string;
  encrypted_key: string; kms_key_id: string; cipher_version: number };

/** Prefer a principal's vaulted GitHub credential; use the operator demo key only when absent. */
export class TenantSecretProvider implements SecretProvider {
  constructor(readonly database: Database, readonly cipher: CredentialCipher,
    readonly operator: SecretProvider) {}

  async githubToken(principal?: string, grantId?: bigint): Promise<string> {
    if (!principal || grantId === undefined) return this.operator.githubToken();
    const result = await this.database.query<CredentialRow>(
      `SELECT c.* FROM pact_provider_credentials c JOIN pact_agents a ON a.id=c.agent_id
       WHERE a.grant_id=$1 AND c.principal=$2 AND c.provider='github'
       AND c.revoked_at IS NULL AND a.status='active' LIMIT 1`,
      [grantId.toString(), principal.toLowerCase()]);
    const row = result.rows[0];
    if (!row) return this.operator.githubToken();
    return this.cipher.open({ id: row.id, principal: row.principal, provider: row.provider },
      { ciphertext: row.ciphertext, encryptedKey: row.encrypted_key,
        kmsKeyId: row.kms_key_id, version: row.cipher_version });
  }
}
