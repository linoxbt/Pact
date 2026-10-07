ALTER TABLE pact_operations ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN reconcile_attempts integer NOT NULL DEFAULT 0;
CREATE INDEX pact_operations_due ON pact_operations(next_attempt_at,submitted_at)
  WHERE state IN ('submitted','recoverable') AND tx_hash IS NOT NULL;
