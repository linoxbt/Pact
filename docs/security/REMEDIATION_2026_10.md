# October audit remediation

Baseline: `1bbd0026b49ec7cbf05555935c4e4eeff5c9dea7`.
Status is evidence-based: a source fix is not a verified deployment.

## Follow-up: mainnet and live verification (8 October)

- Removed the legacy API's implicit shared principal/account response. Public configuration now returns null account/principal; a requested owner resolves to their factory account, with an explicit owner match check. Historical testnet manifests retain their immutable deployment facts and are not onboarding defaults.
- Added factory-only mainnet deployment: no shared principal and no bootstrap user account. Mainnet fork simulation passed (six contracts and configuration, estimated 1.567959754 MON at observed prices). Broadcast remains pending deployer funding; no mainnet deployment is claimed.
- Added the Console enforcement verification flow and a reusable TypeScript SDK helper. Real local HTTP/database integration and browser checks passed allow/deny, zero upstream forwarding for denied/pending requests, protected credential injection, response redaction, exact approval, key rotation, grant/key revocation and activity request attribution. Browser identity remains an explicit local Privy fixture.
- Hosted identity testing requires a signed-in user. A provider-backed model run requires a dedicated provider credential; this Codex session supplies no reusable API key. AWS configuration and recovery remain operator gates.

## Sequence

1. Contract authorization and settlement invariants; SDK credential isolation.
2. HTTP authorization, concurrency, approvals, execution accounting and ingress protection.
3. Worker/indexer correctness, retention, recovery and integration configuration.
4. Account signing, Console workflows, SDK/MCP parity and documentation.
5. Full regression checks, deployment verification and release decision.

| ID | Finding | Status | Verification |
| --- | --- | --- | --- |
| S1 | Deployed arbitration timeout | Testnet runtime and API cutover verified | All seven compiled runtimes and contract links match; ARBITRATION_TIMEOUT=2592000 seconds; old next grant/reservation/obligation IDs were all 1 |
| S2 | Cross-grant intent poisoning | Testnet runtime verified | Grant-scoped replay regression, 256 fuzz cases and deployed runtime match |
| S3 | False escrow release | Testnet runtime verified | Dishonest token cannot release escrow; deployed runtime match |
| S4 | Shared policy quota race | Source verified | Eight concurrent grants share one quota; exactly one forwards |
| S5 | Approval authority binding | Source verified | Old policy versions and changed endpoint policies cannot consume approval; fresh approval executes once |
| S6 | Inspectable approval intent | Backend verified; owner intent UI wired | Encrypted immutable request details decrypt only through owner endpoint; body absent from audit/activity |
| S7 | Console identity isolation | Browser verified | Identity-keyed remount, cancelled requests, token-subject check, ephemeral state reset |
| S8 | Python owner-token redirects | Source verified | Cross-origin HTTP redirect server receives no credential; all 5 Python tests passed |
| S9 | Public ingress abuse limits | Source verified | Atomic IP, credential and owner minute quotas; concurrent quota regression passed |
| S10 | Sensitive paths in logs | Source fixed | API/gateway log route templates and sanitized error names; integration logs inspected |
| S11 | Dependency advisories | Verified | pnpm audit: zero advisories across production and development dependencies |
| B1 | Legacy API routing | Deployed and public config verified | Legacy and current Console requests share the active API origin |
| B2 | Account-specific approvals | Source verified | Approval test rejects global-account verification and uses per-grant signing domain |
| B3 | Reconciliation starvation | Source verified | 101 unresolved operations all receive attempts; atomic leases and bounded backoff |
| B4 | Proxy execution ambiguity | Source verified; worker deployed | Concurrent idempotency test forwards once and charges once; persistent unknown/not-forwarded states |
| B5 | Invalid narrowed grants | Source verified | Incoherent amounts and expiry rejected; gateway suite passed (5 tests) |
| B6 | Concurrent credential creation | Source verified | Eight concurrent first writes leave a decryptable credential |
| B7 | Activity gaps/stale filters | Browser verified | Sequential polling, generation checks, backfill intervening pages, refresh older pending outcomes |
| B8 | Approval inbox freshness | Browser verified | Sequential five-second approval polling and expiry of pending/approved requests |
| B9 | Origin normalization | Source verified | Canonical origins for new and existing grants/policies; mixed-case/default-port regression passes |
| B10 | Request error status codes | Source verified | Real Fastify malformed JSON and unsupported media requests return 400/415 |
| B11 | Partial service setup | Browser verified | Created service remains visible and selected after credential failure; explicit recovery message |
| B12 | Factory account indexing | Deployed; catch-up verified | Factory creation replay after configuration change and same-batch account discovery regression pass |
| M1 | Per-user on-chain signing | Source verified; hosted signing verification pending | Per-user embedded signer proof, factory deployment flow and account-specific legacy configuration |
| M2 | Hosted runner deployment | Deployed; live heartbeat verified | Supervised worker/runner pair uses existing Free Railway service; runner heartbeat added |
| M3 | Production secrets/evidence/recovery | Operator configuration required | No AWS profile available; deployment remains staging. Production cloud evidence, IAM and restore drill are not falsely marked complete. |
| M4 | Request economic constraints | Source verified | Real gateway rejects excessive minor units, wrong currency and recipient; Console fields wired |
| M5 | Exact transaction simulation | Source verified | Exact prepared transfer eth_call with pinned block/sender; SDK regression passes |
| M6 | Management editing/pagination | Browser/database verified | Stable cursor pagination including tied timestamps; 1000-resource quota regression; agent editing and endpoint policy assignment |
| M7 | SDK/MCP/examples parity | Source verified | Gateway-only MCP exposes only proxy and HTTP authority tools; TS/Python cursor, query and idempotency support |
| M8 | OpenAPI import limitations | Source verified | Base paths/local refs supported; unsupported remote refs fail explicitly; import regression passes |
| P1 | Audit storage growth | Source verified; worker deployed | Usage-only updates no longer create audit events; hourly retention; resource caps and indexed queries |
| P2 | Total upstream deadline | Source verified | Continuously dripping upstream is aborted by total deadline; gateway regressions pass |
| P3 | Workspace loading resilience | Browser verified | Independent collection requests preserve successful sections; actionable retry |
| P4 | Frontend API types | Source verified | Console uses explicit account, agent, grant, policy, service, endpoint, approval and activity types; strict tsc passes |

