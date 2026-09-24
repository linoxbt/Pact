# Independent security audit handoff

Pact has **not** received an independent security audit. This document defines the scope and acceptance criteria for an external firm or reviewer. Internal implementation and self-review cannot satisfy the independence requirement.

The current self-review and unresolved release items are in [INTERNAL_REVIEW.md](INTERNAL_REVIEW.md). Supply both documents to the reviewer with a pinned source commit.

## Scope to quote and review

1. All six contracts in `packages/contracts/src`, the deployment script, Foundry tests and onchain accounting invariants. Inspect principal/agent separation, delegation ancestry, capacity conservation, exact reservations, replay, signatures including ERC-1271, escrow funding, verifier/arbitrator powers, disputes, refunds and receipt integrity.
2. `packages/schemas`, `engine`, `proofs`, `sdk-ts` and `sdk-python`: EIP-712/domain parity, numeric and canonical encoding, offchain proof accuracy, unsafe assumptions and transport boundary.
3. API, gateway, operations, worker, indexer, runner and MCP: authentication/session replay, principal-signed agent key issuance, key revocation and onchain binding, actor scopes, idempotency, approval races, transaction finality, reorg recovery, upstream credential isolation, exact custom-model endpoint approval, SSRF/redirect controls, request budget atomicity, logging and sensitive data handling.
4. Evidence and provider credential pipeline: KMS encryption context, data-key lifetime, AES-GCM AAD, S3 object integrity, IAM scope, tenant separation, unauthorized read/write tests, backups, rotation, retention and orphan cleanup.
5. Console and Explorer: wallet signing prompts, exact terms shown to the principal, session storage, public disclosure, XSS, CORS/CSP and transaction status labels.
6. Testnet billing: six-decimal asset verification, receipt finality and canonical block check, duplicate deposit prevention, principal binding, rate provenance, 20% markup calculation, atomic balance reservation/settlement, worker crash and concurrent-run recovery, refund correctness, treasury custody and disclosure.
7. Deployment and operations: config validation, least-privilege IAM, TLS, database backup/restore, image provenance, monitoring, incident response and chain/asset choices.

## Required auditor deliverables

- A signed report naming firm/reviewer, reviewed commit hash, exact contract bytecode/compiler settings, dates, threat model, methodology and explicit scope exclusions.
- Findings with severity, exploit preconditions, concrete reproduction or reasoning, affected source/line, recommended fix, and remediation verification.
- Property/invariant test artifacts and tool versions. At minimum: capacity conservation, one-time reservation consumption, exact signature binding, agent revocation, obligation state transitions, escrow conservation, finality/reorg correctness and evidence confidentiality/integrity.
- A retest letter for every high/critical finding, plus a residual-risk register signed by the project owner. Any critical/high finding stays a release blocker until independently verified fixed.

## Material known limitations supplied to the auditor

- Only one token and fixed recipient per grant; one funded obligation milestone. Arbitrary contract calls are unsupported. Managed model runs are one-shot text tasks without autonomous tools. Pact-funded model credit is testnet-only and is disabled in production mode.
- Offchain policy preview is advisory. Current contracts enforce the listed narrow transfer and obligation constraints, not arbitrary policy JSON.
- Receipt hashes prove recorded state, not the truth of private evidence or legal enforceability. Named verifier/arbitrator actions remain trust assumptions.
- The operator can access managed secrets and, with KMS permissions, decrypt evidence. Organizational controls and IAM separation are part of the review.
- Managed run prompts and outputs are currently stored in PostgreSQL without application-level envelope encryption. The database backup and access model must be reviewed before processing confidential tasks.
- No live Monad deployment, approved asset list, custody recovery or production incident drill is recorded yet.

## Release gate

The external report, remediation commits, retest letter, asset/network decisions, operational restore drill, and go/no-go approval must be linked in a release record. Until then, describe Pact as unaudited local infrastructure and keep real-fund custody disabled.
