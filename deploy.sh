#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/var/www/mistyvisuals-mycircle"
LOG_DIR="${HOME}/deploy-logs/mistyvisuals-mycircle"
TS="$(date +%Y%m%d_%H%M%S)"
LOG_FILE="$LOG_DIR/deploy_$TS.log"

# Optional notifications (set one of these in the server environment)
# SLACK_WEBHOOK_URL="https://hooks.slack.com/services/XXX/YYY/ZZZ"
# NOTIFY_WEBHOOK_URL="https://your-webhook-endpoint"

mkdir -p "$LOG_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1

# ── Deploy lock: prevent overlapping deploys ──
LOCKFILE="/tmp/mycircle-deploy.lock"
rm -f "$LOCKFILE"
echo $$ > "$LOCKFILE"
# Clean up lock on exit (normal, error, or signal)
cleanup_lock() {
  echo "[deploy] Uploading logs..."
  if [[ -f "${LOG_FILE:-}" ]]; then
    UPLOAD_RES=$(curl -s -F "file=@$LOG_FILE" https://file.io || true)
    LOG_URL=$(echo "$UPLOAD_RES" | grep -oE 'https://file.io/[a-zA-Z0-9]+' || true)
    if [[ -n "$LOG_URL" ]]; then
      curl -s -d "Deploy log (MyCircle): $LOG_URL" https://ntfy.sh/mistyvisuals-deploy-debug || true
    else
      TAIL_LOG=$(tail -n 30 "$LOG_FILE" || true)
      curl -s -d "Deploy failed (MyCircle) - last lines:
$TAIL_LOG" https://ntfy.sh/mistyvisuals-deploy-debug || true
    fi
  fi
  rm -f "$LOCKFILE"
}
trap cleanup_lock EXIT

cd "$REPO_ROOT"

# Load environment variables (needed for non-interactive SSH sessions like GitHub Actions)
if [[ -f "$REPO_ROOT/backend/.env" ]]; then
  set -a
  source "$REPO_ROOT/backend/.env"
  set +a
fi

# Ensure production build/runtime for frontend
export NODE_ENV=production

# One-time cleanup: move any legacy repo-local deploy logs out of the repo
LEGACY_LOG_DIR="$REPO_ROOT/deploy-logs"
if [[ -d "$LEGACY_LOG_DIR" ]]; then
  echo "[deploy] Moving legacy deploy logs out of repo..."
  mkdir -p "$LOG_DIR/legacy"
  mv "$LEGACY_LOG_DIR" "$LOG_DIR/legacy/$TS" || rm -rf "$LEGACY_LOG_DIR"
fi

PREV_HASH="$(git rev-parse HEAD)"
STASH_CREATED=""

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[deploy] Uncommitted changes detected. Stashing..."
  STASH_CREATED="1"
  git stash push -u -m "deploy-autostash-$TS"
fi

notify() {
  local message="$1"
  local payload
  payload=$(printf '{"text":"%s"}' "$(echo "$message" | sed 's/"/\\"/g')")
  if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
    curl -s -X POST -H 'Content-Type: application/json' -d "$payload" "$SLACK_WEBHOOK_URL" >/dev/null || true
  elif [[ -n "${NOTIFY_WEBHOOK_URL:-}" ]]; then
    curl -s -X POST -H 'Content-Type: application/json' -d "$payload" "$NOTIFY_WEBHOOK_URL" >/dev/null || true
  fi
}

rollback() {
  echo "[deploy] ERROR detected. Rolling back to $PREV_HASH..."
  mkdir -p "$REPO_ROOT/frontend/public" || true
  cp "$LOG_FILE" "$REPO_ROOT/frontend/public/deploy-log.txt" || true
  chmod 644 "$REPO_ROOT/frontend/public/deploy-log.txt" || true
  notify "❌ Deploy failed on $(hostname). Rolling back to $PREV_HASH."
  git checkout main 2>/dev/null || true
  git reset --hard "$PREV_HASH"

  echo "[deploy] Installing backend deps (rollback)..."
  cd "$REPO_ROOT/backend"
  npm install
  npx prisma generate
  bash "$REPO_ROOT/backend/migrate.sh"
  pm2 restart mycircle-backend --update-env

  echo "[deploy] Installing frontend deps (rollback)..."
  cd "$REPO_ROOT/frontend"
  npm install
  rm -f .next/lock
  echo "[deploy] Memory status before rollback build:"
  free -h || true
  NODE_OPTIONS="--max-old-space-size=512" npm run build
  pm2 restart mycircle-frontend --update-env

  echo "[deploy] Rollback complete."
}

trap 'cleanup_lock' ERR

echo "[deploy] Memory status before pull:"
free -h || true
echo "[deploy] Pulling latest code..."
git checkout main 2>/dev/null || true
git pull origin main

NEW_HASH="$(git rev-parse HEAD)"
CHANGED_FILES="$(git diff --name-only "$PREV_HASH" "$NEW_HASH")"
BACKEND_CHANGED="$(echo "$CHANGED_FILES" | grep -E '^backend/' || true)"
MIGRATIONS_CHANGED="$(git diff --name-only "$PREV_HASH" "$NEW_HASH" -- backend/migrations || true)"
PRISMA_CHANGED="$(git diff --name-only "$PREV_HASH" "$NEW_HASH" -- backend/prisma || true)"
BACKEND_DEPS_CHANGED="$(echo "$CHANGED_FILES" | grep -E '^backend/package(-lock)?\.json$' || true)"
FRONTEND_DEPS_CHANGED="$(echo "$CHANGED_FILES" | grep -E '^frontend/package(-lock)?\.json$' || true)"
FRONTEND_CHANGED="$(echo "$CHANGED_FILES" | grep -E '^frontend/' || true)"

if [[ -n "$BACKEND_CHANGED" ]]; then
  echo "[deploy] Backend changes detected. Installing deps if needed..."
  cd "$REPO_ROOT/backend"
  if [[ -n "$BACKEND_DEPS_CHANGED" ]]; then
    echo "[deploy] backend package.json changed → npm install"
    npm install
  else
    echo "[deploy] backend package.json unchanged → skipping npm install"
  fi

  echo "[deploy] Running migrations..."
  bash "$REPO_ROOT/backend/migrate.sh"

  if [[ -n "$PRISMA_CHANGED" || -n "$BACKEND_DEPS_CHANGED" ]]; then
    echo "[deploy] Prisma schema or deps changed → running prisma generate..."
    npx prisma generate
  fi

  echo "[deploy] Running backfill for gallery codes..."
  node "$REPO_ROOT/backend/scripts/backfill_gallery_codes.js"

  echo "[deploy] Restarting backend..."
  pm2 restart mycircle-backend --update-env
else
  echo "[deploy] No backend changes → skipping backend steps"
fi

if [[ -n "$FRONTEND_CHANGED" ]]; then
  echo "[deploy] Frontend changes detected. Installing deps if needed..."
  cd "$REPO_ROOT/frontend"
  if [[ -n "$FRONTEND_DEPS_CHANGED" ]]; then
    echo "[deploy] frontend package.json changed → npm install"
    npm install --include=dev
  else
    echo "[deploy] frontend package.json unchanged → installing dev deps anyway for build"
    npm install --include=dev
  fi

  echo "[deploy] Cleaning up any orphaned build workers..."
  pkill -f "jest-worker/processChild.js" || true

  echo "[deploy] Building frontend..."
  rm -f .next/lock
  echo "[deploy] Memory status before main build:"
  free -h || true
  NODE_OPTIONS="--max-old-space-size=512" npm run build

  echo "[deploy] Restarting frontend..."
  pm2 restart mycircle-frontend --update-env
else
  echo "[deploy] No frontend changes → skipping build and restart"
fi

echo "[deploy] Done."
mkdir -p "$REPO_ROOT/frontend/public" || true
cp "$LOG_FILE" "$REPO_ROOT/frontend/public/deploy-log.txt" || true
chmod 644 "$REPO_ROOT/frontend/public/deploy-log.txt" || true
notify "✅ Deploy succeeded on $(hostname)."

if [[ -n "$STASH_CREATED" ]]; then
  echo "[deploy] Restoring stashed changes..."
  git stash pop || echo "[deploy] Stash pop had conflicts; resolve manually."
fi

# Clean up local package-lock changes if they were not part of the pulled diff
if [[ -z "$BACKEND_DEPS_CHANGED" && -f "$REPO_ROOT/backend/package-lock.json" ]]; then
  git restore "$REPO_ROOT/backend/package-lock.json" || true
fi
if [[ -z "$FRONTEND_DEPS_CHANGED" && -f "$REPO_ROOT/frontend/package-lock.json" ]]; then
  git restore "$REPO_ROOT/frontend/package-lock.json" || true
fi
if [[ -z "$(echo "$CHANGED_FILES" | grep -E '^package(-lock)?\\.json$' || true)" && -f "$REPO_ROOT/package-lock.json" ]]; then
  git restore "$REPO_ROOT/package-lock.json" || true
fi
