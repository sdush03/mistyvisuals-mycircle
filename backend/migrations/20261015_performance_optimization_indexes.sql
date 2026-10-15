-- Performance Optimization Indexes (Issue 32)
-- High-impact indexes to eliminate full table scans and disk filesorts

-- 1. Photos: Sorting for Gallery listing & Filmstrip (captured_at ASC, id ASC)
CREATE INDEX IF NOT EXISTS idx_photos_event_captured_id ON photos (event_id, captured_at ASC, id ASC);

-- 2. Photos: Tab filtering & aggregation
CREATE INDEX IF NOT EXISTS idx_photos_event_tab ON photos (event_id, tab_name);

-- 3. Photos: Partial index for undiscovered/unscanned photos
CREATE INDEX IF NOT EXISTS idx_photos_event_discovered ON photos (event_id, discovered) WHERE discovered = false;

-- 4. Saved Photos: Bookmark existence check by photo URL
CREATE INDEX IF NOT EXISTS idx_saved_photos_url ON saved_photos (photo_url);

-- 5. Saved Photos: Guest saves query ordered by creation
CREATE INDEX IF NOT EXISTS idx_saved_photos_user_created ON saved_photos (user_id, created_at DESC);

-- 6. Saved Photos: Couple/Event saves query ordered by creation
CREATE INDEX IF NOT EXISTS idx_saved_photos_event_created ON saved_photos (event_id, created_at DESC);

-- 7. Guests: Case-insensitive email lookups
CREATE INDEX IF NOT EXISTS idx_guests_lower_email ON guests (LOWER(email));

-- 8. Guests: Phone-based lookups
CREATE INDEX IF NOT EXISTS idx_guests_phone ON guests (phone_number);

-- 9. Circle Users: Phone-based lookups
CREATE INDEX IF NOT EXISTS idx_circle_users_phone ON circle_users (phone_number);

-- 10. Circle Users: Provider ID lookups (Google/Apple)
CREATE INDEX IF NOT EXISTS idx_circle_users_provider ON circle_users (provider_id);

-- 11. User Sessions: Stale session cleanup partial index
CREATE INDEX IF NOT EXISTS idx_sessions_cleanup ON user_sessions (last_seen_at) WHERE logout_at IS NULL;

-- 12. User Sessions: Session heartbeat & user lookups
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON user_sessions (user_id, logout_at, login_at DESC);

-- 13. Gallery Analytics Events: Composite index for replay / filtering
CREATE INDEX IF NOT EXISTS idx_analytics_event_type_created ON gallery_analytics_events (event_id, event_type, created_at);

-- 14. Push Tokens: Active notification delivery candidate lookups
CREATE INDEX IF NOT EXISTS idx_push_tokens_active ON user_push_tokens (is_active, created_at);
