# Pact architecture and implementation map

This map follows the six protocol layers in the [technical architecture](../Pact_Technical_Architecture_and_Build_Spec-3.pdf). The six product components are separate delivery surfaces; they do not replace the protocol layers.

| Protocol layer | Current implementation | Boundary and next work |
| --- | --- | --- |
| 1. Identity and authority | `AuthorityRegistry` grants, child delegation, rotation, expiry and cascading revocation; wallet challenge sessions check the live grant. | Add formal key epochs, recovery and organization identity before production. |
| 2. Policy and authorization | Typed transfer intent, bounded policy evaluator, exact reservation, approval threshold, principal signatures, durable approval inbox; gateway policy hash tied to the grant. | General access, temporal and economic policy DSL are not built. Offchain previews are advisory. |
| 3. Proof of Authority | `@pact/proofs` checks live grants, capacity and action-bound reservations via RPC. | Create a portable proof envelope with block reference, disclosure and verification CLI. |
| 4. Proof of Obligation | Mutually signed exact terms, liability reservation, onchain obligation lifecycle. | More than one milestone, cancellation rules and portable counterparty proof need design and tests. |
| 5. Commitment controls | Ledger counts child allocation, pending reservation, active commitment and cumulative spend. A reservation ID is fixed before obligation signatures. | More exposure adapters and period controls require separate review and invariants. |
| 6. Economic receipts | Settlement vault and receipt registry anchor outcome; proof reader verifies chain anchors. Private evidence is encrypted before S3 storage with a KMS-wrapped data key. | Versioned graph receipts and richer provenance remain. A verifier's judgment is an attestation. |

| Product component | Current location and role |
| --- | --- |
| Pact Protocol | `packages/contracts`: canonical economic state and controlled execution on Monad-compatible EVM. |
| Pact Engine | `packages/engine`, `packages/schemas`, `packages/policies`: deterministic transfer policy, typed hashes and narrow signed gateway policy. |
| Pact SDK | `packages/sdk-ts`, `packages/sdk-python`, `packages/proofs`: direct contract reads, scoped HTTP agent management, managed runs, and independent RPC checks. Wallets keep signing keys. |
| Pact MCP Server | `apps/mcp`: stdio tools backed by a scoped API session or agent API key. Tool calls are never consent or settlement proof. |
| Pact Console | `apps/console`: principal wallet flow, grants, policies, approval inbox, agent and key management, credential vault, model runs and testnet checkout. The same site hosts the landing page and docs. |
| Pact Explorer | `apps/console` `/explorer`: public receipt lookup and opt-in public grant disclosure. `apps/explorer` remains a standalone build. |

`apps/api` provides the authenticated service boundary. Principal-signed, scoped API keys remain bound to a live onchain agent grant. `apps/gateway` enforces the signed GitHub read policy and fetches a tenant key from the KMS credential vault or an operator key from Secrets Manager. `packages/security` provides KMS/S3 evidence and credential encryption. `apps/runner` processes idempotent one-shot text runs with OpenAI, Anthropic, or an operator-approved exact HTTPS endpoint; no arbitrary model tool calls execute. Bring-your-own-key runs use tenant credentials. Pact-funded testnet runs reserve onchain-deposited stablecoin credit at configured model rates plus a 20% service markup, then refund unused credit after usage is recorded. `apps/worker` reconciles submitted transactions and consumes confirmed approvals. `apps/indexer` builds a disposable finalized-event projection. `packages/operations` owns PostgreSQL migrations, sessions, durable operation records and service heartbeats. The indexer is never the authority for execution.

The six contracts are deployed on Monad testnet; public addresses are recorded in [`deployments/monad-testnet.json`](../deployments/monad-testnet.json). The core API uses Railway PostgreSQL and serves the Cloudflare Workers Static Assets Console. Managed credentials, evidence storage, the GitHub gateway, and model runs require configured cloud secrets before they can be offered as live features. Current fund handling is limited to testnet tokens and the controlled transfer and funded single-milestone obligation slice.
