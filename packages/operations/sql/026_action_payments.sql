CREATE TABLE pact_action_payments (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES pact_users(id),
 action text NOT NULL CHECK(action IN ('agent.create','grant.create','policy.create','key.create')),
 path text NOT NULL,
 payload jsonb NOT NULL,
 request_hash text NOT NULL,
 payer text NOT NULL,
 treasury text NOT NULL,
 chain_id integer NOT NULL,
 amount_wei numeric(78,0) NOT NULL CHECK(amount_wei=5000000000000000000),
 tx_data text NOT NULL,
 tx_hash text,
 confirmed_at timestamptz,
 consumed_at timestamptz,
 resource_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(chain_id,tx_hash),
 CHECK ((consumed_at IS NULL AND resource_id IS NULL) OR (consumed_at IS NOT NULL AND resource_id IS NOT NULL AND confirmed_at IS NOT NULL))
);
CREATE INDEX pact_action_payments_owner ON pact_action_payments(owner_id,created_at DESC);
CREATE UNIQUE INDEX pact_action_payments_pending ON pact_action_payments(owner_id,request_hash) WHERE consumed_at IS NULL;
