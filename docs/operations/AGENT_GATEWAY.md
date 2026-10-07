# Agent gateway: local vertical slice

Pact HTTP authority is account owned and stored in PostgreSQL. It does not create an onchain Monad grant or give an API key transaction signing power. Existing Monad grant and receipt flows are separate. A private proxy activity row is not an independently verifiable receipt.

## Local services

Requirements: Node 22+, pnpm 11, PostgreSQL, and a Privy application with the local Console origin allowed. Start PostgreSQL and set `PACT_DATABASE_URL`. The API and gateway must use the same database and encryption configuration. Set a fresh 32 byte hex `PACT_VAULT_MASTER_KEY` for local development only; production must use `PACT_CREDENTIAL_KMS_KEY_ID` and AWS KMS permissions. Set `PACT_PRIVY_APP_ID` to the public Privy App ID, `PACT_CONSOLE_ORIGIN` to the exact browser origin, `PACT_AUTH_DOMAIN` to that origin's hostname, and the existing Monad RPC and contract variables described in `LOCAL_DEVELOPMENT.md`.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @pact/operations exec node -e "import('./dist/index.js').then(async m=>{const db=m.createDatabase(process.env.PACT_DATABASE_URL);await m.migrate(db);await db.end()})"
PACT_ALLOW_LOCAL_UPSTREAM=yes PACT_ENVIRONMENT=development pnpm --filter @pact/api start
PACT_ALLOW_LOCAL_UPSTREAM=yes PACT_ENVIRONMENT=development pnpm --filter @pact/gateway start
node scripts/demo-upstream.mjs
VITE_PACT_API_URL=http://127.0.0.1:4100 VITE_PACT_GATEWAY_URL=http://127.0.0.1:4101 pnpm --filter @pact/console dev
```

The demo upstream listens on `http://127.0.0.1:4602` and accepts bearer secret `demo-upstream-secret`. Its `/health` response intentionally contains the secret so redaction can be checked. Localhost upstreams are allowed only in the development environment with `PACT_ALLOW_LOCAL_UPSTREAM=yes`; they are refused in staging and production.

## Browser walkthrough

1. Open the Console and sign in with email or a passkey. Pact assigns a unique account address for HTTP grants automatically. No wallet prompt or blockchain transaction occurs.
2. In **Agents**, register `Demo assistant` in `development`.
3. In **Endpoints**, add service `Demo upstream` with base URL `http://127.0.0.1:4602`, authentication `bearer`, and store `demo-upstream-secret` in its secret form.
4. In **Grants**, create a grant for the agent. Permit origin and destination `http://127.0.0.1:4602/`, method `GET`, currency `USD`, per action and aggregate limits `0` minor units, and a future expiry. The owner and principal are copied from the signed in account.
5. In **Policies**, add an ordered `allow` rule for `GET /health` and destination `http://127.0.0.1:4602/`, with a rate budget. Bind that grant and policy to a registered `GET /health` operation in **Endpoints**. Keep returned JSON fields `status, service, ok`; the upstream's diagnostic credential field is excluded.
6. In **API keys**, issue a `proxy.read` key for the agent. Copy it once. In the **Endpoints** test console, select the service and send `GET /health`; expect HTTP 200 with the secret redacted. Send `GET /forbidden`; expect 403. A `POST /health` with this read-only key returns 401 at the credential boundary. The upstream `/__metrics` count increases only for the allowed call.
7. Open **Live Activity**. The allowed GET and denied forbidden path appear automatically with their rule trace and request ID. Revoke the key and retry `GET /health`; expect 401 and no upstream request.

Use the test console only in a trusted browser. A production agent should store its Pact key in its server secret manager and call the gateway directly. Never put it in shipped browser code.

## Data and security boundaries

- Privy signs users in. The API verifies its ES256 token against Privy's app JWKS and binds the DID to one Pact user. On first sign-in Pact assigns each user a random, unique principal address for HTTP records. This address is an account identifier with no signing key and cannot authorize a Monad transaction. Changing to an external address requires a short lived wallet signature and creates an audit record; existing grants retain their original principal until explicitly migrated.
- API keys contain 256 random bits. Pact stores SHA-256 hashes, agent binding, scopes, expiry, last use and revocation. Rotation revokes the old key in the same database transaction that issues the replacement. API keys cannot create grants, approve requests or sign chain transactions.
- Upstream secrets are encrypted at rest. Only the gateway decrypts after an allowed decision and injects a bearer or configured header. For an authenticated upstream, the gateway returns only the operation's selected top-level JSON fields; the default selection is empty. It additionally redacts the exact credential and common encodings in selected fields. Operators should select only fields needed by the agent and use trusted upstreams; no generic filter can recognize an arbitrary transformation of a secret made by an untrusted provider. Existing authenticated operations return an empty JSON object until their response fields are reviewed. The gateway pins DNS resolution, blocks private addresses outside the explicit local demo exception, caps bodies, times out requests and rejects redirects. Activity does not persist request bodies, response bodies, tokens, query strings or upstream secrets. Pending approval intents are a separate encrypted record; owner-only disclosure redacts common secret and personal fields and writes an audit event.
- Ordered policy rules and grant bounds are evaluated inside a database transaction with locked grant usage and shared policy rows. Cross-grant policy quotas are atomic. A denied request is recorded and never forwarded. An approval is bound to an exact request hash, grant/policy/endpoint versions and a 15 minute lifetime. Inspect the encrypted intent before approving; an authority edit invalidates the approval.
- Activity is visible only to the owner, retained for 30 days, and is a private operational log. Monad receipts are separately anchored and verifiable only after a confirmed chain transaction.

## Operator deployment

