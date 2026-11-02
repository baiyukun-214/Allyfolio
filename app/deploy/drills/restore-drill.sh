#!/bin/bash
# Backup-restore drill: restores the newest backup into /root/restore-drill-<ts>, runs an isolated app (own network,
# own egress, localhost-only port 18787, MAILER=console, no Paddle/Resend keys, WORKER=0), verifies, then tears down.
set -u
T0=$(date +%s); ts() { echo "[$(date -u +%H:%M:%S) +$(( $(date +%s) - T0 ))s] $*"; }
TS=$(date -u +%Y%m%dT%H%M%SZ); D=/root/restore-drill-$TS; NET=restore-drill-net; APP=restore-drill-app; EGR=restore-drill-egress; PORT=18787
cleanup() { ts "teardown"; docker rm -f $APP $EGR >/dev/null 2>&1; docker network rm $NET >/dev/null 2>&1; rm -rf "$D"; ts "teardown done: containers=$(docker ps -a --filter name=restore-drill -q | wc -l) dir_exists=$([ -e "$D" ] && echo yes || echo no)"; }
trap cleanup EXIT
cd /srv/allyfolio-mono/app
ts "backup service: $(docker compose ps backup --format '{{.Status}}')"
ts "backup dir listing (newest 5):"; ls -lt backups/ | head -6
LATEST=$(ls -1t backups/allyfolio-*.db.gz 2>/dev/null | head -1)
[ -n "$LATEST" ] || { ts "NO BACKUP FOUND"; exit 1; }
ts "latest backup: $LATEST ($(stat -c %s "$LATEST") bytes, mtime $(date -u -r "$LATEST" +%FT%TZ))"
mkdir -p "$D" && gunzip -c "$LATEST" > "$D/allyfolio.db" && chmod 777 "$D" && chmod 666 "$D/allyfolio.db"
ts "restored to $D/allyfolio.db ($(stat -c %s "$D/allyfolio.db") bytes), sha256 $(sha256sum "$D/allyfolio.db" | cut -c1-16)"
IMG=$(docker inspect --format '{{.Image}}' "$(docker compose ps -q app)")
ts "image: ${IMG:7:12}"
docker network create --internal=false $NET >/dev/null
docker run -d --name $EGR --network $NET --network-alias drill-egress -e EGRESS_PORT=3128 --memory 256m "$IMG" npx tsx src/egress/main.ts >/dev/null
docker run -d --name $APP --network $NET -p 127.0.0.1:$PORT:8787 --shm-size 1g --memory 3g -v "$D":/data \
  -e ENV_FILE=/nonexistent -e DATABASE_PATH=/data/allyfolio.db -e MAILER=console -e RESEND_API_KEY= -e BILLING_PROVIDER=none \
  -e PADDLE_ENV=sandbox -e PADDLE_API_KEY= -e PADDLE_WEBHOOK_SECRET= -e PADDLE_LIVE_API_KEY= -e PADDLE_LIVE_WEBHOOK_SECRET= -e SENTRY_DSN= \
  -e WORKER=0 -e SESSION_SECRET="drill-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')" -e PUBLIC_APP_URL=http://127.0.0.1:$PORT \
  -e ALLOW_PRIVATE_TARGETS=0 -e SCAN_PROXY=http://drill-egress:3128 "$IMG" >/dev/null
ts "drill containers started; waiting for health"
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:$PORT/api/health >/dev/null 2>&1 && break; sleep 1; done
ts "health: $(curl -sS http://127.0.0.1:$PORT/api/health)"
ts "prod containers untouched: $(docker compose ps --format '{{.Service}}={{.Status}}' | tr '\n' ' ')"
run() { docker exec -i -e PHASE=$1 "${@:2}" $APP node --input-type=module - < /root/drill-check.mjs; }
OUT=$(run counts); echo "$OUT" | grep -v DRILL_EMAIL; EMAIL=$(echo "$OUT" | sed -n 's/^DRILL_EMAIL=//p')
if [ -n "$EMAIL" ]; then
  run link -e DRILL_EMAIL="$EMAIL"; sleep 1
  TOKEN=$(docker logs $APP 2>&1 | grep -o 'login/callback?token=[A-Za-z0-9_-]*' | tail -1 | cut -d= -f2)
  ts "magic link captured from console mailer: $([ -n "$TOKEN" ] && echo yes || echo no) (token not printed)"
  run callback -e DRILL_TOKEN="$TOKEN"
fi
run signup
ts "scan start"; run scan -e SCAN_URL=https://example.com; ts "scan done"
ts "outbound mail check: drill app has MAILER=console; resend calls in log: $(docker logs $APP 2>&1 | grep -ci 'resend' || true)"
ts "drill app errors in log: $(docker logs $APP 2>&1 | grep -c '"level":50' || true)"
