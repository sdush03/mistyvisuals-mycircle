ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_status_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_status_check CHECK (
    status = ANY (
      ARRAY[
        'New',
        'Contacted',
        'Quoted',
        'Follow Up',
        'Negotiation',
        'Converted',
        'Lost',
        'Rejected'
      ]
    )
  );
