ALTER TABLE pact_agent_configs ADD COLUMN funding_mode text NOT NULL DEFAULT 'byo'
  CHECK (funding_mode IN ('byo','pact'));
ALTER TABLE pact_agent_runs ADD COLUMN funding_mode text NOT NULL DEFAULT 'byo'
  CHECK (funding_mode IN ('byo','pact'));
ALTER TABLE pact_agent_runs ADD COLUMN input_rate_micro integer;
ALTER TABLE pact_agent_runs ADD COLUMN output_rate_micro integer;
CREATE TABLE IF NOT EXISTS pact_billing_accounts (
  principal text PRIMARY KEY,
  balance_micro numeric(78,0) NOT NULL DEFAULT 0 CHECK (balance_micro >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pact_billing_deposits (
  tx_hash text PRIMARY KEY,
  principal text NOT NULL,
  token text NOT NULL,
  amount_micro numeric(78,0) NOT NULL CHECK (amount_micro > 0),
  block_number numeric(78,0) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pact_billing_reservations (
  run_id uuid PRIMARY KEY REFERENCES pact_agent_runs(id),
  principal text NOT NULL,
  reserved_micro numeric(78,0) NOT NULL CHECK (reserved_micro >= 0),
  charged_micro numeric(78,0),
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
