-- Finance: reference codes for transactions

ALTER TABLE finance_transactions
ADD COLUMN IF NOT EXISTS reference_code TEXT;

-- Backfill reference codes with duplicate-safe suffixes
WITH base_codes AS (
  SELECT
    ft.id,
    CASE
      WHEN ft.vendor_bill_id IS NOT NULL THEN 'VENDOR-' || ft.vendor_bill_id
      WHEN ft.is_transfer = true THEN 'TR-' || ft.transfer_group_id
      WHEN ft.is_overhead = true THEN 'OH-' || COALESCE(ft.category_id::text, 'NA') || '-' || TO_CHAR(ft.date, 'YYYYMMDD')
      WHEN ft.user_id IS NOT NULL THEN 'PAYROLL-' || ft.user_id || '-' || TO_CHAR(ft.date, 'YYYYMM')
      WHEN ft.direction = 'in' THEN 'INV-' || ft.lead_id || '-' || ft.id
      ELSE 'TX-' || ft.id
    END AS base_code
  FROM finance_transactions ft
  WHERE ft.reference_code IS NULL
),
ranked AS (
  SELECT id,
         base_code,
         ROW_NUMBER() OVER (PARTITION BY base_code ORDER BY id) AS rn
  FROM base_codes
)
UPDATE finance_transactions f
SET reference_code =
  CASE
    WHEN ranked.rn = 1 THEN ranked.base_code
    ELSE ranked.base_code || '-T' || f.id
  END
FROM ranked
WHERE f.id = ranked.id;

CREATE UNIQUE INDEX IF NOT EXISTS finance_transactions_reference_code_idx
ON finance_transactions(reference_code);
