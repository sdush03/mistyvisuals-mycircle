-- Add cover_photo_mobile_url column to gallery_events table
ALTER TABLE gallery_events ADD COLUMN IF NOT EXISTS cover_photo_mobile_url TEXT;
