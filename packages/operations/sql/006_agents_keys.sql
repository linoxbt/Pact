CREATE TABLE IF NOT EXISTS pact_agents (
  id uuid PRIMARY KEY,
  principal text NOT NULL,
  grant_id numeric(78,0) NOT NULL UNIQUE,
  operational_address text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pact_agents_principal_idx ON pact_agents (principal,created_at DESC);

CREATE TABLE IF NOT EXISTS pact_agent_keys (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES pact_agents(id),
  principal text NOT NULL,
  grant_id numeric(78,0) NOT NULL,
  token_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  name text NOT NULL,
  scopes text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pact_agent_keys_agent_idx ON pact_agent_keys (agent_id,created_at DESC);

CREATE TABLE IF NOT EXISTS pact_key_challenges (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES pact_agents(id),
  principal text NOT NULL,
  name text NOT NULL,
  scopes text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  message text NOT NULL,
  challenge_expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
