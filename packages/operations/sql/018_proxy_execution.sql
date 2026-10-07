ALTER TABLE pact_proxy_activity ADD COLUMN execution_state text;
CREATE TABLE pact_proxy_dispatches (
  owner_id uuid NOT NULL REFERENCES pact_users(id),
  agent_id uuid NOT NULL REFERENCES pact_connected_agents(id),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  endpoint_id uuid NOT NULL REFERENCES pact_endpoints(id),
  request_id uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('authorized','dispatching','responded','not_forwarded','outcome_unknown')),
  upstream_status integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,agent_id,idempotency_key)
);
