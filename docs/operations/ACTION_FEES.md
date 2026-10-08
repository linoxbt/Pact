# Per-action MON fees

When `PACT_ACTION_FEES_ENABLED=yes`, each new workspace agent, HTTP grant,
ordered policy, and integration key costs **5 native MON**. The four POST routes
are enforced in the API, including calls outside the Console. Edits, grants'
principal migration, key rotation, revocation, approvals, endpoint/service
registration, and existing gateway calls remain free. The legacy onchain
contracts and model-credit billing are separate; these fees do not alter their
permissions or charge arbitrary contract calls.

Set `PACT_ACTION_FEE_TREASURY` to the operator's receiving public address. The
address is not used as anyone's principal. Amount is fixed at
`5000000000000000000` wei, not a six-decimal ERC20. Network gas is additional.
Both 10143 (testnet) and 143 (mainnet) are supported; the configured API RPC must
match its configured chain. Deployment currently uses Monad testnet. Changing
to mainnet requires an explicit coordinated API/Console network rollout.

## Console flow

Review the action, then review the 5 MON payment dialog. The account's embedded
wallet can sign without connecting an external wallet. On its first use, the
Console requests an ownership-message signature and links that individual
wallet through the existing verified-address flow. Prior grants retain their
principal. The user funds the signing wallet; an account-assigned identifier is
not a wallet and must not be funded.

Submit the transfer, wait for confirmations, then select **Verify payment &
finish**. Rechecking never automatically resubmits the transaction. Account's
payment history can resume the exact prepared action, including after a
refresh; paste the original transaction hash if browser storage was lost.
A consumed action displays its resource ID. A key's secret is displayed once:
if its response was lost, rotate that key (free), rather than purchasing a new
key. History shows all pending actions (max 100) and the latest 100 completions.

## API / SDK

1. `GET /v2/fees/config` returns enabled, fixed amount and chain/treasury.
2. `POST /v2/fees/prepare` with `{path,body}` validates the action and returns a
   payment intent. Identical unconsumed intents reuse the same ID.
3. The owner wallet sends `amount_wei` to `treasury` on `chain_id`, with **exactly
   `tx_data` as transaction data**. Agents never receive the wallet key.
4. `POST /v2/fees/payments/:id/confirm` with `{txHash}` verifies the canonical
   successful receipt, sender, recipient, amount, chain, intent data, and at
   least five blocks of finality (or configured finality if greater).
5. Send the original action POST with `X-Pact-Payment: <intent-id>`.

TypeScript: `preparePayment(path,body)`, `confirmPayment(id,hash)`, then
`createAgent(body,id)` / `createGrant(body,id)` / `createPolicy(body,id)` /
`issueKey(agentId,body,id)`. Python supplies corresponding `prepare_payment`,
`confirm_payment`, and optional `payment_id` arguments. Both generic request
methods support a payment ID. SDKs do not sign or silently spend funds.
MCP's scoped agent tools continue to execute existing authorized operations;
they do not gain owner billing or wallet-signing authority.

## Accounting, retries, and limits

The server stores a canonical hash of the action and account-bound payer
snapshot. Receipt hashes are unique per chain. A row lock serializes consumers;
resource insertion and fee consumption commit in the same database transaction.
Failed inserts roll back consumption; retry the original action without another
payment. API payment records and audit events are private owner records. The
native transfer is publicly inspectable, but is not a Pact execution receipt.

**Chain payment and database creation are not one atomic transaction.** Sending
funds is irreversible. If the action can no longer succeed (for example its key
expiry passed or the agent was disabled), the operator must resolve/refund the
payment to its recorded payer after checking the chain and preventing later
consumption. There is no automatic refund or escrow. Never manually send a
second payment for the same intent, including from another browser tab. A lost
wallet response is recoverable from its transaction history using the original
hash. Do not change treasury or disable fees without reconciling pending intents.
Pending intents preserve their original payer, treasury, network and payload.

## Verification

`apps/api/test/action-fees.test.mjs` runs PostgreSQL plus real native transfers
on a local Anvil EVM (chain ID 10143). It covers all four paid creation routes,
amount/recipient/intent checks, finality, account isolation, concurrent reuse,
rollback recovery, audit/history, and free editing/key rotation.
`apps/console/test/browser.mjs` tests inline checkout, cancellation, confirmation
retry and one transfer attempt against the real API/database with a local wallet
adapter. This is not evidence of a hosted Privy payment or public-testnet transfer.
