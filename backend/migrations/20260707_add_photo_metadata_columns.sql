-- Add tab_name, exif, and captured_at columns to photos table
ALTER TABLE photos ADD COLUMN IF NOT EXISTS tab_name TEXT;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS exif JSONB;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS captured_at TIMESTAMP;
