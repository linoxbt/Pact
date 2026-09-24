CREATE TABLE IF NOT EXISTS pact_service_heartbeats (
  service text PRIMARY KEY,
  instance_id uuid NOT NULL,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
