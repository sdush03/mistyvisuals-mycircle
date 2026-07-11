-- migration 20260516_website_films_youtube.sql
ALTER TABLE website_films ADD COLUMN youtube_url TEXT;
ALTER TABLE website_films ADD COLUMN youtube_video_id TEXT;
