DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deliverable_category') THEN
    CREATE TYPE deliverable_category AS ENUM ('PHOTO', 'VIDEO', 'OTHER');
  END IF;
END $$;

ALTER TABLE deliverable_catalog ADD COLUMN IF NOT EXISTS category deliverable_category NOT NULL DEFAULT 'OTHER';
