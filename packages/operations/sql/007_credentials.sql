CREATE TABLE IF NOT EXISTS pact_provider_credentials (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES pact_agents(id),
  principal text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('github','openai','anthropic','custom')),
  label text NOT NULL,
  ciphertext text NOT NULL,
  encrypted_key text NOT NULL,
  kms_key_id text NOT NULL,
  cipher_version integer NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pact_provider_one_active_idx
  ON pact_provider_credentials (agent_id,provider) WHERE revoked_at IS NULL;
