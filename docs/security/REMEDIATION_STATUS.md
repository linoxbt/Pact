# Remediation status (2026-10-04)

This records implementation evidence and remaining release blockers. A passing test suite proves only the covered behavior; it does not establish that the live testnet deployment or production cloud controls are complete.

## Fixed in the current change

| Area | Change | Verification |
| --- | --- | --- |
| Wallet-free HTTP onboarding | A unique account-assigned principal is created on first authenticated use. HTTP grants can use it; Monad transaction preparation still requires proof of an external signing address. | Database-backed owner authentication and gateway flow tests |
| Grant update race | Narrowing is checked and written while holding the grant row lock. | Concurrent update test |
| HTTP grant migration | Old grant is revoked, endpoints are rebound, and used budget is preserved in one transaction. | Database-backed migration test |
| Control-plane audit | Minimal mutation events are written by database triggers in the same transaction; owners can read their own history. | Database-backed trigger and API test |
| Proxy routing and disclosure | Specific operations take precedence; ambiguous matches fail closed. Credential-protected responses expose only selected JSON fields and redact exact credential forms. | Gateway selection and proxy tests |
| Operational behavior | Account reads tolerate Monad RPC outages; live activity polling retains loaded pages and reports stale data; policy usage is fetched in one query. | Build, type checks, gateway tests |
| Client integration | TypeScript and Python SDKs expose owner control operations; Python proxy calls support text responses. | Workspace and Python tests |
| Obligation timeout | A challenged escrow can be refunded after an arbitrator timeout in newly deployed contract code. | Foundry timeout test |

## Remaining release blockers

| Severity | Issue | Required completion |
| --- | --- | --- |
| Critical | The deployed Monad `ObligationManager` bytecode predates the arbitrator timeout fix. An escrow governed by that deployment can still remain locked if its arbitrator does not act. | Deploy and verify a new manager, migrate or close old exposure under an explicit chain plan, then exercise the timeout on testnet. |
| High | The Railway testnet project has no `pact-runner`. `railway add --service pact-runner` returned `Free plan resource provision limit exceeded` on 2026-10-04. Model runs cannot be processed. | Increase Railway capacity, provision the runner with referenced core variables and staging vault, deploy, and run an end-to-end model task. |
| High | The live deployment has no verified production KMS, S3, Secrets Manager, IAM, backup restore, or provider credential exercise. The current Railway project deliberately uses `PACT_ENVIRONMENT=staging`. | Provision isolated cloud resources and execute the documented integration and recovery checks before a production release. |
| High | A browser-level authenticated sign-up to activity test against the deployed Privy, Railway and Cloudflare stack has not been executed for this revision. | Deploy this revision, test a fresh user and the complete allowed/denied/revoked flow in a real browser, and retain evidence. |
| High | Public API and gateway traffic still depend on platform edge controls for distributed abuse protection; no tenant/IP request limiter is configured in this repository. | Add and verify distributed rate limiting on public ingress with a policy that preserves legitimate agent traffic. |
| Medium | Authenticated upstreams can intentionally return credential-derived values in a selected response field. Exact, JSON, URL and base64 forms are redacted, but arbitrary transformations cannot be detected. | Treat selected fields as a trust boundary; constrain them to reviewed upstream schemas and document approval for each operation. |
| Medium | Policy rules are readable JSON in PostgreSQL and detailed audit entries. | Decide whether policy metadata is confidential and encrypt or minimize it according to the resulting classification. |
| Medium | The broader economic lifecycle is separate from the HTTP proxy activity log; an HTTP event is not an on-chain receipt. | Implement and test an explicit anchoring flow before claiming independently verifiable gateway activity. |

## Release decision

The current code is **not production-ready**. Do not describe the private HTTP activity log as an anchored receipt or the staging vault as a production KMS integration. The fixed items require deployment and live verification before they can be called complete in the hosted product.
