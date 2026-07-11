-- Add fields to finance_transactions for soft deletes and edit tracking
ALTER TABLE finance_transactions
ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Create audit log table for edits
CREATE TABLE finance_transaction_audits (
  id SERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES finance_transactions(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  edited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fta_tx_idx ON finance_transaction_audits(transaction_id);
