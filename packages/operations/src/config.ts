import { isAddress, type Address } from 'viem';
import { z } from 'zod';
import type { PactAddresses } from '@pact/sdk-ts';

const envSchema = z.object({
  PACT_DATABASE_URL: z.url(),
  PACT_RPC_URL: z.url(),
  PACT_CHAIN_ID: z.coerce.number().int().positive(),
  PACT_REGISTRY: z.string(),
  PACT_LEDGER: z.string(),
  PACT_ACCOUNT: z.string(),
  PACT_MANAGER: z.string(),
  PACT_VAULT: z.string(),
  PACT_RECEIPTS: z.string(),
  PACT_FINALITY_BLOCKS: z.coerce.number().int().min(0).default(5),
  PACT_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),
  PACT_AUTH_DOMAIN: z.string().min(3),
  PACT_ENVIRONMENT: z.enum(['development','staging','production']).default('development'),
});

export type CoreConfig = Readonly<{
  databaseUrl: string;
  rpcUrl: string;
  chainId: number;
  addresses: PactAddresses & { vault: Address };
  finalityBlocks: number;
  sessionTtlSeconds: number;
  authDomain: string;
  environment: 'development' | 'staging' | 'production';
}>;

export function loadCoreConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const value = envSchema.parse(env);
  if (value.PACT_ENVIRONMENT === 'production') {
    if (!value.PACT_RPC_URL.startsWith('https://')) throw new Error('Production RPC must use HTTPS');
    const db = new URL(value.PACT_DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(db.protocol) ||
        db.searchParams.get('sslmode') !== 'verify-full')
      throw new Error('Production PostgreSQL must use sslmode=verify-full');
  }
  const address = (input: string, label: string): Address => {
    if (!isAddress(input)) throw new Error(`${label} must be an EVM address`);
    return input as Address;
  };
  return {
    databaseUrl: value.PACT_DATABASE_URL,
    rpcUrl: value.PACT_RPC_URL,
    chainId: value.PACT_CHAIN_ID,
    finalityBlocks: value.PACT_FINALITY_BLOCKS,
    sessionTtlSeconds: value.PACT_SESSION_TTL_SECONDS,
    authDomain: value.PACT_AUTH_DOMAIN,
    environment: value.PACT_ENVIRONMENT,
    addresses: {
      registry: address(value.PACT_REGISTRY, 'PACT_REGISTRY'),
      ledger: address(value.PACT_LEDGER, 'PACT_LEDGER'),
      account: address(value.PACT_ACCOUNT, 'PACT_ACCOUNT'),
      manager: address(value.PACT_MANAGER, 'PACT_MANAGER'),
      vault: address(value.PACT_VAULT, 'PACT_VAULT'),
      receipts: address(value.PACT_RECEIPTS, 'PACT_RECEIPTS'),
    },
  };
}
