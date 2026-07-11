-- Add ADDON to the deliverable_category enum
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deliverable_category') THEN
    ALTER TYPE deliverable_category ADD VALUE IF NOT EXISTS 'ADDON';
  END IF;
END $$;

-- Add description column if not exists
ALTER TABLE deliverable_catalog ADD COLUMN IF NOT EXISTS description TEXT NULL;
