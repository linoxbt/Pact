# Monad testnet deployment

The active release is recorded in [`deployments/monad-testnet.json`](../../deployments/monad-testnet.json), deployed on 7 October 2026 starting at block `69041081`. Earlier manifests are historical deployment evidence, not user onboarding defaults.

| Setting | Value |
| --- | --- |
| Network | Monad testnet, chain `10143` |
| RPC | `https://testnet-rpc.monad.xyz` |
| API | `https://pact-api-production-2ab9.up.railway.app` |
| Gateway | `https://pact-gateway-production-ec3f.up.railway.app` |
| Console / docs / Explorer | `https://pact-protocol-monad.alemzdelight.workers.dev` |

## Principal ownership

There is no product-wide principal. Each Privy user receives an individual account identifier for HTTP authority. Enabling onchain signing requires proof of control of that user's embedded or external wallet. The factory creates an account owned by that verified wallet. Existing grants retain the original principal; changes require explicit migration or reissuance.

The `principal` and `account` fields in historical testnet manifests describe an already deployed legacy account. They must never be copied into user profiles or mainnet deployment defaults. Public `/v1/config` returns null account/principal unless a specific owner is requested. An explicitly requested legacy owner may still access their existing account. Mainnet infrastructure deployment creates the factory without creating any shared user account.

## Hosted services

Railway project `pact-testnet` uses PostgreSQL, API, gateway, indexer and a supervised worker/runner pair. The runner shares the existing worker service to stay within Free plan capacity. All routes use the current API; the old legacy API origin is retired. Runtime remains staging with deployment-key credential encryption. Production AWS KMS/evidence storage and recovery configuration are pending.

Cloudflare builds `apps/console` with public API/gateway/Privy values and `VITE_PACT_CHAIN_ID=10143`. The same origin must be allowed in Privy. Provider-backed runs require a configured provider credential. Pact-funded credit is testnet-only and disabled unless its separate token, treasury and rate configuration is supplied.

For live gateway checks, sign in, open **Verification** and choose **Run live enforcement check**. It uses actual API, PostgreSQL and gateway requests under that signed-in user. It is distinct from a model-provider run and from onchain transaction verification.
