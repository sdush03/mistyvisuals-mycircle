-- Add status column to guests table for WhatsApp-style "Left Celebration" tracking
ALTER TABLE guests ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE guests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_guests_status ON guests(status);
