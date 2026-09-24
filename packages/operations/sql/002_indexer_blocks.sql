CREATE TABLE IF NOT EXISTS pact_indexer_blocks (
  chain_id integer NOT NULL,
  block_number numeric(78,0) NOT NULL,
  block_hash text NOT NULL,
  PRIMARY KEY (chain_id, block_number)
);
