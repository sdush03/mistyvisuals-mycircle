-- Add tags column to saved_photos table for moodboard categorization
ALTER TABLE saved_photos ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_saved_photos_tags ON saved_photos USING GIN(tags);