Deploy the API and gateway against the same Railway PostgreSQL service. Set `PACT_PRIVY_APP_ID`, `PACT_AUTH_DOMAIN`, `PACT_CONSOLE_ORIGIN`, the Monad RPC/contracts settings, and matching `PACT_CREDENTIAL_KMS_KEY_ID` with AWS permissions. In staging only, the two services may share `PACT_VAULT_MASTER_KEY`; use a random 32 byte hex key and store it as a Railway secret. Never put the vault key or upstream credentials in Cloudflare `VITE_` variables. Build the Console with `VITE_PACT_API_URL`, `VITE_PACT_GATEWAY_URL` and `VITE_PRIVY_APP_ID`; allow the deployed Console origin in Privy and in both services' CORS setting. Keep `PACT_ALLOW_LOCAL_UPSTREAM` unset in deployed environments.

For CI without paid services, `apps/gateway/test/proxy.test.mjs` runs the same control API and gateway against a disposable PostgreSQL database and local upstream. It verifies allow, deny, redaction, rotation, revocation, activity and no forwarding on denial. Set `PACT_TEST_DATABASE_URL` to an isolated disposable database before running it.

## Economic requests and retry safety

A fixed endpoint cost meters an API call; it does not constrain a payment amount hidden inside an arbitrary body. For value-moving operations, set `economicConstraints` to the dot paths of `amountPath`, `currencyPath` and `recipientPath`, and set the grant's `allowedRecipients`. For example, `{"amount":"100","currency":"USD","recipient":"vendor-123"}` represents 100 minor units. The amount must be a decimal string. Unknown currencies, forbidden recipients, numeric floating-point amounts and over-limit amounts fail before forwarding. These fields must reflect the upstream API's actual economic semantics; review the upstream contract before enabling a payment operation.

Every non-GET proxy request requires `X-Pact-Idempotency-Key` (8–100 URL-safe characters). Reuse the same key when retrying the same intent. TypeScript: `pact.proxy(agent, service, 'POST', '/pay', body, undefined, {idempotencyKey, query:{mode:'test'}})`. Python: `pact.proxy(agent, service, 'POST', '/pay', body, idempotency_key=key, query={"mode":"test"})`. MCP accepts `idempotencyKey` and `query` in `pact_proxy_request`. GET may also supply a key.

A duplicate dispatch returns 409 with the original request ID and execution state, not a cached upstream response. `responded` means an HTTP response was observed; `outcome_unknown` means forwarding might have happened. Check upstream state using its idempotency key/request ID before taking corrective action. Pact never automatically redispatches an ambiguous write. Grant and policy budgets count attempted authorized dispatches conservatively and are not refunded after an ambiguous failure. Idempotency records are retained for 100 days; retry protection does not extend beyond that retention window.

## Limits, retention and disclosure

- Ingress: 600 requests per connection IP per minute, 300 per credential per minute, and 240 authenticated owner control requests per minute; PostgreSQL enforces these across instances. Platform edge controls should additionally handle volumetric attacks. Responses use 429 and Retry-After.
- Workspace resources: 1,000 records per owner per resource table (agents, grants, policies, services, endpoints and integration keys), including disabled/revoked records. Operators must archive records under their retention policy before increasing this limit. Collection endpoints return 100 records and `nextCursor`; SDK list methods accept the cursor. Console loads successive collection pages.
- Activity: 30 days. Approval intents: encrypted until 30 days after expiry, then erased; approval metadata: 90 days after expiry. Configuration audit: 365 days. Policy/legacy gateway usage: 7 days. Ingress counters: 1 hour. Worker sweeps hourly. Policy windows are at most 24 hours.
- Last-use timestamps coalesce within one minute and do not generate configuration audit entries. Endpoint/grant/policy edits still have transactional audit entries.
- OpenAPI import accepts JSON OpenAPI 3, the first server's origin/base path and local JSON Pointer references. Remote references and operation-specific servers fail explicitly. The import does not enforce arbitrary OpenAPI request schemas. Authentication must be configured on the service before importing protected operations.

## Account signing, custody and recovery

Email/passkey sign-in creates a unique HTTP principal identifier immediately. It has no private key. In Account, **Enable Monad signing with my Pact wallet** proves control of the Privy embedded wallet with a one-time challenge. This explicitly changes the account's principal; existing HTTP grants retain their original principal and require the audited migration action. Existing onchain grants remain immutable and require signed revocation/reissuance.

The embedded signer belongs to the user's Privy account, with Privy authentication/recovery as a trust dependency. Pact's frontend requests signatures from that user's wallet; Pact's API/gateway holds no shared signing key. Compromise of the user's login, recovery channel or embedded wallet may compromise that user's signing authority. Configure and test recovery and MFA/passkeys in Privy before holding value. Losing access requires Privy's configured recovery process; Pact cannot recover a wallet key. External addresses require proof of control and recovery remains with that wallet's custodian.

**Deploy your Monad account** sends a real testnet transaction from the verified user's wallet, requiring MON for gas. Legacy grant management resolves this user's factory account rather than the deployment's original account. Revoking an HTTP key or grant blocks future proxy calls but cannot recall an already forwarded request or revoke an onchain grant. Onchain revocation requires the original signer. Never send funds to an account-assigned HTTP identifier.

## Free Railway runner

Set `PACT_ENABLE_RUNNER=yes` on the existing `pact-worker` service and provide the same credential encryption configuration as the API. `scripts/worker-services.mjs` supervises both processes; if either exits, the whole service exits and Railway restarts it. No additional Railway resource or plan upgrade is required. BYO managed model runs still require a user-supplied provider credential and a valid onchain grant. Platform-funded model runs additionally require Secrets Manager provider configuration and the billing setup; these are not enabled by the HTTP proxy key.
