ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS coverage_scope TEXT NOT NULL DEFAULT 'Both Sides';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_coverage_scope_check'
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_coverage_scope_check
      CHECK (coverage_scope IN ('Both Sides', 'Bride Side', 'Groom Side'));
  END IF;
END$$;
