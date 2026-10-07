-- Database enforcement also covers concurrent requests and bulk imports.
CREATE FUNCTION pact_control_resource_quota() RETURNS trigger AS $$
DECLARE resource_count bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_NAME || ':' || NEW.owner_id::text, 0));
  EXECUTE format('SELECT count(*) FROM %I WHERE owner_id=$1',TG_TABLE_NAME)
    INTO resource_count USING NEW.owner_id;
  IF resource_count >= 1000 THEN
    RAISE EXCEPTION 'RESOURCE_QUOTA_EXCEEDED' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DO $$
DECLARE resource_table text;
BEGIN
  FOREACH resource_table IN ARRAY ARRAY['pact_connected_agents','pact_authority_grants',
    'pact_http_policies','pact_services','pact_endpoints','pact_integration_keys'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW
      EXECUTE FUNCTION pact_control_resource_quota()',resource_table || '_quota',resource_table);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(owner_id)',resource_table || '_quota_owner',resource_table);
  END LOOP;
END;
$$;
