-- Keep a minimal, credential-free audit trail in the same transaction as every
-- control-plane mutation, including writes made outside the HTTP API.
CREATE OR REPLACE FUNCTION pact_audit_control_mutation() RETURNS trigger AS $$
DECLARE
  row_data jsonb;
  subject_id uuid;
  subject_did text;
  subject_principal text;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  subject_id := (COALESCE(row_data->>'owner_id', row_data->>'user_id'))::uuid;
  SELECT privy_did, COALESCE(principal_address, privy_did)
    INTO subject_did, subject_principal FROM pact_users WHERE id=subject_id;
  INSERT INTO pact_audit_events(principal, actor, action, details)
    VALUES(subject_principal, subject_did, 'control.' || TG_TABLE_NAME || '.' || lower(TG_OP),
      jsonb_build_object('recordId', row_data->>'id'));
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pact_principal_history', 'pact_connected_agents', 'pact_authority_grants',
    'pact_http_policies', 'pact_services', 'pact_upstream_secrets',
    'pact_endpoints', 'pact_integration_keys', 'pact_proxy_approvals'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION pact_audit_control_mutation()',
      table_name || '_audit', table_name);
  END LOOP;
END;
$$;
