-- ============================================================
-- 20260706_add_event_and_invoice_verification.sql
-- Add verification status flags for client confirmation
-- ============================================================

ALTER TABLE project_events ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
