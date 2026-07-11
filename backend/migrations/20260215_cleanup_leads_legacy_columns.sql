DROP VIEW IF EXISTS leads_ordered;

ALTER TABLE leads
  DROP COLUMN IF EXISTS budget_bucket,
  DROP COLUMN IF EXISTS description;

CREATE OR REPLACE VIEW leads_ordered AS
SELECT
  id,
  name,
  phone_primary,
  phone_secondary,
  email,
  instagram,
  bride_name,
  bride_phone_primary,
  bride_phone_secondary,
  bride_email,
  bride_instagram,
  groom_name,
  groom_phone_primary,
  groom_phone_secondary,
  groom_email,
  groom_instagram,
  source,
  status,
  previous_status,
  heat,
  event_type,
  is_destination,
  country,
  created_at,
  updated_at
FROM leads;
