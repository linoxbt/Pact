CREATE TABLE IF NOT EXISTS pact_agent_configs (
  agent_id uuid PRIMARY KEY REFERENCES pact_agents(id),
  provider text NOT NULL CHECK (provider IN ('openai','anthropic','custom')),
  model text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  custom_endpoint text,
  max_output_tokens integer NOT NULL DEFAULT 1024 CHECK (max_output_tokens BETWEEN 64 AND 4096),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pact_agent_runs (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES pact_agents(id),
  principal text NOT NULL,
  grant_id numeric(78,0) NOT NULL,
  idempotency_key text NOT NULL,
  input text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','succeeded','failed')),
  output text,
  error_code text,
  provider text NOT NULL,
  model text NOT NULL,
  instructions text NOT NULL,
  custom_endpoint text,
  max_output_tokens integer NOT NULL,
  input_tokens integer,
  output_tokens integer,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS pact_agent_runs_queue_idx ON pact_agent_runs (created_at) WHERE state='queued';
CREATE INDEX IF NOT EXISTS pact_agent_runs_agent_idx ON pact_agent_runs (agent_id,created_at DESC);
