CREATE TABLE IF NOT EXISTS pact_gateway_policies (
  grant_id numeric(78,0) PRIMARY KEY,
  principal text NOT NULL,
  policy_hash text NOT NULL,
  policy jsonb NOT NULL,
  signature text NOT NULL,
  signature_deadline numeric(78,0) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pact_gateway_usage (
  grant_id numeric(78,0) NOT NULL,
  period_start bigint NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0),
  PRIMARY KEY (grant_id, period_start)
);
