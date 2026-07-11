-- Migration: Add missing columns to gallery_events, photos, and guests tables
-- Applied: 2026-07-09

ALTER TABLE gallery_events ADD COLUMN IF NOT EXISTS clusters_dirty BOOLEAN DEFAULT TRUE NOT NULL;
ALTER TABLE gallery_events ADD COLUMN IF NOT EXISTS clusters_cache JSONB;
ALTER TABLE gallery_events ADD COLUMN IF NOT EXISTS cover_photo_square_url VARCHAR(1024);

ALTER TABLE photos ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

ALTER TABLE guests ADD COLUMN IF NOT EXISTS has_full_access BOOLEAN DEFAULT FALSE;
