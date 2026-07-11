-- Finance: Account Transfers v1

ALTER TABLE finance_transactions
ADD COLUMN IF NOT EXISTS is_transfer BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS transfer_group_id TEXT;

ALTER TABLE finance_transactions
DROP CONSTRAINT IF EXISTS finance_transactions_lead_overhead_check;

ALTER TABLE finance_transactions
ADD CONSTRAINT finance_transactions_lead_overhead_check
CHECK (
  (
    is_transfer = true
    AND lead_id IS NULL
    AND is_overhead = false
  )
  OR (
    is_transfer = false
    AND (
      (lead_id IS NOT NULL AND is_overhead = false)
      OR (lead_id IS NULL AND is_overhead = true)
    )
  )
);

CREATE INDEX IF NOT EXISTS finance_transactions_transfer_group_idx ON finance_transactions(transfer_group_id);