## Release decision

Not production-ready for live funds or confidential production workloads. The verified testnet release remains explicitly staging; operator-dependent release gates are listed below. Deployment and integration evidence is scoped to the checks actually performed.

## Verification evidence

- `pnpm check` passed: complete build, strict types, ABI drift check, Solidity formatting, 21 contract tests (including 256 fuzz cases), 5 Python tests.
- `PACT_TEST_DATABASE_URL=... pnpm test` passed: 57 Node test groups, 5 Python tests, 21 Solidity tests. All database regressions ran; none were skipped.
- Follow-up gateway suite passed all 14 tests after the approved-request idempotency regression was added.
- `node apps/console/test/browser.mjs` passed against a real local API, gateway, PostgreSQL and HTTP upstream. Covered agent registration, review, key issue, allow/deny, redaction, live activity, revocation, sidebar persistence and account isolation. Only Privy identity is replaced in this test. It does not certify hosted email/passkey delivery or recovery.
- Dependency audit returned zero advisories, including build dependencies.
- `scripts/verify-contract-release.mjs` matched all seven deployed runtimes (excluding separately verified immutable slots) and contract links on chain 10143. Arbitration timeout is 2,592,000 seconds. Old next grant/reservation/obligation IDs were each 1, so there was no old grant exposure to migrate.
- Cloudflare Console version: `50caf59c-cb52-4b2b-b50d-76933449fd19`.
- Railway API deployment: `92328cbc-c52d-4403-a360-2287bcd8a8a2` observed SUCCESS. All existing Pact application services subsequently reached SUCCESS; final IDs follow.

## Remaining operator-dependent release gates

Production KMS/S3/Secrets Manager/IAM, a real cloud backup/evidence restore drill, hosted Privy sign-in/recovery and a real credential-backed model run still require operator configuration or authenticated user participation. No AWS account/profile was found on this machine. Staging remains explicit; no mainnet deployment or paid-plan upgrade was performed. These are not marked complete by local tests.

- Extended browser checks also passed approval inspection, automatic expiry, injected credential-storage failure recovery and independent workspace loading.
- Live worker/runner heartbeat verified via private Railway SSH. Indexer catch-up lag was observed; historical header fetching is now bounded and the four indexer regressions pass. Live probe subsequently reported healthy=true, no faults, and four blocks of lag; runner, worker and indexer heartbeats were current.

## Final hosted release verification

| Service | Deployment/version | Result |
| --- | --- | --- |
| API | `92328cbc-c52d-4403-a360-2287bcd8a8a2` | SUCCESS; public readiness 200; corrected contract configuration returned |
| Gateway | `1eaa66de-297f-4a6c-8daa-ea17ee588a1d` | SUCCESS after retry; public readiness 200 |
| Worker + runner | `eecdaacd-22c8-4a12-8e66-1dab35e86902` | SUCCESS; both live heartbeats current |
| Indexer | `558d2c14-5633-4539-94d5-7e0353f10efc` | SUCCESS; caught up to four blocks behind finalized head |
| Cloudflare Console | `50caf59c-cb52-4b2b-b50d-76933449fd19` | Published at the existing workers.dev URL |

GitHub CI passed on `506896770842bf867b923526df20fd2882b59195`: [run 37683546871](https://github.com/linoxbt/Pact/actions/runs/37683546871). This includes the complete workspace checks, all database tests and the extended browser integration. The prior run failed to launch the runner's preinstalled Chrome; CI now explicitly provisions Chrome for Testing and uses its reported binary path.

No remaining critical/high code defect was reproduced in the covered audit regressions. This is not a claim that all possible defects are absent. The remaining production release gates are AWS cloud configuration/recovery, real hosted identity/recovery verification and a credential-backed managed-model run. These require operator resources or user participation, so the production audit is not marked completely clean.
