-- Migration for Payroll / Compensation v1

CREATE TABLE IF NOT EXISTS employee_compensation_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    employment_type TEXT NOT NULL CHECK (employment_type IN ('salaried','stipend','salaried_plus_variable')),
    base_amount NUMERIC,
    payment_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (payment_cycle IN ('monthly')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compensation_components (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    component_type TEXT NOT NULL CHECK (component_type IN ('earning','deduction')),
    is_variable BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed default components
INSERT INTO compensation_components (name, component_type, is_variable) VALUES
    ('Salary', 'earning', false),
    ('Incentive', 'earning', true),
    ('Extra Shoot Pay', 'earning', true),
    ('Stipend', 'earning', false),
    ('Advance Deduction', 'deduction', false)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS employee_compensation_entries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    component_id INTEGER NOT NULL REFERENCES compensation_components(id) ON DELETE RESTRICT,
    amount NUMERIC NOT NULL,
    month DATE NOT NULL,
    lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS comp_entries_user_month_idx ON employee_compensation_entries(user_id, month);

CREATE TABLE IF NOT EXISTS employee_payouts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month DATE NOT NULL,
    total_payable NUMERIC NOT NULL DEFAULT 0,
    total_paid NUMERIC NOT NULL DEFAULT 0,
    payout_date DATE,
    finance_transaction_id INTEGER REFERENCES finance_transactions(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, month)
);
