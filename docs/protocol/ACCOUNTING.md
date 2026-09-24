# Capacity accounting, version 1

Every grant has one token, one cumulative ceiling and one fixed recipient. The onchain ledger tracks four separate counters for each grant:

```
available = ceiling - allocated - reserved - committed - spent
```

`allocated` is locked for direct children. A child reservation or commitment is charged against that child's allocation, not charged a second time against the parent. This is why a parent with a 15,000 ceiling and a 6,000 child allocation has 9,000 available even before the child acts. The child cannot reserve more than 6,000, and the parent cannot spend the locked 6,000.

`reserved` is a short-lived action-bound hold. An agent can reserve an exact transfer hash or exact signed obligation terms hash. A reservation can be consumed once, cancelled by the principal, or expired after its deadline. A used hash cannot be reserved again.

`committed` is gross unsettled liability from an accepted obligation. A transfer moves its reservation directly to `spent`. An accepted obligation moves its reservation to `committed`. Settlement moves its amount from `committed` to `spent`; refund removes it from `committed` without increasing `spent`. `spent` is cumulative and does not refill.

For the single-milestone MVP, gross liability equals the signed agreement amount. The vault separately holds the entire amount; it does not replace the commitment ledger. Future recurring obligations require an adapter that bounds total payable installments and penalties before they can be supported.

After revocation or expiry, a principal may reclaim only a child's unused capacity. Outstanding reservations and commitments remain represented in the child balance. Existing accepted obligations can still settle under their signed terms after grant revocation; revocation only blocks new reservations and commitments.

Contracts check these invariants atomically. Indexer and UI projections must be treated as rebuildable displays, never as capacity authority.
