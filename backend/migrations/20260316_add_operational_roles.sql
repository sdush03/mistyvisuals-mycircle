-- Operational roles for crew and pricing

CREATE TABLE IF NOT EXISTS operational_roles (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO operational_roles (category, name)
VALUES
  ('Photographer', 'Candid Photographer'),
  ('Photographer', 'Traditional Photographer'),
  ('Videographer', 'Cinematographer'),
  ('Videographer', 'Traditional Videographer'),
  ('Videographer', 'Aerial Videographer'),
  ('Videographer', 'Content Creator')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS operational_role_id INT REFERENCES operational_roles(id);

ALTER TABLE team_role_catalog
  ADD COLUMN IF NOT EXISTS operational_role_id INT REFERENCES operational_roles(id);

-- Backfill users from legacy crew_type
UPDATE users u
SET operational_role_id = o.id
FROM operational_roles o
WHERE u.operational_role_id IS NULL
  AND u.crew_type IS NOT NULL
  AND LOWER(o.name) = LOWER(u.crew_type);

-- Backfill team role catalog mapping by name
UPDATE team_role_catalog tr
SET operational_role_id = o.id
FROM operational_roles o
WHERE tr.operational_role_id IS NULL
  AND LOWER(tr.name) = LOWER(o.name);

-- Ensure each operational role has a team role catalog entry
INSERT INTO team_role_catalog (name, price, unit_type, active, created_at, operational_role_id)
SELECT o.name, 0, 'PER_DAY', o.active, NOW(), o.id
FROM operational_roles o
LEFT JOIN team_role_catalog tr ON tr.operational_role_id = o.id
WHERE tr.id IS NULL;
