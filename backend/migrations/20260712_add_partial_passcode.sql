-- Add partial_passcode column to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS partial_passcode VARCHAR(50);

-- Backfill existing projects with a random 4-digit numeric code if null
UPDATE projects
SET partial_passcode = LPAD(floor(random() * 9000 + 1000)::text, 4, '0')
WHERE partial_passcode IS NULL;
