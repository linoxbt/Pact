CREATE TABLE pact_indexer_configuration (
  chain_id bigint PRIMARY KEY,
  fingerprint text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
