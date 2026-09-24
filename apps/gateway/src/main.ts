import { createPublicClient, http } from 'viem';
import { AuthService, createDatabase, loadCoreConfig, migrate } from '@pact/operations';
import { PactClient } from '@pact/sdk-ts';
import { AwsSecretProvider, CredentialCipher } from '@pact/security';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { KMSClient } from '@aws-sdk/client-kms';
import { createGateway } from './server.js';
import { TenantSecretProvider } from './tenant-secrets.js';

const config = loadCoreConfig();
const database = createDatabase(config.databaseUrl);
await migrate(database);
const rpc = createPublicClient({ transport: http(config.rpcUrl) });
if (await rpc.getChainId() !== config.chainId) throw new Error('RPC chain ID mismatch');
const pact = new PactClient(rpc, config.addresses);
const auth = new AuthService(database, rpc, pact, config);
const secretId = process.env.PACT_GITHUB_SECRET_ID;
if (!secretId) throw new Error('PACT_GITHUB_SECRET_ID required');
const operator = new AwsSecretProvider(new SecretsManagerClient({}), secretId);
const credentialKeyId = process.env.PACT_CREDENTIAL_KMS_KEY_ID;
if (config.environment === 'production' && !credentialKeyId)
  throw new Error('Production requires PACT_CREDENTIAL_KMS_KEY_ID');
const secrets = credentialKeyId ? new TenantSecretProvider(database,
  new CredentialCipher(new KMSClient({}), credentialKeyId), operator) : operator;
const app = await createGateway({ database, pact, auth,
  secrets });
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? process.env.PACT_GATEWAY_PORT ?? 4101) });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => {
  await app.close();
  await database.end();
  process.exit(0);
});
