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
| API | `https://pact-api-production-1a80.up.railway.app` |
| Console, landing, docs, Explorer | `https://pact-protocol-monad.netlify.app` |

The principal is the human wallet that signs grants and approvals. The deployer is the separate key used to pay gas for contract deployment. For a testnet model-credit checkout, the six-decimal token is the accounting asset, and the treasury is the wallet that receives deposits. The checkout stays disabled until a provider secret and current per-model rates are configured. The deployer address is a possible disposable testnet treasury, but it is not automatically assigned by the contract deployment.

Railway project `pact-testnet` contains PostgreSQL and separate `pact-api`, `pact-worker`, `pact-indexer`, `pact-gateway`, and `pact-runner` services. Each application service references `${{Postgres.DATABASE_URL}}` through `PACT_DATABASE_URL`, uses `PACT_ENVIRONMENT=staging`, and pins the chain ID and all six contract addresses. `RAILWAY_DOCKERFILE_PATH=Dockerfile.service` selects the shared image; `PACT_SERVICE` selects the entrypoint. The indexer starts at block `65276558`. API, worker, and indexer have been deployed; gateway and runner need cloud secret configuration before activation.

The site build requires `VITE_PACT_API_URL` set to the public API URL. The browser origin must match `PACT_CONSOLE_ORIGIN` on the API.

Sources: [Monad testnet documentation](https://docs.monad.xyz/developer-essentials/testnet), [Monad mainnet network information](https://docs.monad.xyz/developer-essentials/network-information), and [Monad testnet token list](https://github.com/monad-crypto/token-list/blob/main/tokenlist-testnet.json). The chain IDs, token decimals, and RPC responses were also checked directly before deployment.
