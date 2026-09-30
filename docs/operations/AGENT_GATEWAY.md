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

1. Open the Console, sign in with email or a passkey, and approve the message to verify your newly created embedded account address. No blockchain transaction occurs.
2. In **Agents**, register `Demo assistant` in `development`.
3. In **Endpoints**, add service `Demo upstream` with base URL `http://127.0.0.1:4602`, authentication `bearer`, and store `demo-upstream-secret` in its secret form.
4. In **Grants**, create a grant for the agent. Permit origin and destination `http://127.0.0.1:4602/`, method `GET`, currency `USD`, per action and aggregate limits `0` minor units, and a future expiry. The owner and principal are copied from the signed in account.
5. In **Policies**, add an ordered `allow` rule for `GET /health` and destination `http://127.0.0.1:4602/`, with a rate budget. Bind that grant and policy to a registered `GET /health` operation in **Endpoints**.
6. In **API keys**, issue a `proxy.read` key for the agent. Copy it once. In the **Endpoints** test console, select the service and send `GET /health`; expect HTTP 200 with the secret redacted. Send `GET /forbidden`; expect 403. A `POST /health` with this read-only key returns 401 at the credential boundary. The upstream `/__metrics` count increases only for the allowed call.
7. Open **Live Activity**. The allowed GET and denied forbidden path appear automatically with their rule trace and request ID. Revoke the key and retry `GET /health`; expect 401 and no upstream request.

Use the test console only in a trusted browser. A production agent should store its Pact key in its server secret manager and call the gateway directly. Never put it in shipped browser code.

## Data and security boundaries

- Privy signs users in. The API verifies its ES256 token against Privy's app JWKS and binds the DID to one Pact user. Each user has a separate principal address, proved with a short lived wallet signature. Changing the address creates an audit record; existing grants retain their original principal.
- API keys contain 256 random bits. Pact stores SHA-256 hashes, agent binding, scopes, expiry, last use and revocation. Rotation revokes the old key in the same database transaction that issues the replacement. API keys cannot create grants, approve requests or sign chain transactions.
- Upstream secrets are encrypted at rest. Only the gateway decrypts after an allowed decision and injects a bearer or configured header. It pins DNS resolution for each request, blocks private addresses outside the explicit local demo exception, caps bodies, times out requests and rejects redirects. The proxy does not persist request bodies, response bodies, tokens, query strings or upstream secrets.
- Ordered policy rules and grant bounds are evaluated inside a database transaction with a locked grant usage row. A denied request is recorded and never forwarded. An approval is bound to an exact request hash, endpoint and 15 minute lifetime.
- Activity is visible only to the owner, retained for 30 days, and is a private operational log. Monad receipts are separately anchored and verifiable only after a confirmed chain transaction.

## Operator deployment

Deploy the API and gateway against the same Railway PostgreSQL service. Set `PACT_PRIVY_APP_ID`, `PACT_AUTH_DOMAIN`, `PACT_CONSOLE_ORIGIN`, the Monad RPC/contracts settings, and matching `PACT_CREDENTIAL_KMS_KEY_ID` with AWS permissions. In staging only, the two services may share `PACT_VAULT_MASTER_KEY`; use a random 32 byte hex key and store it as a Railway secret. Never put the vault key or upstream credentials in Cloudflare `VITE_` variables. Build the Console with `VITE_PACT_API_URL`, `VITE_PACT_GATEWAY_URL` and `VITE_PRIVY_APP_ID`; allow the deployed Console origin in Privy and in both services' CORS setting. Keep `PACT_ALLOW_LOCAL_UPSTREAM` unset in deployed environments.

For CI without paid services, `apps/gateway/test/proxy.test.mjs` runs the same control API and gateway against a disposable PostgreSQL database and local upstream. It verifies allow, deny, redaction, rotation, revocation, activity and no forwarding on denial. Set `PACT_TEST_DATABASE_URL` to an isolated disposable database before running it.
