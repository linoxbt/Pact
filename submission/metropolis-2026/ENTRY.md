# PACT — Metropolis submission copy

Copy each section into the corresponding form field. The links below point to the deployed Monad **testnet** product and a public testnet receipt. They are not mainnet claims.

## Project name

PACT

## Short description

Pact gives autonomous agents bounded authority across APIs and wallets, with live policy checks, approvals, liability reservations, and verifiable Monad receipts.

## Full description

Agents can now call production APIs and move funds. A model prompt cannot reliably define who authorized an action, how much the agent may commit, or what happens after a promise is made. Giving an agent a provider key or a wallet creates broad access without a clear, enforceable record of responsibility.

Pact is an authority and economic accountability layer for those agents. A developer registers an agent, its callable operations, an owner grant, ordered policies, and a scoped Pact key. The agent calls Pact's gateway rather than receiving the protected upstream credential. Pact authenticates the key, evaluates the operation and policy, forwards allowed requests, blocks denied requests before they reach the upstream, and records a decision trace. The Console provides Agents, Endpoints, Grants, Policies, API keys, Approvals, and live Activity. TypeScript and Python SDKs and an MCP server expose the same boundary to developers and agent tools.

The onchain path extends that boundary to economic actions on Monad. An owner-specific Pact account and grant constrain the agent, token, recipient, per-action amount, and total capacity. The contracts reserve an exact proposed action before execution and prevent replay or spending beyond the grant. Above-threshold actions require the owner's approval. For the currently supported single-milestone obligation, Pact reserves its gross amount, records signed terms, holds funds in escrow, accepts evidence and a named verifier verdict, settles, and emits a receipt whose root can be checked against the chain. A counterparty can inspect the public receipt without relying on the Console.

Pact's design centers on **commitment-aware authority**: the relevant limit is the liability an action creates, not merely its immediate transfer. A proposed six-month agreement charging 1,000 units each month can expose the owner to 6,000 units of payments; a grant capped at 500 must not authorize that commitment. The current implementation demonstrates exact capacity reservation for transfers and one funded milestone. Automatic valuation and execution of recurring contracts are future work, so this example explains the principle rather than claiming a shipped recurring-contract adapter.

In a live Monad testnet exercise, a separately deployed Railway agent used a real model through Pact, made allowed and denied gateway calls, reserved onchain authority, executed an approved test-token transfer, and completed a funded obligation. The public testnet receipt reports a valid root: https://pact-api-production-2ab9.up.railway.app/v1/receipts/1 . The linked transactions and reproduction notes are in the repository. Test tokens have no monetary value. Private HTTP activity is an operator record; only a receipt actually anchored and checkable on Monad is described as independently verifiable.

Pact is open source and deployed for testnet evaluation. It is infrastructure for developers who need an enforceable agent boundary now and a traceable path from authorization through settlement as agent commerce becomes real.

## First users and distribution

Our first users are developers building agents that call third-party HTTP APIs, and teams experimenting with onchain service, treasury, or procurement agents on Monad. Their immediate pain is specific: they need to let an agent do useful work without handing it an unrestricted provider credential or open-ended spending authority. They also need to explain each decision to a human operator or counterparty after the fact.

We will start with a small set of Monad builders and agent developers who already have a concrete endpoint or workflow to protect. The onboarding path is deliberately developer-first: register an agent and endpoint, add a protected upstream secret, write an ordered policy, issue a scoped key, then make one allowed and one denied request through the gateway. The Console shows both decisions; the SDKs, MCP server, local demo upstream, and copyable examples let a second developer reproduce the flow without a sales call.

We will reach this first cohort through the open-source repository and documentation, direct outreach to Monad and agent-builder communities, hackathon follow-up, technical demos, and design-partner sessions. We will measure activation by completed gateway integrations, correctly blocked requests, time to first live policy decision, and repeat activity from the same agents. We will collect feedback on rule clarity, integration friction, approval latency, and receipt verification before expanding the supported economic adapters.

This is a proposed go-to-market plan, not a claim of existing customers or revenue.

## Repository

https://github.com/linoxbt/Pact

## Live product

https://pact-protocol-monad.alemzdelight.workers.dev/

## Steps for judges to try Pact

1. Open the live product and its Developer docs. The public Explorer and this receipt need no login: https://pact-api-production-2ab9.up.railway.app/v1/receipts/1 . The API returns `verification.valid: true` for this Monad testnet obligation; the repository's `docs/verification/2026-10-08-live-agent.md` links the underlying transactions.
2. To inspect the private Console, sign up with your own email or passkey through Privy. There is no shared judge password and no external principal-wallet onboarding step. Pact assigns an individual account principal. The product is currently configured for Monad testnet (chain ID 10143).
3. To make new resources yourself, fund your **signing wallet** with testnet MON and gas. Creation of an agent, HTTP grant, policy, and integration key currently costs 5 native testnet MON **each**; a full fresh setup therefore needs at least 20 testnet MON plus gas. The Console shows the amount, recipient, chain, and review step before a payment. These are testnet tokens, not a mainnet charge. Do not send funds to the displayed principal identifier unless it is also your verified signing wallet.
4. In Agents, create an agent. Register a safe test HTTP service and enabled GET operation in Endpoints. Add an agent grant, then a policy that allows that GET and denies other methods. Store the upstream credential in the vault if that service requires one. Issue a scoped key; copy its secret when shown because Pact stores only its hash and does not display it again.
5. Use the Connect an agent examples or the safe test console to call the Pact gateway. Send an allowed GET and a forbidden DELETE or path. The denied request must not reach the upstream. Open Live Activity to see each request's agent, decision, matched rule, reason, and trace. Revoke the key and retry: authentication must fail. The repository supplies a local demo upstream if you prefer to reproduce the flow without a paid provider.
6. For the onchain demonstration, use the linked public receipt and transaction list. HTTP activity in the Console is private database activity; it is not claimed to be a blockchain receipt. The submitted demo video should show the preconfigured test account and the testnet transaction sequence so judges can inspect the full flow without paying creation fees.

No test login credentials are supplied or required for self-signup. A fresh test account does not inherit the private agent and activity from the recorded live exercise.
