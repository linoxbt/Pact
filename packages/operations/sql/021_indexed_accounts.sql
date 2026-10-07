CREATE TABLE pact_indexed_accounts (
  chain_id integer NOT NULL,
  factory text NOT NULL,
  address text NOT NULL,
  principal text NOT NULL,
  created_block numeric(78,0) NOT NULL,
  PRIMARY KEY(chain_id,address)
);
