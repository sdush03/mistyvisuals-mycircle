-- Add full_code and partial_code to gallery_events table
ALTER TABLE gallery_events ADD COLUMN IF NOT EXISTS full_code VARCHAR(6);
ALTER TABLE gallery_events ADD COLUMN IF NOT EXISTS partial_code VARCHAR(6);

-- Add unique constraints
ALTER TABLE gallery_events ADD CONSTRAINT gallery_events_full_code_key UNIQUE (full_code);
ALTER TABLE gallery_events ADD CONSTRAINT gallery_events_partial_code_key UNIQUE (partial_code);

-- Remove partial_passcode from projects table
ALTER TABLE projects DROP COLUMN IF EXISTS partial_passcode;
