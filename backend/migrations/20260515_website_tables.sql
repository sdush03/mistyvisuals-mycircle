-- =============================================================
-- Misty Visuals Public Website Tables
-- =============================================================

-- Website hero media (image or video for the homepage hero)
CREATE TABLE IF NOT EXISTS website_hero (
  id            SERIAL PRIMARY KEY,
  media_type    TEXT NOT NULL DEFAULT 'image',         -- 'image' | 'video'
  media_url     TEXT NOT NULL,                          -- desktop optimized WebP or HLS url
  mobile_url    TEXT,                                   -- mobile optimized WebP
  poster_url    TEXT,                                   -- blur poster for video
  headline      TEXT,
  subline       TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Published wedding/editorial story galleries
CREATE TABLE IF NOT EXISTS website_stories (
  id                     SERIAL PRIMARY KEY,
  slug                   TEXT UNIQUE NOT NULL,
  title                  TEXT NOT NULL,
  subtitle               TEXT,
  location               TEXT,
  year                   INT,
  category               TEXT,                          -- 'wedding' | 'pre-wedding' | 'engagement'
  cover_image_url        TEXT,                          -- desktop WebP
  cover_image_mobile_url TEXT,                          -- mobile WebP
  cover_blur_data_url    TEXT,                          -- base64 blur placeholder
  is_featured            BOOLEAN NOT NULL DEFAULT false,
  display_order          INT NOT NULL DEFAULT 0,
  is_published           BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Individual photos inside a story gallery
CREATE TABLE IF NOT EXISTS website_story_photos (
  id                SERIAL PRIMARY KEY,
  story_id          INT NOT NULL REFERENCES website_stories(id) ON DELETE CASCADE,
  file_url          TEXT NOT NULL,                      -- desktop WebP (1920px) — public
  file_url_mobile   TEXT,                               -- mobile WebP (800px) — public
  file_url_thumb    TEXT,                               -- thumbnail WebP (400px) — public
  blur_data_url     TEXT,                               -- base64 tiny placeholder
  original_filename TEXT,                               -- original upload filename
  display_order     INT NOT NULL DEFAULT 0,
  is_cover          BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Portfolio films with HLS streaming
CREATE TABLE IF NOT EXISTS website_films (
  id              SERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  subtitle        TEXT,
  location        TEXT,
  year            INT,
  category        TEXT,
  thumbnail_url   TEXT,                                 -- WebP thumbnail
  thumbnail_blur  TEXT,                                 -- base64 blur placeholder
  hls_url         TEXT,                                 -- /media/website/films/{id}/stream/master.m3u8
  transcode_status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'processing' | 'ready' | 'error'
  transcode_error  TEXT,
  is_featured     BOOLEAN NOT NULL DEFAULT false,
  display_order   INT NOT NULL DEFAULT 0,
  is_published    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Client testimonials
CREATE TABLE IF NOT EXISTS website_testimonials (
  id             SERIAL PRIMARY KEY,
  quote          TEXT NOT NULL,
  client_name    TEXT NOT NULL,
  location       TEXT,
  year           INT,
  display_order  INT NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Homepage section visibility and ordering
CREATE TABLE IF NOT EXISTS website_sections (
  id             SERIAL PRIMARY KEY,
  key            TEXT UNIQUE NOT NULL,                  -- 'hero' | 'stories' | 'philosophy' | 'films' | 'experience' | 'testimonials' | 'inquiry'
  label          TEXT NOT NULL,
  is_visible     BOOLEAN NOT NULL DEFAULT true,
  display_order  INT NOT NULL DEFAULT 0,
  content        JSONB NOT NULL DEFAULT '{}'            -- editable copy/config per section
);

-- Seed default sections
INSERT INTO website_sections (key, label, display_order, content) VALUES
  ('hero',         'Hero',          1, '{"headline": "Misty Visuals", "subline": "Luxury Wedding Photography & Films"}'),
  ('stories',      'Stories',       2, '{"heading": "Featured Stories"}'),
  ('philosophy',   'Philosophy',    3, '{"quote": "We don''t chase moments. We wait for them.", "body": "Every wedding is a singular, unrepeatable story. We arrive to witness it with patience, intention, and quiet reverence."}'),
  ('films',        'Films',         4, '{"heading": "Films"}'),
  ('experience',   'Experience',    5, '{"heading": "The Experience"}'),
  ('testimonials', 'Testimonials',  6, '{"heading": "Families We''ve Served"}'),
  ('inquiry',      'Inquiry',       7, '{"headline": "Begin Your Story", "subline": "Let''s create something timeless together."}')
ON CONFLICT (key) DO NOTHING;

-- Indexes for fast public queries
CREATE INDEX IF NOT EXISTS idx_website_stories_featured   ON website_stories(is_featured, is_published, display_order);
CREATE INDEX IF NOT EXISTS idx_website_stories_slug       ON website_stories(slug) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_website_story_photos_story ON website_story_photos(story_id, display_order);
CREATE INDEX IF NOT EXISTS idx_website_films_featured     ON website_films(is_featured, is_published, display_order);
CREATE INDEX IF NOT EXISTS idx_website_testimonials_active ON website_testimonials(is_active, display_order);
