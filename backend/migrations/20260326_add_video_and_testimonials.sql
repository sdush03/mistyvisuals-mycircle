CREATE TABLE IF NOT EXISTS video_library (
  id SERIAL PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_hash TEXT UNIQUE,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS video_library_created_at_idx ON video_library (created_at DESC);
CREATE INDEX IF NOT EXISTS video_library_tags_idx ON video_library USING GIN (tags);

CREATE TABLE IF NOT EXISTS testimonials (
  id SERIAL PRIMARY KEY,
  couple_names TEXT NOT NULL,
  testimonial_text TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT DEFAULT 'photo',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS testimonials_created_at_idx ON testimonials (created_at DESC);
