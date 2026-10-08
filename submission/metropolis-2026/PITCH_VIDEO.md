# Pitch video — maximum 2 minutes

Founder-facing script. Replace only facts that you can verify; no traction, team size, audit, or mainnet claims are inserted here. At a natural reading pace this is approximately 90–110 seconds.

> Hi, I’m Lino, building Pact. Agents are starting to call production APIs and move money, but a prompt is not permission. When we give an agent a wallet or provider key, we often give it much more power than the task requires, and too little accountability for what it commits to.
>
> Pact puts an enforceable boundary around that work. A developer can connect an agent, register its permitted operations, define ordered policies, and issue a scoped key. The agent calls Pact. Pact decides whether the request is allowed, forwards only approved calls, protects the upstream secret, and records the decision. Humans can inspect live activity and approve sensitive actions.
>
> For economic commitments, Pact also uses Monad. An owner-specific onchain grant caps what an agent can do. The contract reserves capacity for a specific action, blocks replay and overspending, and links a funded obligation to evidence, a named verifier result, settlement, and a public receipt. The receipt can be checked against the chain without trusting our dashboard.
>
> The deeper problem is liability. If an agent signs an agreement that creates six months of payments, the risk is the whole commitment, not just the first installment. Our current testnet implementation demonstrates this principle for exact transfers and one funded milestone; recurring-contract valuation is the next adapter, not a feature we are pretending is finished.
>
> We built Pact because useful agents need real authority boundaries that developers can integrate and owners can understand. The product is live on Monad testnet, with a TypeScript SDK, Python SDK, MCP tools, and a recorded end-to-end agent exercise. We’re starting with agent developers and Monad teams who need to safely let software act on their behalf. Try it at the live product link and inspect the public testnet receipt.

**Visual plan:** 0:00 founder on camera; 0:20 short live Console cutaway; 0:55 simple screen graphic showing owner → grant/policy → agent → gateway/Monad; 1:20 receipt and Monad Explorer; finish on founder and product URL. Use the shipped logo. Do not use stock footage to imply an integration that has not been built.

## Optional 30-second promo script

> Your agent can call APIs and move funds. Who gave it permission, and how much can it commit? Pact puts a real boundary around that power: scoped keys, ordered policies, approvals, live decisions, and Monad receipts for settled obligations. Connect an agent. Define the rules. Verify what happened. Pact is live on Monad testnet.
