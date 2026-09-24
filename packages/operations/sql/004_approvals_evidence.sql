ALTER TABLE pact_operations ADD COLUMN IF NOT EXISTS reservation_id numeric(78,0);

CREATE TABLE IF NOT EXISTS pact_approval_requests (
  id uuid PRIMARY KEY,
  principal text NOT NULL,
  agent text NOT NULL,
  grant_id numeric(78,0) NOT NULL,
  reservation_id numeric(78,0) NOT NULL,
  intent_hash text NOT NULL,
  intent jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','approved','rejected','expired','consumed')),
  signature text,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grant_id,reservation_id,intent_hash)
);
CREATE INDEX IF NOT EXISTS pact_approval_pending_idx ON pact_approval_requests (principal,state,created_at DESC);
CREATE INDEX IF NOT EXISTS pact_approval_agent_idx ON pact_approval_requests (agent,state,created_at DESC);

ALTER TABLE pact_evidence ADD COLUMN IF NOT EXISTS encrypted_key text;
ALTER TABLE pact_evidence ADD COLUMN IF NOT EXISTS kms_key_id text;
ALTER TABLE pact_evidence ADD COLUMN IF NOT EXISTS cipher_version integer;
