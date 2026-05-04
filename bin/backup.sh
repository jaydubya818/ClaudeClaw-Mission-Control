#!/usr/bin/env bash
# C2 — SQLite backup with WAL-aware .backup command + retention.
# Runs nightly via com.claudeclaw.backup.plist.
#
# Usage: backup.sh [SOURCE_DB] [BACKUP_DIR]
# Defaults: $REPO/store/claudeclaw.db → ~/Library/Application Support/ClaudeClaw/backups/

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DB="${1:-$REPO/store/claudeclaw.db}"
BACKUP_DIR="${2:-$HOME/Library/Application Support/ClaudeClaw/backups}"
KEEP_DAILY=14
KEEP_WEEKLY=8

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

if [ ! -f "$SRC_DB" ]; then
  echo "[backup] source db missing: $SRC_DB" >&2
  exit 1
fi

DATE=$(date +%Y%m%d-%H%M%S)
DAILY="$BACKUP_DIR/daily/claudeclaw-$DATE.db"

# WAL-safe backup (sqlite3 .backup handles concurrent writes).
sqlite3 "$SRC_DB" ".backup '$DAILY'"
echo "[backup] daily: $DAILY ($(du -h "$DAILY" | cut -f1))"

# Promote to weekly on Sundays.
if [ "$(date +%u)" = "7" ]; then
  WEEKLY="$BACKUP_DIR/weekly/claudeclaw-$DATE.db"
  cp "$DAILY" "$WEEKLY"
  echo "[backup] weekly: $WEEKLY"
fi

# Prune. Keep N newest in each tier.
prune_tier() {
  local dir="$1"
  local keep="$2"
  if [ -d "$dir" ]; then
    cd "$dir"
    ls -1t claudeclaw-*.db 2>/dev/null | tail -n +$((keep + 1)) | while read -r f; do
      rm -f "$f"
      echo "[backup] pruned: $dir/$f"
    done
  fi
}
prune_tier "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune_tier "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"

# Optional: upload to remote (e.g., B2, S3) if env set.
if [ -n "${DAILY_BACKUP_BUCKET:-}" ] && command -v rclone >/dev/null 2>&1; then
  rclone copy "$DAILY" "$DAILY_BACKUP_BUCKET" --quiet || echo "[backup] remote upload failed (non-fatal)"
fi

echo "[backup] done · $(date)"
