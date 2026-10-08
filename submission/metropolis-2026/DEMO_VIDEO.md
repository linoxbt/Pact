# Demo video — maximum 3 minutes

**Goal:** show the working product rather than slides or source code. Use an account and testnet resources that you control. Refresh the expiring test agent/upstream before recording; the October 8 historical run is not a live interactive demo anymore. Prepare and fund the account before capture, because creation payments and chain finality can outlast a three-minute recording. Keep each cut honest: show real saved records and successful requests, not simulated UI states.

| Time | Picture and action | Suggested narration |
| --- | --- | --- |
| 0:00–0:20 | Open live Pact site; sign in to the prepared Console. Show Overview with the deployed agent and its recent activity. | “Pact is an enforceable authority layer for autonomous agents. This is the live testnet product and an agent we deployed.” |
| 0:20–0:45 | Open agent detail, registered service and enabled GET endpoint. Show grant owner, agent, currency, amount bound, and policy rule order. Keep secrets hidden. | “The owner grants bounded authority. The agent gets a scoped Pact key and can call only registered operations under these ordered rules.” |
| 0:45–1:15 | Run a real allowed GET through the gateway, then a forbidden method or path. Show response codes and the local/upstream hit counter if available. | “Pact evaluates before forwarding. The allowed request reaches the service. The denied request stops at the gateway, so the service never sees it.” |
| 1:15–1:40 | Open Live Activity and both request details. Show agent attribution, matched rule, reason, request ID, upstream status, and policy decision trace. | “Both attempts appear in live activity with the exact reason for the decision. The activity is an operator record; it is not a blockchain proof.” |
| 1:40–2:00 | Show approval threshold and one owner-approved testnet action or recorded approval. Show the exact grant and reservation in the live record. | “For value-moving actions, the onchain grant reserves exact capacity. Above-threshold execution requires an owner approval.” |
| 2:00–2:30 | Open public Explorer/receipt and the linked Monad testnet transactions: reserve, create/fund obligation, verdict, settle. | “A funded obligation records terms, evidence and a named verifier verdict. Settlement produces this receipt root, which can be checked against Monad.” |
| 2:30–2:50 | Revoke the scoped agent key and retry the same gateway call; show authentication failure. | “Revocation cuts off the agent credential. It cannot keep using the integration after the owner removes access.” |
| 2:50–3:00 | Return to live product URL and repo/docs on screen. | “Developers can reproduce the flow with the TypeScript or Python SDK, MCP tools, and a local demo upstream.” |

## Capture notes

- Use Monad **testnet** labels wherever chain results appear. The test token is valueless.
- An existing receipt may be shown alongside a newly recorded HTTP run; say when they are from different runs. Never imply a new HTTP event is anchored unless its receipt is actually onchain.
- Crop or blur one-time API key secrets, Privy prompts, email addresses, provider credentials, headers, and sensitive request bodies.
- If the preconfigured grant was revoked or the agent task expired, refresh/reissue it and verify a real request before recording. Do not splice a simulated success into the demo.
- Record at 1080p, keep browser zoom readable, use captions, and export at 2:55 or shorter to leave margin.
