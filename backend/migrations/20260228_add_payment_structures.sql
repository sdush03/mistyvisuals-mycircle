-- Add payment structures and steps

CREATE TABLE IF NOT EXISTS payment_structures (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Ensure only ONE default structure exists
CREATE UNIQUE INDEX IF NOT EXISTS payment_structures_default_idx 
ON payment_structures (is_default) 
WHERE is_default = true;

CREATE TABLE IF NOT EXISTS payment_structure_steps (
  id SERIAL PRIMARY KEY,
  payment_structure_id INTEGER NOT NULL REFERENCES payment_structures(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  percentage NUMERIC NOT NULL,
  step_order INTEGER NOT NULL
);

-- Insert the default Standard (25-65-10) structure if it doesn't already exist
DO $$
DECLARE
  new_struct_id INTEGER;
  default_exists BOOLEAN;
BEGIN
  -- Check if a default already exists to avoid duplicate seed issues
  SELECT EXISTS(SELECT 1 FROM payment_structures WHERE is_default = true) INTO default_exists;
  
  IF NOT default_exists THEN
    INSERT INTO payment_structures (name, is_default)
    VALUES ('Standard (25-65-10)', true)
    RETURNING id INTO new_struct_id;
    
    INSERT INTO payment_structure_steps (payment_structure_id, label, percentage, step_order)
    VALUES 
      (new_struct_id, 'Advance', 25, 1),
      (new_struct_id, 'At Venue', 65, 2),
      (new_struct_id, 'After Soft Deliverables', 10, 3);
  END IF;
END $$;
