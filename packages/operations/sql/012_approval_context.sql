ALTER TABLE pact_proxy_approvals
  ADD COLUMN grant_id uuid REFERENCES pact_authority_grants(id),
  ADD COLUMN policy_id uuid REFERENCES pact_http_policies(id),
  ADD COLUMN matched_rule text,
  ADD COLUMN cost_minor numeric(78,0),
  ADD COLUMN currency text;
