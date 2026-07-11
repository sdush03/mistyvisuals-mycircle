-- Add date_status column to lead_events
-- Values: 'confirmed' (default), 'tentative', 'tba'
ALTER TABLE lead_events ADD COLUMN IF NOT EXISTS date_status VARCHAR(20) DEFAULT 'confirmed';
