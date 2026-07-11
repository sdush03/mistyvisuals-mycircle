-- Migration to add venue metadata columns to lead_events
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lead_events' AND column_name='venue_id') THEN
        ALTER TABLE lead_events ADD COLUMN venue_id TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lead_events' AND column_name='venue_metadata') THEN
        ALTER TABLE lead_events ADD COLUMN venue_metadata JSONB;
    END IF;
END $$;
