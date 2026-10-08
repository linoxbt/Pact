# Live agent verification — 8 October 2026

Actual model inference, live gateway requests and Monad testnet transactions. This is a bounded test deployment, not a production-readiness certification.

## Deployment and identity

- Railway actor: https://pact-worker-production.up.railway.app/health
- Agent ID: `b167cdf0-1183-497b-a3f8-4f16f1133bc0`
- Operational signer: `0x17dEf9FcC139Cf0EeD9781F08c190A4e824C5025`
- Dedicated owner: `0xb2cee603045240187DcE7e1F21bCA69F63e40cea`
- Pact account: `0x807A24D7D055ea9a732a64896D744f5afE5f80D2`
- Chain: Monad testnet, `10143`. Token: `0xd3480c3a995e158f700e3f669c0134da3eaa2e14`, six decimals, valueless test fixture.
- Model: Cloudflare Workers AI Llama 3.1 8B. Model calls also passed through Pact with protected upstream credentials. No Codex session credentials were exported.
- Agent is in a separate dedicated test account, not the user’s account. Private activity cannot appear in a different owner’s Console.
- Railway Free refused a sixth service. The actor runs as a supervised process alongside worker/runner. It receives an explicit environment allowlist, but the shared container is **not a security isolation boundary**. Do not use this placement for untrusted production workloads.
- Tasks expire on 2026-10-10T10:03:07.733Z. The test upstream expires after 30 minutes; refresh it before another run. Onchain test grants were revoked after verification.

## Individual results

| Area | Check | Result |
| --- | --- | --- |
| provision | Real Privy account receives its own principal without a wallet onboarding step | passed |
| provision | Grant automatically uses account principal | passed |
| provision | Agent, grant, policy, endpoints, encrypted upstream credentials and scoped key created through public API | passed |
| http | Railway deployment health and distinct operational identity | passed |
| http | Real model tool use: Check the upstream health. | passed |
| http | Real model tool use: Test a forbidden delete of the health endpoint. | passed |
| http | Real model tool use: Request an update of the test upstream. | passed |
| http | Complete SDK verification with all gateway calls executed by Railway actor | passed |
| http | Read secret metadata and key details never return stored secrets | passed |
| http | Endpoint disable prevents upstream execution | passed |
| http | Service disable prevents upstream execution | passed |
| http | Agent disable prevents upstream execution | passed |
| http | Rate limit boundary | passed |
| http | UTC time window boundary | passed |
| http | OpenAPI preview and import create real endpoint records | passed |
| http | Key expiry enforced | passed |
| http | Owner-scoped dashboard, activity filters, decision detail and audit trail | passed |
| boundaries | Dynamic request amount within exact minor-unit budget | passed |
| boundaries | Per-action spending limit | passed |
| boundaries | Currency bound | passed |
| boundaries | Recipient bound | passed |
| boundaries | Reject floating-point amounts | passed |
| boundaries | Policy aggregate spending bound | passed |
| boundaries | Write retry does not duplicate upstream execution | passed |
| boundaries | Exact grant aggregate boundary accepted | passed |
| boundaries | Grant aggregate budget rejects next request | passed |
| boundaries | Grant editing cannot expand existing authority | passed |
| boundaries | Explicit principal migration revokes original and preserves its historic owner | passed |
| chain | Owner-specific Pact account deployed | passed |
| chain | Onchain owner grant binds agent, token, recipient, ceiling and per-action limit | passed |
| chain | Unreserved transfer denied | passed |
| chain | Foreign actor cannot reserve authority | passed |
| chain | Per-action limit enforced onchain | passed |
| chain | Intent reservation replay denied | passed |
| chain | Real transfer settlement and recipient balance | passed |
| chain | Transfer nonce replay denied | passed |
| chain | Above-threshold transfer requires owner signature | passed |
| chain | Exact owner approval permits above-threshold transfer | passed |
| chain | Revoked onchain grant rejects new reservations | passed |
| chain | Public API hides authority without signed disclosure | passed |
| obligation | Railway agent reserves exact signed obligation capacity | passed |
| obligation | Mutually signed obligation created | passed |
| obligation | Escrow funded with actual six-decimal test tokens | passed |
| obligation | Provider evidence and distinct verifier verdict recorded | passed |
| obligation | Settlement paid provider and receipt root independently recomputes | passed |
| obligation | Public receipt API agrees with canonical chain | passed |
| clients | Real MCP stdio discovery, authority, allowed and denied proxy tools | passed |
| clients | Real Python SDK allowed and denied gateway calls | passed |
| fixes | Live PATCH preserves response disclosure fields | passed |
| fixes | Live duplicate OpenAPI import returns conflict without partial mutation | passed |
| fixes | Live account exposes verified individual principal, deployed account and audited history | passed |
| operations | Indexer persisted 21 matching chain events and the new account | passed |
| operations | Worker, runner and indexer heartbeats; finalized-head lag check | passed |

