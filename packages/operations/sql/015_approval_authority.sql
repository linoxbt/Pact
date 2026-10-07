ALTER TABLE pact_endpoints ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE FUNCTION pact_endpoint_version() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW)-'last_used_at'-'updated_at'-'version') IS DISTINCT FROM
     (to_jsonb(OLD)-'last_used_at'-'updated_at'-'version') THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER pact_endpoint_version BEFORE UPDATE ON pact_endpoints
  FOR EACH ROW EXECUTE FUNCTION pact_endpoint_version();
ALTER TABLE pact_proxy_approvals
  ADD COLUMN grant_version integer,
  ADD COLUMN policy_version integer,
  ADD COLUMN endpoint_version integer;
-- Pre-migration approvals have no authority snapshot and must be reissued.
UPDATE pact_proxy_approvals SET state='expired' WHERE state IN ('pending','approved');
