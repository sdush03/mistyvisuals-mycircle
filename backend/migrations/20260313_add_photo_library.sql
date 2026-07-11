CREATE TABLE IF NOT EXISTS photo_library (
  id SERIAL PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS photo_library_created_at_idx
  ON photo_library (created_at DESC);

CREATE INDEX IF NOT EXISTS photo_library_tags_idx
  ON photo_library USING GIN (tags);
