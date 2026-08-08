-- Migration: Add is_private flag to photos table for Locked Vault feature
-- Only Bride & Groom can mark photos as private. Private photos are hidden from all other guests.

ALTER TABLE photos ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_photos_is_private ON photos (event_id, is_private);
