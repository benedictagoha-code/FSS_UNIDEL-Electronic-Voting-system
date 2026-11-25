CREATE TABLE IF NOT EXISTS nomination_payment_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bank_name VARCHAR(100) NOT NULL,
  account_name VARCHAR(180) NOT NULL,
  account_number VARCHAR(30) NOT NULL,
  payment_instructions TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nomination_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_id UUID NOT NULL UNIQUE REFERENCES nominations(id) ON DELETE RESTRICT,
  document_type VARCHAR(30) NOT NULL DEFAULT 'nomination_form',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nominations_candidate ON nominations(candidate_user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status ON nomination_payments(verification_status, submitted_at DESC);
