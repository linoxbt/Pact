# Production operations design

This is a deployable operations plan, not a deployment record. Do not activate custody or invite third-party deposits before an independent audit, remediation, and a documented go/no-go review.

## Topology

Run `api`, `gateway`, `worker`, `indexer` and `runner` as separate containers from `Dockerfile.service`, setting `PACT_SERVICE` for each. Run the unified landing, docs, Console and Explorer site on Netlify with an HTTPS origin. Put the API and gateway behind TLS, rate limiting and request-size enforcement. Give PostgreSQL private network access and point each service at the same database and Monad RPC. Set `PACT_ENVIRONMENT=production`; startup checks require HTTPS RPC, verified PostgreSQL TLS and a Console HTTPS origin whose host matches `PACT_AUTH_DOMAIN`. The Pact-funded checkout is testnet-only and refuses to start in production mode until an independent audit and release design are complete.

The API requires a private S3 bucket and a customer-managed KMS key. The gateway requires a Secrets Manager secret ID for its GitHub token. Use workload identity/short-lived IAM credentials, never static AWS access keys in environment variables or an image. Place S3, KMS and Secrets Manager behind private endpoints where the hosting environment supports them. The app fetches the current secret with a 30-second cache; rotate and verify the provider token before disabling the old one. [AWS Secrets Manager guidance](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html) recommends least-privilege access, caching, rotation and private networking.

The bucket must block public access, use versioning, and have a deliberate retention policy. Client-side AES-256-GCM protects each evidence object; KMS wraps its one-time key with an encryption context containing evidence ID, principal and obligation ID. S3 also applies SSE-KMS. The database stores only the encrypted data key, object key and SHA-256 digest. The application must not receive `s3:ListBucket`, public ACL permissions or broad `kms:*`. Consider Object Lock for retention after legal review; [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html) has versioning and retention semantics that must be reflected in restore and deletion procedures.

## Required configuration

Set `PACT_DATABASE_URL` with `sslmode=verify-full`, `PACT_RPC_URL` over HTTPS, exact chain and contract addresses, `PACT_FINALITY_BLOCKS`, `PACT_INDEXER_START_BLOCK`, `PACT_AUTH_DOMAIN`, Console and Explorer HTTPS origins, `PACT_EVIDENCE_BUCKET`, `PACT_EVIDENCE_KMS_KEY_ID`, and `PACT_GITHUB_SECRET_ID`. Set AWS region and workload identity through the platform. Do not put the provider token in `PACT_GITHUB_TOKEN`; production gateway reads Secrets Manager. Set `VITE_PACT_API_URL` at static-site build time to the public HTTPS API URL. Keep agent bearer sessions short lived and never in browser local storage.

The [gateway IAM template](../../infra/aws/gateway-policy.example.json) and [API IAM template](../../infra/aws/api-policy.example.json) need real ARNs and account-owner review. Give the gateway only the secret read permission. Give the API only KMS data-key/decrypt access and S3 put/get on the evidence prefix. An orphan object created when metadata insertion fails needs an operator cleanup path; the normal API role should not have broad deletion permission.

## Release sequence

1. Record the source commit, reviewed contract bytecode, chain ID, RPC provider, addresses, deployer, asset, verifier/arbitrator assumptions and audit report. Pin base image digests and run the CI checks from that commit.
2. Create and test the private database, KMS key, S3 bucket, Secret Manager secret and IAM roles. Enable backup/PITR, CloudTrail/S3 data events and alarms in the cloud account. Verify the secret and KMS permissions using the service roles, without printing values.
3. Deploy worker and indexer, run migrations once, and verify `node scripts/ops-status.mjs` reports current heartbeats and acceptable indexer lag. Then deploy API and gateway and check `/ready` for each.
4. Deploy Console and Explorer, perform one disposable grant/transfer/approval/receipt exercise, and verify the Explorer's disclosure behavior. Do not use real customer funds for this canary.
5. Enable external traffic only after finality, rollback and incident ownership are confirmed. Retain the previous container image. Database migrations are forward-only; test restore against the previous version before a schema change.

`scripts/ops-status.mjs` exits nonzero when worker or indexer success heartbeats are stale or finalized indexer lag exceeds the configured threshold. Set `PACT_HEARTBEAT_MAX_AGE_SECONDS` and `PACT_MAX_INDEXER_LAG_BLOCKS` for the network and alert on exit code 2. Also alert on API/gateway `/ready` failures, high `recoverable` operation count, KMS/Secrets Manager access failures, S3 errors, PostgreSQL replication/backup failures, and RPC chain mismatch. Keep logs free of bearer tokens, provider secrets, private evidence and raw signatures.

## Recovery drills

- **Worker restart:** do not mutate pending operations. Restart the worker; it re-reads `submitted` and `recoverable` rows and verifies canonical transaction receipts again.
- **Indexer reorg:** the indexer walks back to a common ancestor and rebuilds the finalized projection. Execution must continue to read live contract state, never the projection.
- **PostgreSQL restore:** restore into a separate environment, run migrations, compare chain ID/address configuration and indexer cursor, then replay finalized events from a trusted start block. Verify approval state and evidence metadata against S3 objects before cutover.
- **Evidence restore:** retrieve a sampled object through the API with an authorized session and compare its SHA-256 digest. Do not disable or schedule deletion of the KMS key while retained evidence exists.
- **Provider token compromise:** revoke/rotate the GitHub credential in the provider and Secrets Manager, then verify the gateway serves the new value after its cache TTL. Review gateway audit rows for abuse.
- **Contract incident:** pause new grants/agent operations at the application edge, publish the affected contract/grant scope, preserve logs and chain data, and follow the contract-specific response plan. Existing immutable obligations cannot be altered by an application rollback.

Run a documented restore drill and an incident tabletop before the first live-funds release, then repeat on a defined schedule. The on-call owner must have a tested route to the database backup, cloud logs, Monad RPC, key custodians and independent audit findings.
