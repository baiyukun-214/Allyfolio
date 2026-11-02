#!/bin/sh
# Daily SQLite backup. Uses sqlite3 ".backup" (online, consistent with WAL), checks integrity, gzips,
# keeps BACKUP_KEEP_DAILY daily copies and optionally copies offsite with rclone (BACKUP_RCLONE_REMOTE).
set -eu
DB="${DATABASE_PATH:-/data/allyfolio.db}"
DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP_DAILY:-14}"
REMOTE="${BACKUP_RCLONE_REMOTE:-}"        # e.g. r2:allyfolio-backups (configure rclone.conf); empty = local only
mkdir -p "$DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$DIR/.allyfolio-$STAMP.db"
OUT="$DIR/allyfolio-$STAMP.db.gz"
sqlite3 "$DB" ".timeout 10000" ".backup '$TMP'"
[ "$(sqlite3 "$TMP" 'PRAGMA integrity_check;')" = "ok" ] || { echo "[backup] integrity check FAILED" >&2; rm -f "$TMP"; exit 1; }
gzip -9 -c "$TMP" > "$OUT.part" && mv "$OUT.part" "$OUT" && rm -f "$TMP"
chmod 600 "$OUT"
echo "[backup] wrote $OUT ($(wc -c < "$OUT") bytes)"
# Rotation: keep the newest $KEEP files.
ls -1t "$DIR"/allyfolio-*.db.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r f; do rm -f "$f"; echo "[backup] rotated out $f"; done
if [ -n "$REMOTE" ]; then
  rclone copy "$OUT" "$REMOTE" && echo "[backup] copied offsite to $REMOTE"
  # Retention touches only top-level backup files, never the anchors/ prefix.
  [ -n "${BACKUP_REMOTE_KEEP_DAYS:-}" ] && rclone delete --min-age "${BACKUP_REMOTE_KEEP_DAYS}d" --include "/allyfolio-*.db.gz" "$REMOTE" || true
fi
# Daily off-site anchor of the evidence chain heads (see anchor.sh). A failed anchor does not fail the backup.
[ "${ANCHOR_DISABLED:-0}" = "1" ] || /deploy/anchor.sh || echo "[anchor] FAILED" >&2
