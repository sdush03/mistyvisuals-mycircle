-- CreateTable photo_likes
CREATE TABLE IF NOT EXISTS photo_likes (
    id SERIAL PRIMARY KEY,
    photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT photo_likes_photo_id_guest_id_key UNIQUE (photo_id, guest_id)
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS idx_photo_likes_photo_id ON photo_likes(photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_likes_guest_id ON photo_likes(guest_id);
