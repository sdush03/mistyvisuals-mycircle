-- Add gallery_faces_complete to gallery_events
ALTER TABLE gallery_events
  ADD COLUMN IF NOT EXISTS gallery_faces_complete BOOLEAN DEFAULT TRUE;

-- Add faces_scanned to photos
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS faces_scanned BOOLEAN DEFAULT TRUE;

-- Add index for efficient unscanned photo lookups
CREATE INDEX IF NOT EXISTS idx_photos_event_id_faces_scanned
  ON photos(event_id, faces_scanned);
