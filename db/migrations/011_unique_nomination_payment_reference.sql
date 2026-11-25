-- A bank/payment-provider transaction reference may only support one nomination.
-- Case and surrounding whitespace do not create a new reference.
CREATE UNIQUE INDEX IF NOT EXISTS nomination_payments_transaction_reference_unique
  ON nomination_payments (LOWER(BTRIM(transaction_reference)))
  WHERE transaction_reference IS NOT NULL AND BTRIM(transaction_reference) <> '';
