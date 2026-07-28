-- Add selfie_vector and selfie_url columns to circle_users and guests tables
ALTER TABLE circle_users ADD COLUMN IF NOT EXISTS selfie_vector JSONB;
ALTER TABLE circle_users ADD COLUMN IF NOT EXISTS selfie_url VARCHAR(1024);

ALTER TABLE guests ADD COLUMN IF NOT EXISTS selfie_vector JSONB;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS selfie_url VARCHAR(1024);
