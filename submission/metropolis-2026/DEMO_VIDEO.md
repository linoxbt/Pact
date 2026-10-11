# Pact demo video · 3:00

**File:** `Pact-Demo-3min.mp4`. Ten 18-second Brag/Hyperframes chapters are joined into one caption-led film with music. The script below can be recorded separately as a human voiceover; the rendered film does not use a synthetic narrator.

The film shows captures of the public live product, documentation, Explorer and the recorded October 8 testnet evidence. It does **not** represent a newly authenticated Console run. The historical test actor expired and its grants were revoked. For a fresh gateway walkthrough, use `ENTRY.md` and `docs/verification/2026-10-08-live-agent.md`.

| Time | Visual | Spoken script |
| --- | --- | --- |
| 0:00–0:18 | Live product and the problem | “An autonomous agent can call an API or move funds. Who authorized that action, and what may it commit?” |
| 0:18–0:36 | Developer documentation | “Pact puts an enforceable boundary before the action. Register an agent and operation. The owner supplies a grant; ordered policies decide each request.” |
| 0:36–0:54 | Connect workflow | “Register an endpoint and put the provider credential in Pact’s vault. The agent receives a scoped Pact key, never the upstream secret.” |
| 0:54–1:12 | Gateway decision | “The gateway authenticates the key, checks the grant and policy, then forwards an allowed request with the protected credential.” |
| 1:12–1:30 | Denial | “A forbidden method or path is rejected before forwarding. The upstream never receives a denied request.” |
| 1:30–1:48 | Activity trace | “The private Activity view records agent, operation, matched rule, reason, request ID and outcome. HTTP events are operator records, not blockchain receipts.” |
| 1:48–2:06 | Monad authority | “Owner-specific Monad testnet grants limit agent, token, recipient, per-action amount and total capacity. Contracts reserve exact capacity and enforce approval thresholds.” |
| 2:06–2:24 | Obligation lifecycle | “The implemented obligation path covers one funded milestone: signed terms, escrow, evidence, named verifier verdict and settlement.” |
| 2:24–2:42 | Public Explorer and receipt | “A Railway agent completed this flow on October eighth. Its receipt root checks against Monad testnet. That run is historical; the actor later expired and grants were revoked.” |
| 2:42–3:00 | Product, SDK, MCP and source | “Pact is open source. Reproduce the boundary with the Console, TypeScript or Python SDK, curl, MCP tools and the local demo upstream.” |

## Fresh hands-on recording path

1. Create an agent, GET endpoint, grant, ordered policy and scoped key on Monad testnet. The current fee is 5 testnet MON per core action, plus gas. Hide the one-time key secret.
2. Call an allowed GET through Pact, then a forbidden method/path. Show the denial and verify no upstream hit for the denied request.
3. Open both Activity records and the decision traces. Revoke the key and show subsequent authentication failure.
4. Open public receipt 1 and linked Monad testnet transactions. State that this is the earlier October 8 obligation unless a new chain run was completed.

Do not splice historical private events into a new account view or imply the receipt proves real-world delivery.
