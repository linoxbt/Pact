CREATE TABLE IF NOT EXISTS pact_challenges (
  nonce uuid PRIMARY KEY,
  address text NOT NULL,
  grant_id numeric(78,0),
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE IF NOT EXISTS pact_sessions (
  token_hash text PRIMARY KEY,
  address text NOT NULL,
  principal text NOT NULL,
  grant_id numeric(78,0),
  kind text NOT NULL CHECK (kind IN ('principal','agent')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pact_sessions_principal_idx ON pact_sessions (principal, expires_at);

CREATE TABLE IF NOT EXISTS pact_operations (
  id uuid PRIMARY KEY,
  principal text NOT NULL,
  actor text NOT NULL,
  kind text NOT NULL,
  idempotency_key text NOT NULL,
  action_hash text NOT NULL,
  target_address text NOT NULL,
  expected_event text NOT NULL,
  grant_id numeric(78,0),
  tx_hash text,
  state text NOT NULL CHECK (state IN ('prepared','submitted','confirmed','reverted','recoverable')),
  error_code text,
  submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (principal, kind, idempotency_key)
);
CREATE INDEX IF NOT EXISTS pact_operations_pending_idx ON pact_operations (state, submitted_at);

CREATE TABLE IF NOT EXISTS pact_audit_events (
  id bigserial PRIMARY KEY,
  principal text NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  ref_hash text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pact_audit_principal_idx ON pact_audit_events (principal, id DESC);

CREATE TABLE IF NOT EXISTS pact_evidence (
  id uuid PRIMARY KEY,
  principal text NOT NULL,
  obligation_id numeric(78,0),
  digest text NOT NULL,
  storage_key text NOT NULL,
  content_type text NOT NULL,
  byte_length integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pact_evidence_principal_idx ON pact_evidence (principal, created_at DESC);

CREATE TABLE IF NOT EXISTS pact_chain_events (
  chain_id integer NOT NULL,
  block_number numeric(78,0) NOT NULL,
  block_hash text NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  contract_address text NOT NULL,
  event_name text NOT NULL,
  args jsonb NOT NULL,
  PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS pact_chain_events_block_idx ON pact_chain_events (chain_id, block_number);

CREATE TABLE IF NOT EXISTS pact_indexer_cursor (
  chain_id integer PRIMARY KEY,
  block_number numeric(78,0) NOT NULL,
  block_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
