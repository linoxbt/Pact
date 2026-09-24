import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

export interface SecretProvider { githubToken(principal?: string, grantId?: bigint): Promise<string>; }

/** A short cache limits Secrets Manager calls while allowing routine rotation. */
export class AwsSecretProvider implements SecretProvider {
  private cached: { value: string; expiresAt: number } | null = null;
  constructor(readonly client: Pick<SecretsManagerClient, 'send'>,
    readonly secretId: string, readonly ttlMs = 30_000) {
    if (!secretId || ttlMs < 0 || ttlMs > 300_000) throw new Error('Invalid secret configuration');
  }

  async githubToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.value;
    const secret = await this.client.send(new GetSecretValueCommand({ SecretId: this.secretId }));
    const value = secret.SecretString ?? (secret.SecretBinary
      ? Buffer.from(secret.SecretBinary).toString('utf8') : undefined);
    if (!value || /[\r\n]/.test(value)) throw new Error('GitHub secret unavailable');
    this.cached = { value, expiresAt: Date.now() + this.ttlMs };
    return value;
  }
}
