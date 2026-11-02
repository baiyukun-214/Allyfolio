#!/bin/bash
# Failure drill: forged Paddle webhook + egress outage. Prod DB is only read (node:sqlite readOnly inside the app container).
set -u
T0=$(date +%s); ts() { echo "[$(date -u +%H:%M:%S) +$(( $(date +%s) - T0 ))s] $*"; }
cd /srv/allyfolio-mono/app
APPC=$(docker compose ps -q app)
bcount() { docker exec -i $APPC node --no-warnings --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync('/data/allyfolio.db',{readOnly:true}); console.log(d.prepare('select count(*) n from billing_events').get().n)" 2>&1; }
scan() { curl -sS -m 90 -o /tmp/scan.json -w '%{http_code} %{time_total}s' -H 'content-type: application/json' -d "{\"url\":\"$1\",\"rescan\":true}" https://app.allyfolio.com/api/scan; echo " body=$(head -c 300 /tmp/scan.json | sed 's/"issues":\[.*\]/"issues":[...]/')"; }
ts "== forged webhook =="
B=$(bcount); ts "billing_events before: $B"
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ts "POST forged: $(curl -sS -m 20 -o /tmp/wh.json -w '%{http_code} %{time_total}s' -X POST https://app.allyfolio.com/api/billing/webhook -H 'content-type: application/json' -H "Paddle-Signature: ts=$(date +%s);h1=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" -d '{"event_id":"evt_drill_forged","event_type":"subscription.activated","occurred_at":"2026-11-02T00:00:00Z","data":{"id":"sub_drill","custom_data":{"teamId":"1"}}}') body=$(head -c 200 /tmp/wh.json)"
ts "POST no signature: $(curl -sS -m 20 -o /tmp/wh2.json -w '%{http_code}' -X POST https://app.allyfolio.com/api/billing/webhook -H 'content-type: application/json' -d '{}') body=$(head -c 200 /tmp/wh2.json)"
sleep 1
A=$(bcount); ts "billing_events after: $A (delta $((A-B)))"
ts "app log lines since $SINCE:"; docker compose logs --since "$SINCE" app 2>&1 | grep -i 'webhook' | sed 's/"reqId":"[^"]*",//' | cut -c1-400
ts "== egress outage =="
ts "baseline scan: $(scan https://example.com)"
ts "egress stop"; S0=$(date +%s); docker compose stop -t 5 egress 2>&1 | tail -1
ts "egress status: $(docker compose ps -a egress --format '{{.Status}}')"
ts "scan with egress down: $(scan https://example.org)"
ts "egress start"; docker compose start egress 2>&1 | tail -1; S1=$(date +%s)
ts "egress downtime: $((S1-S0))s"
for i in $(seq 1 30); do docker compose ps egress --format '{{.Status}}' | grep -q healthy && break; sleep 1; done
ts "egress status: $(docker compose ps egress --format '{{.Status}}')"
ts "scan after restore: $(scan https://example.com)"
ts "app health: $(curl -sS -m 10 https://app.allyfolio.com/api/health)"
ts "app log (free scan failed) since $SINCE:"; docker compose logs --since "$SINCE" app 2>&1 | grep -i 'free scan failed\|"statusCode":5' | cut -c1-400
