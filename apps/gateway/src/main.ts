import { createPublicClient, http } from 'viem';
import { AuthService, createDatabase, loadCoreConfig, migrate } from '@pact/operations';
import { PactClient } from '@pact/sdk-ts';
import { CredentialCipher, DeploymentSecretCipher } from '@pact/security';
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
const credentialKeyId = process.env.PACT_CREDENTIAL_KMS_KEY_ID;
if (config.environment === 'production' && !credentialKeyId)
  throw new Error('Production gateway requires PACT_CREDENTIAL_KMS_KEY_ID');
const cipher = credentialKeyId ? new CredentialCipher(new KMSClient({}), credentialKeyId) :
  process.env.PACT_VAULT_MASTER_KEY ? new DeploymentSecretCipher(process.env.PACT_VAULT_MASTER_KEY) :
    (() => { throw new Error('Gateway requires credential encryption'); })();
const secrets = new TenantSecretProvider(database, cipher);
const app = await createGateway({ database, pact, auth,
  secrets, ...(process.env.PACT_CONSOLE_ORIGIN ?
    { allowedOrigin: process.env.PACT_CONSOLE_ORIGIN } : {}),
  proxy: { database, cipher,
    allowLocalUpstream: config.environment === 'development' &&
      process.env.PACT_ALLOW_LOCAL_UPSTREAM === 'yes' } });
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? process.env.PACT_GATEWAY_PORT ?? 4101) });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => {
  await app.close();
  await database.end();
  process.exit(0);
});
