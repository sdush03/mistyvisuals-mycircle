-- Add display_role column to guests table
ALTER TABLE guests ADD COLUMN IF NOT EXISTS display_role VARCHAR(50);
