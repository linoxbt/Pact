# Local development

Install Node.js 22, pnpm 11 and Foundry. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

`pnpm check` builds the TypeScript packages before checking dependents, checks Solidity formatting, and runs the contract suite. The local suite needs no external service or wallet.

The deployment script creates and wires an immutable ledger, registry, controlled account, obligation manager, escrow vault and receipt registry. For an offline simulation:

```sh
cd packages/contracts
PACT_PRINCIPAL=0x0000000000000000000000000000000000000001 forge script script/Deploy.s.sol:Deploy
```

For an RPC proof smoke test, start a disposable Anvil chain, broadcast `Deploy.s.sol` from an unlocked local account, and record the returned addresses. Set `PACT_PRINCIPAL`, `PACT_REGISTRY`, `PACT_LEDGER`, `PACT_ACCOUNT`, and `PACT_RPC` in your local environment. Broadcast `LocalProofSmoke.s.sol` on that same chain, then run `node test/local-rpc-smoke.mjs` from `packages/proofs`. The smoke test compares Solidity's EIP-712 digest to the TypeScript digest and verifies the live reservation through RPC. Use only disposable local accounts and addresses.

The deployment script does not pick a real asset or create a root grant. Those are principal choices after deployment. No current script is a production deployment procedure.

## Run the local services

Provision a disposable PostgreSQL database and Anvil chain. Copy `.env.example` into a private local environment and replace every contract address with the result of `Deploy.s.sol`; the zero addresses are placeholders. Set `PACT_CONSOLE_ORIGIN` and `PACT_EXPLORER_ORIGIN` to the actual browser origins, then start each process from the repository root in its own terminal:

```sh
pnpm --filter @pact/api start
pnpm --filter @pact/worker start
pnpm --filter @pact/indexer start
pnpm --filter @pact/gateway start
VITE_PACT_API_URL=http://127.0.0.1:4100 pnpm --filter @pact/console dev
VITE_PACT_API_URL=http://127.0.0.1:4100 pnpm --filter @pact/explorer dev
```

Run `pnpm build` first. The API migrates the database at startup. The Console uses an injected EVM wallet; the principal signs the challenge and all chain transactions. The gateway now requires `PACT_GITHUB_SECRET_ID` and AWS credentials with Secrets Manager access. To exercise the gateway locally, use a disposable AWS test account or inject a fake `SecretProvider` in its tests; the production entrypoint has no raw environment-token fallback. The MCP server runs over stdio with `PACT_API_URL` and a short-lived `PACT_SESSION_TOKEN` obtained from the wallet challenge flow; never put the principal's private key in its environment.

The Python SDK is in `packages/sdk-python`. Install it into your agent environment with `pip install ./packages/sdk-python`. Create a `PactClient` with the API URL, obtain a wallet challenge, sign its exact message in your wallet, and pass the returned session token to `with_token`. A transfer preparation returns `to`, `data`, `value` and an operation ID. Submit that call from the grant's agent wallet, then report its transaction hash and poll the operation until it is `confirmed` or `reverted`. The SDK does not sign or broadcast.

For PostgreSQL integration tests, set `PACT_TEST_DATABASE_URL` to a disposable database URL before `pnpm test`. CI starts PostgreSQL for these tests. Operation states become `confirmed` only after the configured finality depth, a successful canonical transaction receipt, and the expected contract event. Submitted and recoverable states are not settlement proof.

Evidence upload is available only when `PACT_EVIDENCE_BUCKET` and `PACT_EVIDENCE_KMS_KEY_ID` are set and the API has AWS permissions. Tests use fake KMS and S3 clients, so local unit tests need no cloud account. The [production operations plan](PRODUCTION.md) covers cloud prerequisites, monitoring, backups and recovery. An independent audit and explicit Monad deployment choices remain required for live funds.
