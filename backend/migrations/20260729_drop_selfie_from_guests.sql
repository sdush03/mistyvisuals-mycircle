-- Drop redundant selfie columns from guests table
-- circle_users is the single source of truth for selfie_vector and selfie_url.
-- Guests only store per-event data; selfie identity is global per circle_user.
ALTER TABLE guests DROP COLUMN IF EXISTS selfie_vector;
ALTER TABLE guests DROP COLUMN IF EXISTS selfie_url;
