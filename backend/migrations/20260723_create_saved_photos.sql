-- CreateTable saved_photos
CREATE TABLE IF NOT EXISTS saved_photos (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES gallery_events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES circle_users(id) ON DELETE CASCADE,
    display_role VARCHAR(50) DEFAULT 'GUEST' NOT NULL,
    photo_url VARCHAR(1024) NOT NULL,
    story_id VARCHAR(255),
    source_type VARCHAR(50) DEFAULT 'FEATURED_STORY' NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT saved_photos_event_photo_user_key UNIQUE (event_id, photo_url, user_id)
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS idx_saved_photos_event_id ON saved_photos(event_id);
CREATE INDEX IF NOT EXISTS idx_saved_photos_user_id ON saved_photos(user_id);
