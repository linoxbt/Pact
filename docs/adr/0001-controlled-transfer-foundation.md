# ADR 0001: Controlled transfer foundation

Status: accepted for local development, 23 September 2026.

## Decision

Implement a narrow principal-funded ERC-20 transfer account before obligations or external API operations. Each grant binds one agent key, account, token, recipient, cumulative ceiling, single transfer limit, principal approval threshold, policy hash, and expiry. Children inherit account, token, and recipient; their limits and lifetime cannot exceed their parent. A child allocation is deducted from the parent's free capacity at creation. The child's later reservation or spend is counted inside that allocation, so it is not deducted a second time from the parent.

Reservations are keyed to EIP-712 transfer intent hashes. The agent submits the reservation and executes from its onchain address. The account consumes the reservation and moves the asset in the same transaction. Above the threshold, a separate principal EIP-712 approval binds the intent hash, reservation ID, and deadline. An ERC-1271 contract principal may sign instead. Failed token transfer reverts the ledger update.

## Rationale

This makes the execution boundary testable. A service-level `ALLOW` result cannot itself move funds. The account independently checks the grant and the exact reserved action. Fixed token and recipient values avoid pretending that an arbitrary policy hash enforces undisclosed rules.

## Consequences

- A grant's ceiling is a cumulative spend limit, not a replenishing period budget.
- A principal can cancel a pending reservation. After a child is revoked or expired, the principal can reclaim its unused allocation. Spent or still committed child capacity remains charged to the parent.
- A principal may create multiple accounts and grants, but each account's transfer nonce space is shared across its grants.
- Agent rotation invalidates old-agent execution; pending reservations can be expired, and no longer authorize the old key.
- A principal can choose an unsafe ERC-20 contract; production deployment must restrict supported assets after review.
- All contracts are immutable in this slice. A production custody upgrade policy remains undecided.
- The obligation flow is one full-funded milestone; verifier and arbitrator are named in the signed terms. Evidence truth is their attestation, not an onchain fact.

## Decisions required before live custody

1. Monad deployment network, RPC, explorer, and finality assumptions.
2. Stablecoin address, decimals, contract behavior, and supported asset governance.
3. Principal account model, recovery, and ERC-1271 wallet compatibility.
4. Operational roles and key management for deployment and pausing.
5. Independent security review, fuzzing, and incident recovery procedures.
