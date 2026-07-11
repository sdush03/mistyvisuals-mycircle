CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id_created_at
  ON lead_activities (lead_id, created_at);

CREATE INDEX IF NOT EXISTS idx_lead_activities_type_created_at
  ON lead_activities (activity_type, created_at);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_id_created_at
  ON lead_notes (lead_id, created_at);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_followups') THEN
    CREATE INDEX IF NOT EXISTS idx_lead_followups_lead_id_follow_up_at
      ON lead_followups (lead_id, follow_up_at);
  END IF;
END
$$;
