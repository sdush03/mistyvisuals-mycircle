-- Migration: Add gallery_analytics_events table for mobile & web analytics ingestion

CREATE TABLE IF NOT EXISTS gallery_analytics_events (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES gallery_events(id) ON DELETE CASCADE,
    guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
    guest_email VARCHAR(255),
    guest_name VARCHAR(255),
    guest_phone VARCHAR(50),
    event_type VARCHAR(50) NOT NULL,
    media_id VARCHAR(255),
    media_type VARCHAR(20),
    media_url TEXT,
    action VARCHAR(50),
    source VARCHAR(50),
    duration_ms INTEGER DEFAULT 0,
    watch_time_seconds NUMERIC(10,2) DEFAULT 0.00,
    total_duration_seconds NUMERIC(10,2) DEFAULT 0.00,
    completion_ratio NUMERIC(5,4) DEFAULT 0.0000,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gallery_analytics_event_id ON gallery_analytics_events(event_id);
CREATE INDEX IF NOT EXISTS idx_gallery_analytics_guest_id ON gallery_analytics_events(guest_id);
CREATE INDEX IF NOT EXISTS idx_gallery_analytics_event_type ON gallery_analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_gallery_analytics_media_id ON gallery_analytics_events(media_id);
