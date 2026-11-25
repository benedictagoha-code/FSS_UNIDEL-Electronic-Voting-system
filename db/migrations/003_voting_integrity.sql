-- Expiry index for outstanding one-time voting authorisations.
-- The authorisation table and ballot uniqueness constraint are created by
-- 003_secret_ballot_voting.sql, which runs immediately before this migration.
CREATE INDEX IF NOT EXISTS idx_voting_auth_expiry
  ON voting_authorisations(expires_at) WHERE consumed_at IS NULL;
