-- Add project_id (UUID) to gallery_events for a stable, slug-independent link to projects.
-- Slug remains in gallery_events for the public client portal URL, but admin lookups
-- and gallery creation now use project_id so changing a project slug never creates duplicates.

ALTER TABLE gallery_events
  ADD COLUMN IF NOT EXISTS project_id TEXT;

-- Backfill: link any existing gallery_events that have a lead_id to their project
UPDATE gallery_events ge
SET project_id = p.id::text
FROM projects p
WHERE ge.lead_id = p.lead_id
  AND ge.project_id IS NULL;

-- Unique index: one gallery per project (NULLs are allowed for legacy rows without a project)
CREATE UNIQUE INDEX IF NOT EXISTS idx_gallery_events_project_id
  ON gallery_events(project_id)
  WHERE project_id IS NOT NULL;
