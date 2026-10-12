# Privy bounty submission

## How Pact meaningfully integrates Privy

Pact uses Privy as its user identity and wallet layer, beyond sign-in. A developer enters the Console with email, a passkey, or an existing wallet. Privy creates a separate embedded Ethereum wallet for each user at login. The user can link a passkey from Account for subsequent access. Pact uses the user's short-lived Privy access token to authenticate its own API: the backend checks the token signature against Privy's app-specific JWKS, validates issuer, audience and expiry, and maps the verified Privy DID to a Pact owner record. An API key issued to an agent is separate from that owner identity and never gains signing authority.

HTTP agent setup works before a blockchain transaction. When a user enables Monad signing, Pact issues a short-lived, address-bound challenge; the user's Privy wallet signs it, and the API verifies control before marking that address as a signing principal. The Privy wallet can then sign Monad transactions from the Console. For paid creation actions, Pact presents the exact 5 testnet MON amount, network, payer, recipient and action; the user confirms in their own embedded wallet. Pact records the transaction hash, verifies confirmation on the configured chain, and only then completes the requested creation. A returned or refreshed page can resume verification without silently sending a second payment.

The same per-user wallet is used for authorized onchain actions. Pact does not put a shared private key in its frontend or hand an agent the user's wallet. Pact's grants, policies and gateway remain the enforcement boundary for agent actions; Privy supplies user authentication, passkey linking and user-controlled signing. Existing wallet-backed grants keep their original principal unless the user explicitly migrates or reissues them.

**Judge walkthrough:** Sign in with email or passkey. Open Account and create or link a passkey. Inspect the account principal and choose “Enable Monad signing with my Pact wallet”; approve the ownership message. On Monad testnet, fund the *signing wallet* with test MON. Create an agent and review the 5 MON action payment: the wallet signs the transaction, Pact verifies it, and the new resource appears. The public testnet receipt is separate evidence of Pact's onchain flow. Fresh accounts need test MON for paid creation; login, passkey linking and account inspection do not.

**Implementation:** `apps/console/src/PrivyConsole.tsx`, `apps/console/src/AccountSecurity.tsx`, `apps/console/src/ActionPayment.tsx`, `apps/console/src/ControlConsole.tsx`, `packages/operations/src/owner-auth.ts`, and `apps/api/src/main.ts`.

## Optional video

`Pact-Privy-Integration-1m12.mp4` is an animated product-flow explainer made from the implemented code paths. It is **not** a recorded authenticated login or payment transaction. For a strict live-demonstration requirement, record the judge walkthrough above in a fresh account and use that recording instead. Do not describe the explainer as proof that a hosted Privy payment was completed.
