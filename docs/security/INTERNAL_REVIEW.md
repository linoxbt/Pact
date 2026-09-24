# Internal security review and release register

This is a project self-review, not an independent audit or a claim of production safety. Review scope is the current working tree. An external reviewer must receive a pinned commit and repeat the review against that exact revision.

## Reviewed controls

| Area | Control inspected | Local evidence |
| --- | --- | --- |
| Contracts | Exact reservation and approval signatures, delegation capacity, revocation, obligation state and escrow conservation | Foundry suites in `packages/contracts/test` |
| API | Wallet challenge sessions, principal and agent scope, live-chain approval and evidence checks | API route and PostgreSQL integration tests |
| Approval inbox | Exact intent, reservation and expiry; EOA/ERC-1271 typed signature verification; conditional state transitions | `apps/api/test/approvals.test.mjs` |
| Evidence | Per-object KMS data key, AES-256-GCM with context-bound AAD, private S3 object, digest verification, authenticated read | `packages/security/test/security.test.mjs`, `apps/api/test/evidence.test.mjs` |
| Provider credentials | Secrets Manager read with short cache, no token returned to caller | `packages/security/test/security.test.mjs`, gateway tests |
| Operations | Finality before confirmation, idempotent operation storage, reorg rebuild, worker/indexer heartbeats | Worker, indexer and operations tests |

## Open findings and verification work

| ID | Priority | Finding | Required closure evidence |
| --- | --- | --- | --- |
| IR-01 | Release blocker | No independent contract/application security assessment. Self-review cannot sign off on custody. | Named external reviewer, scoped report on a pinned commit, remediation and retest letter. |
| IR-02 | Release blocker | The AWS adapter has mock-based tests but no test using the target account's real KMS, S3, Secrets Manager, IAM and bucket policies. | Disposable cloud integration exercise proving authorized access and denial of cross-role access, object tamper detection, token rotation and recovery. |
| IR-03 | Release blocker | No Monad deployment, approved token list, trusted RPC configuration, finalized deployment addresses or live-funds incident drill is recorded. | Deployment record, asset review, canary, rollback and incident/restore drill results. |
| IR-04 | Medium | If S3 upload succeeds but database metadata insertion fails, the API tries to delete the orphan. The example API role intentionally lacks `s3:DeleteObject`, so cleanup will fail and require an operator to remove the unreferenced object. | A scheduled, separately authorized orphan reconciliation process and an alert on cleanup failure; verify retention requirements before deletion. |
| IR-05 | Medium | Evidence is capped at 5 MiB and fetched as one object into memory. A production load test has not established safe concurrency and memory limits. | Load test under the chosen container memory limit and ingress request limits; set worker limits or switch to bounded streaming. |
| IR-06 | Medium | Evidence retention, KMS key lifecycle and backup restore are policy decisions, not encoded in the repository. Losing the key makes retained evidence unreadable. | Approved retention schedule, key deletion controls, bucket versioning/Object Lock decision and a documented restore drill. |

No open item above is an assertion that a vulnerability has been exploited. The independent reviewer should add findings to this register with affected revision, severity, proof and retest status. IR-01 through IR-03 block real-funds release.

## Handoff package

Give the reviewer this register, `INDEPENDENT_AUDIT_HANDOFF.md`, `SECURITY.md`, the architecture and operations runbooks, the pinned source commit, full lockfile, contract compiler settings, deployed bytecode when available, test commands/results, and a list of deployed roles, endpoints, RPCs, assets and contracts. Do not substitute a green test run for the external report.
