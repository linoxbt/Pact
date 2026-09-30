CREATE TABLE pact_users (
  id uuid PRIMARY KEY,
  privy_did text NOT NULL UNIQUE,
  principal_address text UNIQUE,
  principal_status text NOT NULL DEFAULT 'unverified'
    CHECK (principal_status IN ('unverified','verified')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pact_address_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES pact_users(id),
  address text NOT NULL,
  action text NOT NULL CHECK (action IN ('enroll','change')),
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE pact_principal_history (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES pact_users(id),
  previous_address text,
  new_address text NOT NULL,
  proof_hash text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pact_connected_agents (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES pact_users(id),
  name text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('development','staging','production')),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pact_connected_agents_owner_idx ON pact_connected_agents(owner_id,created_at DESC);
CREATE TABLE pact_authority_grants (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES pact_users(id),
  agent_id uuid NOT NULL REFERENCES pact_connected_agents(id),
  principal_address text NOT NULL,
  name text NOT NULL,
  resource_origins text[] NOT NULL,
  actions text[] NOT NULL,
  destination_origins text[] NOT NULL,
  currency text NOT NULL,
  per_action_limit_minor numeric(78,0) NOT NULL CHECK (per_action_limit_minor >= 0),
  aggregate_limit_minor numeric(78,0) NOT NULL CHECK (aggregate_limit_minor >= 0),
  approval_threshold_minor numeric(78,0) NOT NULL CHECK (approval_threshold_minor >= 0),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > starts_at)
);
CREATE INDEX pact_authority_grants_owner_idx ON pact_authority_grants(owner_id,created_at DESC);
CREATE TABLE pact_grant_usage (
  grant_id uuid PRIMARY KEY REFERENCES pact_authority_grants(id),
  spent_minor numeric(78,0) NOT NULL DEFAULT 0 CHECK (spent_minor >= 0)
);
CREATE TABLE pact_http_policies (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES pact_users(id),
  agent_id uuid NOT NULL REFERENCES pact_connected_agents(id),
  name text NOT NULL,
  rules jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pact_http_policies_owner_idx ON pact_http_policies(owner_id,created_at DESC);
CREATE TABLE pact_services (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES pact_users(id),
  agent_id uuid NOT NULL REFERENCES pact_connected_agents(id),
  name text NOT NULL,
  base_url text NOT NULL,
  auth_method text NOT NULL CHECK (auth_method IN ('none','bearer','header')),
  auth_header text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pact_services_agent_idx ON pact_services(agent_id,created_at DESC);
CREATE TABLE pact_upstream_secrets (
  id uuid PRIMARY KEY,
  service_id uuid NOT NULL UNIQUE REFERENCES pact_services(id),
  owner_id uuid NOT NULL REFERENCES pact_users(id),
  ciphertext text NOT NULL,
  encrypted_key text NOT NULL,
  kms_key_id text NOT NULL,
  cipher_version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pact_endpoints (
  id uuid PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES pact_services(id),
  agent_id uuid NOT NULL REFERENCES pact_connected_agents(id),
  owner_id uuid NOT NULL REFERENCES pact_users(id),
  grant_id uuid NOT NULL REFERENCES pact_authority_grants(id),
  policy_id uuid NOT NULL REFERENCES pact_http_policies(id),
  method text NOT NULL CHECK (method IN ('GET','POST','PUT','PATCH','DELETE')),
  path_pattern text NOT NULL,
  description text NOT NULL DEFAULT '',
  cost_minor numeric(78,0) NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_id,method,path_pattern)
);
CREATE INDEX pact_endpoints_agent_idx ON pact_endpoints(agent_id,created_at DESC);
CREATE TABLE pact_integration_keys (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES pact_users(id),
  agent_id uuid NOT NULL REFERENCES pact_connected_agents(id),
  token_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  name text NOT NULL,
  scopes text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_from uuid REFERENCES pact_integration_keys(id),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pact_integration_keys_agent_idx ON pact_integration_keys(agent_id,created_at DESC);
CREATE TABLE pact_policy_usage (
  policy_id uuid NOT NULL REFERENCES pact_http_policies(id),
  rule_id text NOT NULL,
  period_start bigint NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  spent_minor numeric(78,0) NOT NULL DEFAULT 0,
  PRIMARY KEY(policy_id,rule_id,period_start)
);
CREATE TABLE pact_proxy_approvals (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES pact_users(id),
  agent_id uuid NOT NULL REFERENCES pact_connected_agents(id),
  endpoint_id uuid NOT NULL REFERENCES pact_endpoints(id),
  request_hash text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','consumed','expired')),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pact_proxy_approvals_owner_idx ON pact_proxy_approvals(owner_id,created_at DESC);
CREATE TABLE pact_proxy_activity (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES pact_users(id),
  agent_id uuid NOT NULL REFERENCES pact_connected_agents(id),
  service_id uuid REFERENCES pact_services(id),
  endpoint_id uuid REFERENCES pact_endpoints(id),
  grant_id uuid REFERENCES pact_authority_grants(id),
  policy_id uuid REFERENCES pact_http_policies(id),
  key_id uuid REFERENCES pact_integration_keys(id),
  approval_id uuid REFERENCES pact_proxy_approvals(id),
  method text NOT NULL,
  route text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('allowed','denied','pending_approval')),
  matched_rule text,
  reason text NOT NULL,
  trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  upstream_status integer,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pact_proxy_activity_owner_idx ON pact_proxy_activity(owner_id,created_at DESC,id DESC);
