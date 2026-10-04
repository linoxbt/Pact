ALTER TABLE pact_users DROP CONSTRAINT pact_users_principal_status_check;
ALTER TABLE pact_users ADD CONSTRAINT pact_users_principal_status_check
  CHECK (principal_status IN ('unverified','account_assigned','verified'));
