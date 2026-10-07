ALTER TABLE pact_authority_grants ADD COLUMN allowed_recipients text[] NOT NULL DEFAULT '{}';
ALTER TABLE pact_endpoints ADD COLUMN economic_constraints jsonb;
