-- Finance integrity: transaction_type + balances snapshot

ALTER TABLE finance_transactions
ADD COLUMN IF NOT EXISTS transaction_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'finance_transactions_type_check'
  ) THEN
    ALTER TABLE finance_transactions
    ADD CONSTRAINT finance_transactions_type_check
    CHECK (
      transaction_type IN (
        'invoice_payment',
        'vendor_payment',
        'payroll',
        'overhead',
        'transfer'
      )
    );
  END IF;
END $$;

-- Backfill existing data
UPDATE finance_transactions
SET transaction_type = CASE
  WHEN vendor_bill_id IS NOT NULL THEN 'vendor_payment'
  WHEN is_transfer = true THEN 'transfer'
  WHEN user_id IS NOT NULL THEN 'payroll'
  WHEN is_overhead = true THEN 'overhead'
  WHEN direction = 'in' AND lead_id IS NOT NULL THEN 'invoice_payment'
  ELSE transaction_type
END
WHERE transaction_type IS NULL;

CREATE TABLE IF NOT EXISTS finance_account_balances (
  money_source_id INTEGER PRIMARY KEY REFERENCES money_sources(id) ON DELETE CASCADE,
  balance NUMERIC NOT NULL DEFAULT 0,
  last_calculated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
