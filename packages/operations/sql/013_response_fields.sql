ALTER TABLE pact_endpoints
  ADD COLUMN response_fields text[] NOT NULL DEFAULT '{}';
