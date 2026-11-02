#!/bin/sh
# Daily off-site anchor of the evidence chain heads (runs from backup.sh, inside the `backup` container).
# Writes the current head of every site's scan chain (latest finished scan's evidence_hash) and manual-check chain,
# plus a UTC timestamp, to a JSON file and copies it to ANCHOR_RCLONE_REMOTE (default: <BACKUP_RCLONE_REMOTE>/anchors).
# Anchors are never rotated or deleted by Allyfolio: an anchored head that later disappears from, or no longer
# verifies in, the database shows that the history was rewritten after that day. Check with:
#   npm run verify-chain -- --anchor <anchor file>        (app container, read-only)
set -eu
DB="${DATABASE_PATH:-/data/allyfolio.db}"
DIR="${BACKUP_DIR:-/backups}/anchors"
REMOTE="${ANCHOR_RCLONE_REMOTE:-${BACKUP_RCLONE_REMOTE:+$BACKUP_RCLONE_REMOTE/anchors}}"
mkdir -p "$DIR"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
q() { sqlite3 -readonly -json "$DB" ".timeout 10000" "$1"; }
SCANS="$(q "SELECT s.site_id, s.id AS scan_id, s.finished_at, COALESCE(s.hash_version, 1) AS hash_version, s.evidence_hash FROM scans s
  WHERE s.status = 'done' AND s.evidence_hash IS NOT NULL AND s.id = (SELECT id FROM scans WHERE site_id = s.site_id AND status = 'done' ORDER BY finished_at DESC, id DESC LIMIT 1)
  ORDER BY s.site_id")"
MANUAL="$(q "SELECT m.site_id, m.seq, m.hash FROM manual_evidence m WHERE m.seq = (SELECT MAX(seq) FROM manual_evidence WHERE site_id = m.site_id) ORDER BY m.site_id")"
[ -n "$SCANS" ] || SCANS='[]'; [ -n "$MANUAL" ] || MANUAL='[]'
SCANS="$(printf '%s' "$SCANS" | tr -d '\n')"; MANUAL="$(printf '%s' "$MANUAL" | tr -d '\n')"
DIGEST="$(printf '%s\n%s' "$SCANS" "$MANUAL" | sha256sum | cut -d' ' -f1)"
OUT="$DIR/anchor-$STAMP.json"
printf '{"scheme":"allyfolio-anchor-v1","anchored_at":"%s","scan_heads":%s,"manual_heads":%s,"digest":"%s"}\n' "$NOW" "$SCANS" "$MANUAL" "$DIGEST" > "$OUT.part"
mv "$OUT.part" "$OUT"
echo "[anchor] wrote $OUT (digest $DIGEST)"
if [ -n "$REMOTE" ]; then
  rclone copyto "$OUT" "$REMOTE/$(basename "$OUT")" && echo "[anchor] copied offsite to $REMOTE/$(basename "$OUT")"
fi
