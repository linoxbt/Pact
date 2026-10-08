-- Disposable authenticated upstreams for real gateway verification. Never model credentials.
CREATE TABLE pact_verification_probes (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES pact_users(id),
  secret_hash text NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  authenticated_requests integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes'
);
CREATE INDEX pact_verification_probes_owner ON pact_verification_probes(owner_id);
CREATE TRIGGER pact_verification_probe_quota BEFORE INSERT ON pact_verification_probes
  FOR EACH ROW EXECUTE FUNCTION pact_control_resource_quota();
