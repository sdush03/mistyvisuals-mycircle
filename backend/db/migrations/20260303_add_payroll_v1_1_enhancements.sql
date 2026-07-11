-- Add rule_type and calculation_note to compensation_components
ALTER TABLE compensation_components ADD COLUMN IF NOT EXISTS rule_type TEXT DEFAULT 'manual';
ALTER TABLE compensation_components ADD COLUMN IF NOT EXISTS calculation_note TEXT;

ALTER TABLE compensation_components DROP CONSTRAINT IF EXISTS compensation_components_rule_type_check;
ALTER TABLE compensation_components ADD CONSTRAINT compensation_components_rule_type_check CHECK (rule_type IN ('manual', 'percentage', 'flat'));

-- Seed Advance components
INSERT INTO compensation_components (name, component_type, is_variable, rule_type, calculation_note)
VALUES
    ('Advance', 'earning', true, 'manual', 'Money paid before payroll to be recovered via future deductions.'),
    ('Advance Deduction', 'deduction', true, 'manual', 'Recovery of previously paid Advance.')
ON CONFLICT DO NOTHING;
