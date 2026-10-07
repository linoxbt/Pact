CREATE TABLE pact_ingress_limits (
  bucket text NOT NULL,
  period_start timestamptz NOT NULL,
  requests integer NOT NULL,
  PRIMARY KEY(bucket,period_start)
);
CREATE INDEX pact_ingress_limits_expiry ON pact_ingress_limits(period_start);
