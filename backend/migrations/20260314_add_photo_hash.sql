ALTER TABLE photo_library ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE INDEX IF NOT EXISTS photo_library_content_hash_idx ON photo_library (content_hash);
