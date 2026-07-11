ALTER TABLE leads
ADD COLUMN IF NOT EXISTS lead_number INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS leads_lead_number_key ON leads(lead_number);

DO $$
DECLARE
  r RECORD;
  prefix INT;
  seq INT;
BEGIN
  FOR r IN
    SELECT id, created_at
    FROM leads
    WHERE lead_number IS NULL
    ORDER BY created_at, id
  LOOP
    prefix := EXTRACT(YEAR FROM r.created_at)::int % 100;
    SELECT COALESCE(
      MAX(
        CASE
          WHEN lead_number BETWEEN prefix * 1000 + 1 AND prefix * 1000 + 999
            THEN lead_number - prefix * 1000
          WHEN lead_number BETWEEN prefix * 10000 + 1000 AND prefix * 10000 + 9999
            THEN lead_number - prefix * 10000
          ELSE 0
        END
      ),
      0
    )
    INTO seq
    FROM leads
    WHERE lead_number IS NOT NULL
      AND lead_number BETWEEN prefix * 1000 + 1 AND prefix * 10000 + 9999;

    seq := seq + 1;

    IF seq <= 999 THEN
      UPDATE leads
      SET lead_number = prefix * 1000 + seq
      WHERE id = r.id;
    ELSE
      UPDATE leads
      SET lead_number = prefix * 10000 + seq
      WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
