CREATE TABLE IF NOT EXISTS vendor_rate_cards (
  id SERIAL PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  rate_type TEXT NOT NULL CHECK (rate_type IN ('per_day', 'per_function', 'flat')),
  rates JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vendor_rate_cards_vendor_id_idx ON vendor_rate_cards(vendor_id);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_rate_cards_active_unique ON vendor_rate_cards(vendor_id) WHERE is_active = true;

CREATE OR REPLACE FUNCTION enforce_freelancer_vendor_rate_card() RETURNS trigger AS $$
DECLARE
  vtype TEXT;
BEGIN
  SELECT vendor_type INTO vtype FROM vendors WHERE id = NEW.vendor_id;
  IF vtype IS NULL THEN
    RAISE EXCEPTION 'Vendor not found';
  END IF;
  IF vtype <> 'freelancer' THEN
    RAISE EXCEPTION 'Rate cards allowed only for freelancer vendors';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'vendor_rate_cards_vendor_type_check'
  ) THEN
    CREATE TRIGGER vendor_rate_cards_vendor_type_check
      BEFORE INSERT OR UPDATE OF vendor_id ON vendor_rate_cards
      FOR EACH ROW EXECUTE FUNCTION enforce_freelancer_vendor_rate_card();
  END IF;
END $$;
