# Monad testnet deployment

Pact's testnet deployment is recorded in [`deployments/monad-testnet.json`](../../deployments/monad-testnet.json). The contracts were deployed and configured on 24 September 2026. The first contract deployment was in block `65276558`.

| Setting | Value |
| --- | --- |
| Monad testnet chain ID | `10143` |
| Testnet HTTPS RPC | `https://testnet-rpc.monad.xyz` |
| Mainnet chain ID (reference only) | `143` |
| Mainnet HTTPS RPC (reference only) | `https://rpc.monad.xyz` |
| Testnet principal | `0xc759e906a02825d483714b8141758f6258145572` |
| Testnet deployer | `0xF08F03B322CC928e4Be06A91e13a4E910196ae26` |
| Testnet USDC token listed by Monad | `0x534b2f3A21130d7a60830c2Df862319e593943A3` (6 decimals) |
| Agent management API | `https://pact-api-production-2ab9.up.railway.app` |
| Policy gateway | `https://pact-gateway-production-ec3f.up.railway.app` |
| Legacy grant API | `https://pact-api-production-1a80.up.railway.app` |
| Console, landing, docs, Explorer | `https://pact-protocol-monad.alemzdelight.workers.dev` |

The listed testnet principal belongs to the original wallet-backed Monad grants. New HTTP authority grants belong to individual Privy accounts and use each account's verified address; the listed address is never assigned to all users. The deployer is the separate key used to pay gas for contract deployment. For a testnet model-credit checkout, the six-decimal token is the accounting asset, and the treasury is the wallet that receives deposits. The checkout stays disabled until a provider secret and current per-model rates are configured. The deployer address is a possible disposable testnet treasury, but it is not automatically assigned by the contract deployment.

The active Railway project is [`pact-testnet`](https://railway.com/project/0fd7f850-661f-41d9-b924-e3ede54c3097) in the Roy Black workspace. It has a new PostgreSQL database and separate `pact-api`, `pact-gateway`, `pact-indexer`, and `pact-worker` services. Each service references `${{Postgres.DATABASE_URL}}` through `PACT_DATABASE_URL`, uses `PACT_ENVIRONMENT=staging`, and pins the chain ID and all six contract addresses. `RAILWAY_DOCKERFILE_PATH=Dockerfile.service` selects the shared image; `PACT_SERVICE` selects the entrypoint. The indexer starts at block `65276558` and may take time to rebuild historical events. The older Railway API remains the source for `/v1` legacy grants and Explorer reads through `VITE_PACT_LEGACY_API_URL`; its database was not migrated to the new Railway workspace. The runner code can use the staging deployment vault, but a separate `pact-runner` service could not be provisioned because this Railway workspace reached its free-plan resource limit. Model runs are unavailable until that capacity is increased and the runner is deployed.

The API and gateway share a Railway-managed deployment encryption secret for staging credential storage. This is a testnet configuration, not the production KMS/S3 setup. The model runner requires AWS KMS and provider secrets and is not active in this project.

The Cloudflare Workers Static Assets site builds from `apps/console` with the public `VITE_PACT_API_URL`, `VITE_PACT_GATEWAY_URL`, `VITE_PACT_LEGACY_API_URL`, and `VITE_PRIVY_APP_ID` values in `apps/console/.env.production`. Deploy it with `pnpm --filter @pact/console deploy:cloudflare`; the configuration is `apps/console/wrangler.jsonc`. Allow `https://pact-protocol-monad.alemzdelight.workers.dev` as an origin in the Privy dashboard. Pact assigns an account principal address on first sign-in; proof of an external address is required only when linking it for Monad actions. The API's `PACT_CONSOLE_ORIGIN` and `PACT_AUTH_DOMAIN` are set to the Cloudflare origin and host respectively.

Sources: [Monad testnet documentation](https://docs.monad.xyz/developer-essentials/testnet), [Monad mainnet network information](https://docs.monad.xyz/developer-essentials/network-information), and [Monad testnet token list](https://github.com/monad-crypto/token-list/blob/main/tokenlist-testnet.json). The chain IDs, token decimals, and RPC responses were also checked directly before deployment.
