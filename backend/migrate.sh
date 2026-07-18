#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MIGRATIONS_DIR="$ROOT_DIR/backend/migrations"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Please install PostgreSQL client tools." >&2
  exit 1
fi

# Source .env if DATABASE_URL is not already set
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT_DIR/backend/.env" ]; then
  set -a
  source "$ROOT_DIR/backend/.env"
  set +a
fi

# Auto-construct DATABASE_URL from individual DB params if not set
DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ] && [ -n "${DB_HOST:-}" ] && [ -n "${DB_NAME:-}" ]; then
  DB_URL="postgresql://${DB_USER:-postgres}:${DB_PASSWORD:-}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME}"
fi

if [ -z "$DB_URL" ]; then
  echo "DATABASE_URL is not set and could not be constructed from DB_HOST/DB_NAME. Please export it before running." >&2
  exit 1
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT NOW());"

shopt -s nullglob
for f in "$MIGRATIONS_DIR"/*.sql; do
  fname=$(basename "$f")
  applied=$(psql "$DB_URL" -tAc "SELECT 1 FROM schema_migrations WHERE filename='$fname'")
  if [ "$applied" != "1" ]; then
    allow_drop=0
    if [ "$fname" = "20260216_allow_null_lead_activities_lead_id.sql" ] || \
       [ "$fname" = "20260315_add_crew_management.sql" ] || \
       [ "$fname" = "20260422_create_smart_notification_log.sql" ] || \
       [ "$fname" = "20260501_create_projects.sql" ] || \
       [ "$fname" = "20260719_add_gallery_join_codes.sql" ]; then
      allow_drop=1
    fi
    if grep -Eiv "\\bdrop\\s+(not\\s+null|default)\\b" "$f" | grep -Eiq "\\b(drop|truncate)\\b|\\bdelete\\s+from\\b"; then
      if [ "${ALLOW_DESTRUCTIVE_MIGRATIONS:-}" != "1" ] && [ "$allow_drop" != "1" ]; then
        echo "Skipping $fname (destructive statements detected)."
        echo "Set ALLOW_DESTRUCTIVE_MIGRATIONS=1 to allow."
        continue
      fi
    fi
    echo "Applying $fname"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations (filename) VALUES ('$fname');"
  else
    echo "Skipping $fname (already applied)"
  fi
done

echo "Running Highlights tab check migration..."
export DATABASE_URL="$DB_URL"
node "$ROOT_DIR/backend/scripts/add_highlights_tab.js"

