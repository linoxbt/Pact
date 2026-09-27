# Pact

Pact is an authority and economic accountability layer for autonomous agents on Monad. The intended product covers grants, policy, counterparty proofs, obligations, settlement, and independently verifiable receipts. Five product and engineering PDFs are included at the repository root.

## Implemented architecture

This repository currently implements a **controlled transfer and funded obligation** foundation:

- `AuthorityRegistry` creates principal-owned grants and narrower child grants, rotates agent keys, and cascades revocation checks.
- `CommitmentLedger` locks child allocations, reserves exact action hashes, expires reservations, and counts cumulative spend.
- `PactAccount` holds a principal's ERC-20 tokens and executes only a reserved transfer to the grant's fixed recipient. Transfers above the grant's approval threshold require the principal's EIP-712 signature; ERC-1271 principals are supported.
- `ObligationManager` turns a liability reservation into an exact-terms agreement signed by the principal and provider. One milestone can be funded, evidenced, verified, challenged, arbitrated, paid or refunded.
- `SettlementVault` holds the funded ERC-20 milestone and `ReceiptRegistry` anchors the final outcome.
- `@pact/schemas` defines typed action hashes, amount parsing, and capacity projections.
- `@pact/engine` provides a deterministic quote and policy preview for the same transfer action.
- `@pact/proofs` verifies live reservations and receipt anchors directly from RPC; `@pact/sdk-ts` prepares typed contract calls without taking custody of signing keys.
- `@pact/operations` provides wallet challenge sessions, PostgreSQL migrations, scoped agent keys, idempotent operation records, testnet credit accounting and audit records. The API serves scoped reads, policy publication, agent management and wallet transaction preparation.
- The transaction worker reconciles submitted operations against finalized canonical receipts. The indexer tracks finalized events and rolls back orphaned blocks.
- The gateway enforces a principal-signed, onchain hash-bound allowlist and request budget for a bounded GitHub repository read. Tenant credentials are KMS encrypted; an operator fallback uses AWS Secrets Manager.
- Evidence uploads are encrypted with a one-time AES-256-GCM key wrapped by AWS KMS before storage in private S3. The API checks the live obligation grant on upload and read.
- The approval inbox stores exact transfer requests and moves them through pending, approved, rejected, expired and consumed states. Principal EIP-712 signatures are checked before agents can retrieve them.
- `pact-agent-sdk` is a Python API client. `@pact/sdk-ts` also exposes a scoped HTTP client. The MCP server exposes authority, quote, prepare, approval, operation, receipt and managed-run tools using a scoped session or API key.
- The managed runner performs bounded text tasks with OpenAI, Anthropic or an operator-approved custom endpoint. It checks the live grant before each call, uses a tenant-vaulted provider key or Pact-funded testnet credit, and never executes model tool calls or signs transactions.
- The unified site contains landing, docs, Console and Explorer. A principal can create and revoke grants, manage agents and scoped keys, vault provider credentials, configure and inspect model runs, publish policy, sign exact transfer approvals, and inspect obligations and operations. The Explorer displays receipts and only grants with an explicitly published public disclosure policy.

The policy preview is advisory. Onchain contracts enforce agent identity, active ancestry, token, recipient, single-action limit, cumulative ceiling, approval threshold, exact reservation, nonce, and expiry. Obligation creation independently checks both signatures, exact gross liability, provider, token, verifier, arbitrator, and dates. A `policyHash` binds transfer actions to a declared policy version, but arbitrary offchain policy fields are **not** enforced by these contracts.

## Run

Prerequisites: Node.js 22+, pnpm 11, Python 3.10+, Foundry with Solidity 0.8.28. PostgreSQL is required for service integration tests and running services.

```sh
pnpm install
pnpm test
pnpm check
```

The contracts use `forge test --root packages/contracts`. Most tests need no secrets or RPC connection. Set `PACT_TEST_DATABASE_URL` to run the PostgreSQL integration tests; CI provisions a disposable database. See [local development](docs/operations/LOCAL_DEVELOPMENT.md).

## Trust boundary and current limitations

- An agent must never receive the principal's unrestricted wallet key. The principal funds a `PactAccount`; only its narrow transfer method can move those funds.
- The controlled account supports **one token and one fixed recipient per grant**. It does not execute arbitrary contract calls, subscriptions, or external API requests.
- The obligation flow supports one fully funded milestone. Provider delivery is judged by a named verifier; the receipt proves that the configured contracts recorded and settled that decision. It does **not** prove the truth of private evidence or legal enforceability.
- The gateway's current provider adapter is a bounded GitHub repository read. Managed model tasks are text-only and do not create onchain obligations or execute arbitrary APIs. General third-party contract execution requires new liability adapters.
- Pact-funded model credit is **testnet-only**. Deposits use an operator-selected six-decimal token and treasury, and quoted provider rates plus a 20% service markup. No production custody, cash redemption or independent audit is claimed.
- Managed secrets and encrypted evidence have AWS adapters but no cloud resources or live validation here. Production operations still need alarms, backup/restore drills, and rate limiting at the edge. The six contracts and core API are deployed for Monad testnet use; this is not a mainnet release.
- This code has not had an independent security review. It must not be used to custody real funds until the unresolved choices in [ADR 0001](docs/adr/0001-controlled-transfer-foundation.md) are resolved and an audit is complete.

See the [architecture map](docs/ARCHITECTURE.md), [protocol accounting](docs/protocol/ACCOUNTING.md) and [product roadmap](docs/ROADMAP.md) for layer coverage, invariants and remaining work. The [production operations plan](docs/operations/PRODUCTION.md) and [independent audit handoff](docs/security/INDEPENDENT_AUDIT_HANDOFF.md) define the deployment and external review gates.

## Monad testnet deployment

The public site is at [pact-protocol-monad.alemzdelight.workers.dev](https://pact-protocol-monad.alemzdelight.workers.dev), and the API is at [pact-api-production-1a80.up.railway.app](https://pact-api-production-1a80.up.railway.app). The Console uses Privy wallet login and requires the deployed account's principal wallet. Contract addresses and operational configuration are in [the testnet runbook](docs/operations/MONAD_TESTNET.md).

`node scripts/create-testnet-deployer.mjs` creates a dedicated testnet key at `.secrets/monad-testnet-deployer.key` with owner-only permissions and prints only its public address. Back up the key securely; it is excluded from Git. Fund that address with testnet MON. `PACT_RPC_URL=https://... node scripts/deploy-monad-testnet.mjs` performs a read-only chain ID and balance check. To deploy after funding, set `PACT_PRINCIPAL` to the human-controlled wallet address and `PACT_BROADCAST_TESTNET=yes`, then pass `--broadcast`. The script refuses any chain other than Monad testnet chain ID 10143 and records a resumable local checkpoint. Never run it with mainnet RPC or a real-funds key.

## Product architecture

The [technical architecture](Pact_Technical_Architecture_and_Build_Spec-3.pdf) describes the six protocol layers and product trust boundaries. The [implementation blueprint](Pact_File_by_File_Implementation_Blueprint.pdf) lists the proposed files and acceptance gates. The source tree is an incremental implementation of those documents; the PDFs do not imply that unbuilt components exist.
