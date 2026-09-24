import { createPublicClient, erc20Abi, http } from 'viem';
import { AuthService, OperationStore, createDatabase, loadCoreConfig, migrate } from '@pact/operations';
import { PactClient } from '@pact/sdk-ts';
import { KMSClient } from '@aws-sdk/client-kms';
import { S3Client } from '@aws-sdk/client-s3';
import { CredentialCipher, EvidenceStore } from '@pact/security';
import { createApi } from './server.js';
import { loadBillingConfig } from './billing.js';

const config = loadCoreConfig();
const allowedOrigin = process.env.PACT_CONSOLE_ORIGIN;
if (!allowedOrigin) throw new Error('PACT_CONSOLE_ORIGIN is required');
if (config.environment === 'production' &&
    (!allowedOrigin.startsWith('https://') ||
     (process.env.PACT_EXPLORER_ORIGIN && !process.env.PACT_EXPLORER_ORIGIN.startsWith('https://')) ||
     config.authDomain !== new URL(allowedOrigin).host))
  throw new Error('Production browser origins and auth domain must use the Console HTTPS host');
const database = createDatabase(config.databaseUrl);
await migrate(database);
const rpc = createPublicClient({ transport: http(config.rpcUrl) });
if (await rpc.getChainId() !== config.chainId) throw new Error('RPC chain ID mismatch');
const pact = new PactClient(rpc, config.addresses);
const auth = new AuthService(database, rpc, pact, config);
const operations = new OperationStore(database);
const bucket = process.env.PACT_EVIDENCE_BUCKET;
const kmsKeyId = process.env.PACT_EVIDENCE_KMS_KEY_ID;
if (config.environment === 'production' && (!bucket || !kmsKeyId))
  throw new Error('Production requires PACT_EVIDENCE_BUCKET and PACT_EVIDENCE_KMS_KEY_ID');
const evidence = bucket && kmsKeyId ? new EvidenceStore(new KMSClient({}), new S3Client({}),
  kmsKeyId, bucket) : undefined;
const credentialKeyId = process.env.PACT_CREDENTIAL_KMS_KEY_ID;
if (config.environment === 'production' && !credentialKeyId)
  throw new Error('Production requires PACT_CREDENTIAL_KMS_KEY_ID');
const credentials = credentialKeyId ? new CredentialCipher(new KMSClient({}), credentialKeyId) : undefined;
const billing = loadBillingConfig(process.env);
if (billing && await rpc.readContract({ address: billing.token, abi: erc20Abi,
  functionName: 'decimals' }) !== 6)
  throw new Error('Pact-funded testnet token must have exactly six decimals');
const app = await createApi({ database, rpc, pact, auth, operations,
  allowedOrigin: process.env.PACT_EXPLORER_ORIGIN ? [allowedOrigin, process.env.PACT_EXPLORER_ORIGIN] : allowedOrigin,
  ...(evidence ? { evidence } : {}), ...(credentials ? { credentials } : {}),
  customModelEndpoints: (process.env.PACT_CUSTOM_MODEL_ENDPOINTS ?? '').split(',').filter(Boolean),
  ...(billing ? { billing } : {}) });
const port = Number(process.env.PORT ?? process.env.PACT_API_PORT ?? 4100);
await app.listen({ host: '0.0.0.0', port });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => {
  await app.close();
  await database.end();
  process.exit(0);
});
