-- Usage timestamps are telemetry, not owner configuration changes.
CREATE OR REPLACE FUNCTION pact_audit_control_mutation() RETURNS trigger AS $$
DECLARE row_data jsonb; subject_id uuid; subject_did text; subject_principal text;
BEGIN
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'last_used_at'-'updated_at')
      IS NOT DISTINCT FROM (to_jsonb(OLD)-'last_used_at'-'updated_at') THEN RETURN NEW; END IF;
  row_data := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  subject_id := (COALESCE(row_data->>'owner_id',row_data->>'user_id'))::uuid;
  SELECT privy_did,COALESCE(principal_address,privy_did) INTO subject_did,subject_principal
    FROM pact_users WHERE id=subject_id;
  INSERT INTO pact_audit_events(principal,actor,action,details)
    VALUES(subject_principal,subject_did,'control.'||TG_TABLE_NAME||'.'||lower(TG_OP),
      jsonb_build_object('recordId',row_data->>'id'));
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE INDEX pact_audit_retention_idx ON pact_audit_events(created_at);
CREATE INDEX pact_dispatch_request_idx ON pact_proxy_dispatches(request_id);
CREATE INDEX pact_dispatch_retention_idx ON pact_proxy_dispatches(updated_at);