51 recorded scenario checks plus two operational checks. The SDK verification scenario contains additional individual scope, approval, rotation, revocation, redaction and activity assertions. Machine-readable evidence: [JSON report](2026-10-08-live-agent.json).

## Transactions

| Action | Monad testnet transaction |
| --- | --- |
| Create unique Pact account from real API preparation | [0x4c5eaa4bdb…](https://testnet.monadexplorer.com/tx/0x4c5eaa4bdb25480242c4160a6cf79c109c1b8d23f4182e9fea0c50edae0e51ee) |
| Deploy six-decimal valueless test token | [0xd755e53ea6…](https://testnet.monadexplorer.com/tx/0xd755e53ea632b436ebe6dcf052adcecb337106f740f4691a5c343f4cf1829d51) |
| mint | [0x5966b9c959…](https://testnet.monadexplorer.com/tx/0x5966b9c959810af720ccaada40188aa4425d2fbfdf36a2fd7cd630b42b29dc0c) |
| createRoot | [0xc73ec4b44d…](https://testnet.monadexplorer.com/tx/0xc73ec4b44d665dc611f91c5dc9458a32b54cf6fc3c2d4d2c0f82c0d91d485a0f) |
| Railway agent reserves transfer capacity | [0x2e2f4d3af1…](https://testnet.monadexplorer.com/tx/0x2e2f4d3af1e9529654cad9797d17523c4a44f7c7c8f0e7de4f5df3a33f3a17b8) |
| Railway agent executes authorized test-token transfer | [0xe3b1ac37e4…](https://testnet.monadexplorer.com/tx/0xe3b1ac37e4e44c1c6e3ac5d9add76f560837ea8b8666d0adafb3c2c0071d7c91) |
| Railway agent reserves approval-sized transfer | [0x411f149b72…](https://testnet.monadexplorer.com/tx/0x411f149b72f0a33f9ddeef3ea48d1239af6db2592c94d7aa9f3805512eb06d9d) |
| Railway agent executes owner-approved transfer | [0x8964f5113e…](https://testnet.monadexplorer.com/tx/0x8964f5113e6a8e9738c956c290c67beb15b65fecf7681996501d195353145e49) |
| revoke | [0xdca5ddb3d0…](https://testnet.monadexplorer.com/tx/0xdca5ddb3d0f187567b061ef5abafb891fedaea16495c812f55cf05a8c87766b2) |
| Fund isolated test role | [0xaef1ca9f2d…](https://testnet.monadexplorer.com/tx/0xaef1ca9f2dc63391266feadffde2c8545bd70e96a20fb2144440f134e79223f4) |
| createRoot | [0x46e59cd624…](https://testnet.monadexplorer.com/tx/0x46e59cd624e257b04bd00bb2a2a3050d5d39475bfb3294c0a9cbcf482d59ba8b) |
| Railway agent reserves liability | [0x6223552e12…](https://testnet.monadexplorer.com/tx/0x6223552e1217059ded781d5b7669ba818b981b70e5d7a2b9b4f37de142acf8c4) |
| create | [0xe5af439c77…](https://testnet.monadexplorer.com/tx/0xe5af439c77ea2394aefaa8b7eae2b9525dfc4ccc3710d78a76f68d4f9bcbd1b0) |
| approve | [0x19c377b58c…](https://testnet.monadexplorer.com/tx/0x19c377b58c8b99e11ca567b706c0668123aa8cd5f49595a09372d411b22e7ae5) |
| fund | [0x93f33f03c4…](https://testnet.monadexplorer.com/tx/0x93f33f03c44f1f508c4aaf1374d3ae9bdff5ffaefdd11288162714cb012211a2) |
| submitEvidence | [0xa0c63fdc28…](https://testnet.monadexplorer.com/tx/0xa0c63fdc2870673d6de0569ddad3ddd1283de7b41e6e4250f9a1525249aaecf0) |
| verify | [0xf444fbc610…](https://testnet.monadexplorer.com/tx/0xf444fbc610ab53f3d69a1b4cf3741d1de1efdee855ea0ef53e3dc2dd93677986) |
| Permissionless obligation finalization | [0x9c29334fe1…](https://testnet.monadexplorer.com/tx/0x9c29334fe133e925c38b931fa6972e65b33fd8af631981596d5ac8c0942bc380) |
| Revoke completed obligation authority | [0xee81adc9e3…](https://testnet.monadexplorer.com/tx/0xee81adc9e3b364dec2c225840f1fedb5632123e24b54ffe085e795040e2161e9) |

Receipt: [Pact public receipt API](https://pact-api-production-2ab9.up.railway.app/v1/receipts/1). Its root was recomputed from canonical receipt fields and matches the contract. HTTP activity is private database activity; it is not itself an anchored receipt. Evidence/provider/verifier roles use distinct controlled test keys; the test does not prove real-world delivery or independent assessment. The obligation used a three-second test challenge window.

## Live-discovered fixes

| Problem | Fix |
| --- | --- |
| IPv6 mapped-address block list also blocked public IPv4 | Separate IPv4 and IPv6 block lists; retain private/metadata/translation denials. |
| Node 22 automatic address selection rejected pinned DNS lookup | Disable automatic family selection for the already validated pinned address. |
| PATCH defaults cleared disclosure fields and recipient restrictions | Remove creation defaults from optional update fields. |
| Duplicate OpenAPI import returned 500 | Transaction rolls back and returns a specific 409 conflict. |
| SDK/MCP discarded policy denial reason | Preserve the gateway reason in TypeScript, Python and MCP errors. |

## Regression evidence

- Complete monorepo suite run with the disposable PostgreSQL database; no skipped database tests. Foundry: 21 passing contract tests including fuzz coverage. Python: six passing tests.
- New agent authentication/egress restrictions and model-helper expiry/body-limit tests passed.
- Console browser integration passed against real local API/database/gateway/upstream. **Its Privy identity is mocked**; this is separate from the genuinely authenticated Privy identity used for the live API tests.
- Live gateway and deployed API regressions passed; actual MCP stdio and Python clients exercised live allowed and denied requests.
- Early live failures are described above and were rerun after fixes. Initial native transfers exposed underestimated testnet gas; test funding uses a margin/minimum. The owner later lacked finalization gas; the permissionless finalizer completed settlement using the remaining funded test deployer.

## Conditional or not proven live

- AWS KMS/Secrets Manager/S3 evidence and disaster recovery not configured or live-tested
- Email OTP and passkey recovery require a real mailbox/authenticator session; real Privy wallet authentication tested
- Paid provider managed-runner billing not exercised; real Llama model used through protected gateway
- Mainnet intentionally not exercised
- Arbitration, timeout, reorg and concurrency failure paths covered by automated tests, not every branch broadcast live

No claim that every possible failure mode or every production integration has passed a live test. These dependencies prevent a blanket production-ready conclusion.

See [reproduction and custody notes](../operations/LIVE_AGENT_TEST.md).
