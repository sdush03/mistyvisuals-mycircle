-- CreateTable gallery_events
CREATE TABLE IF NOT EXISTS gallery_events (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER,
    slug VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    date TIMESTAMP NOT NULL,
    qr_token VARCHAR(255) UNIQUE NOT NULL,
    cover_photo_url VARCHAR(1024),
    active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- CreateTable photos
CREATE TABLE IF NOT EXISTS photos (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES gallery_events(id) ON DELETE CASCADE,
    r2_url VARCHAR(1024) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    file_size INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- CreateTable guests
CREATE TABLE IF NOT EXISTS guests (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES gallery_events(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    phone_number VARCHAR(50),
    provider VARCHAR(50) DEFAULT 'google' NOT NULL,
    provider_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT guests_event_id_email_key UNIQUE (event_id, email)
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS idx_gallery_events_slug ON gallery_events(slug);
CREATE INDEX IF NOT EXISTS idx_gallery_events_qr_token ON gallery_events(qr_token);
CREATE INDEX IF NOT EXISTS idx_photos_event_id ON photos(event_id);
CREATE INDEX IF NOT EXISTS idx_guests_event_id ON guests(event_id);
