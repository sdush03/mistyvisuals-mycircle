const path = require('path')
const dotenv = require('dotenv')
const { Pool } = require('pg')

dotenv.config({ path: path.join(__dirname, '..', '.env.local') })
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const pool = new Pool({ connectionString })

async function recalculate() {
  await pool.query(
    `
    WITH sums AS (
      SELECT money_source_id,
             SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) as balance
      FROM finance_transactions
      WHERE is_deleted = false
      GROUP BY money_source_id
    ),
    rows AS (
      SELECT ms.id as money_source_id, COALESCE(s.balance, 0) as balance
      FROM money_sources ms
      LEFT JOIN sums s ON s.money_source_id = ms.id
    )
    INSERT INTO finance_account_balances (money_source_id, balance, last_calculated_at)
    SELECT money_source_id, balance, NOW()
    FROM rows
    ON CONFLICT (money_source_id)
    DO UPDATE SET balance = EXCLUDED.balance, last_calculated_at = EXCLUDED.last_calculated_at
    `
  )
}

recalculate()
  .then(() => {
    console.log('Balances recalculated')
  })
  .catch((err) => {
    console.error('Failed to recalculate balances:', err?.message || err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end().catch(() => {})
  })
