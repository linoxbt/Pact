# Product build sequence

This is a product infrastructure roadmap, not a hackathon submission checklist. Each stage has an exit gate.

| Stage | Deliverable | Exit gate |
| --- | --- | --- |
| 1. Protocol foundation | Immutable grant, ledger, controlled account, funded obligation, vault, receipt anchor | Local contract tests cover delegation, capacity races, replay, revocation, dispute, refund and settlement. **Implemented locally.** |
| 2. Developer verification | Canonical schemas, TypeScript SDK, independent RPC proof reader | Hashes match Solidity and a real local-chain reservation verifies without a Pact API. **Implemented for the current slice.** |
| 3. Service platform | Authenticated API, policy versions, durable operations, idempotency, reconciliation, encrypted evidence, indexed reads | API, worker, reorg-aware indexer and KMS-wrapped encrypted S3 evidence implemented locally. Cloud validation and restart/restore drills remain. |
| 4. Agent integration | Credential-isolating API gateway, one bounded provider adapter, MCP server, Python SDK | GitHub read gateway, AWS Secrets Manager provider, MCP server and Python SDK implemented locally. Cloud IAM and adversarial egress tests remain. |
| 5. Product surfaces | Principal Console and public Explorer | Root grants, signed policy, full exact-transfer approval inbox, obligation lookup, operation list, public disclosed grants and receipts implemented locally. Full obligation management workflows remain. |
| 6. Production hardening | Invariant fuzzing, security audit, deployments, monitoring, runbooks, asset governance | Container build, health heartbeats, status probe, IAM templates, runbook and audit handoff exist. External audit, live deployment, alarms, restore drill, asset governance and go/no-go review remain. |

Current constraints are intentional: one asset per grant, one fixed recipient, one funded milestone, named verifier and arbitrator, no arbitrary contract adapter, and no claim of independent evidence truth. Decisions on network, asset, custody recovery, dispute process and upgrades must be recorded before real funds are used.
