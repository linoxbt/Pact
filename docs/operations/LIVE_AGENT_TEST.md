# Real Railway agent test

The dated [verification report](../verification/2026-10-08-live-agent.md) records actual results. Do not infer a passing result from the existence of these scripts.

## Runtime

- `scripts/live-agent/server.mjs`: authenticated Railway process with a real Llama planning/observation loop, gateway requests and restricted Monad testnet signing.
- `tools/test-model`: expiring Workers AI endpoint. Its credential is encrypted in Pact and injected by the gateway. The actor receives only a scoped Pact credential, never the model provider credential.
- The test actor shares the existing worker service because Railway Free refused a sixth service. `PACT_ENABLE_TEST_AGENT=yes` enables it; the existing worker supervisor restarts the service if any child fails. This is a test configuration, not tenant isolation.
- The actor accepts one concurrent operation and at most 500 control requests per process lifetime. A model task may execute one tool action, then summarize its observation. No arbitrary shell, arbitrary upstream, native-value transfer or mainnet RPC is exposed.
- Transactions target the configured ledger or a Pact account with the expected registry, with an allowlisted method and a gas-cost ceiling. Chain ID is checked before signing.

## Credentials, ownership and cleanup

The dedicated Privy identity proves ownership using SIWE. Its private key, short-lived token, agent operational key, scoped keys, model secret and actor control secret remain in ignored `.secrets/live-agent/` files with mode 0600. The Railway child receives an explicit environment allowlist. A shared container remains a shared trust boundary, including filesystem/process access; this is not suitable for hostile tenant code.

The actor's controller secret is administrative test access, not an upstream integration credential. Keep it outside agents using the gateway. All test keys/grants and the actor/model execution window expire. The test upstream expires after 30 minutes. The transfer and obligation grants were revoked after settlement; the HTTP agent remains available within its test window. Do not use these keys for real funds. Rotate or remove the Railway actor key and disable `PACT_ENABLE_TEST_AGENT` when the test window ends.

The test account has a distinct principal and Pact account. It is not the user's production identity. Its private workspace will not be visible when another user signs into the Console. Changing the test identity's principal was signature-verified; migration reissued the HTTP grant and preserved the old grant's owner and history.

## Reproduce with the existing test identity

These scripts target the existing Pact testnet deployment and require the local ignored credentials. They are operator tooling, not public unauthenticated demo endpoints. Run sequentially; several checks intentionally disable or revoke authority.

```sh
pnpm install --frozen-lockfile
pnpm build
forge build --root packages/contracts
node scripts/live-agent/identity.mjs
node scripts/live-agent/refresh-probe.mjs
node scripts/live-agent/check-fixes.mjs
node scripts/live-agent/test-http.mjs
node scripts/live-agent/test-clients.mjs
```

The HTTP test sends all gateway calls in its enforcement suite through the Railway actor. It proves forwarding/denial using an actual protected upstream with independent request counters. The model makes actual inference requests through Pact and chooses a tool action; the results contain usage, decisions and request IDs. The Python and MCP checks use real clients against the live gateway from the test controller.

`test-boundaries.mjs` adds exact spending, currency, recipient, retry and grant-edit checks. Its final migration step is intentionally **one-time**: run it only with a grant still owned by the previous principal. A repeated migration is correctly rejected. `test-chain.mjs` creates a new test token and grant; it spends testMON, so inspect balances and previous evidence before rerunning. `test-obligation.mjs` creates a new funded obligation with distinct test roles. If settlement needs gas after an interrupted run, `finish-obligation.mjs` finalizes the existing recorded obligation and validates its receipt. Do not restart an interrupted economic test blindly; inspect saved transaction hashes first.

To provision a fresh test actor from an empty setup: authenticate with `identity.mjs`, run `configure-railway.mjs`, deploy the worker service with the current source, deploy the model Worker with its expiring secret file, then run `provision.mjs`. The helper is purposefully tied to this test project. It does not create or upgrade Railway plans.

`check-operations.mjs` requires a temporary registered Railway SSH key at `/root/.ssh/pact-live-check` to query indexed events over the private network. Remove the registration afterward. `scripts/ops-status.mjs` separately checks worker/indexer/runner heartbeats and chain lag. No public database endpoint is required.

## Local regression gates

```sh
# Point only at an isolated disposable database; tests mutate their fixtures.
PACT_TEST_DATABASE_URL=postgres://... pnpm test
pnpm check
pnpm test:live-agent-safety
```

The Console browser integration uses an explicitly mocked Privy identity with real local API/database/gateway services. That test is not evidence of live email/passkey login. AWS evidence storage, KMS/Secrets Manager, paid managed-provider billing, disaster recovery and hosted authenticator recovery need operator configuration and separate live verification. Onchain receipt anchoring does not prove those external services work.
