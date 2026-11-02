# Allyfolio ops runbook

Server: `root@2.31.66.186`, repo `/srv/allyfolio-mono`, compose project in `/srv/allyfolio-mono/app`
(services `app`, `egress`, `caddy`, `backup`). Prod DB: volume `app_appdata` → `/data/allyfolio.db` inside `app`.
**Never write to the prod DB.** Read it only via `node:sqlite` with `{ readOnly: true }` inside the app container.

Scripts used below live in `app/deploy/drills/` (copy them to `/root/` on the server before running).

## 1. Deploy

```sh
cd /srv/allyfolio-mono && git pull --ff-only
cd app && docker compose up -d --build app egress   # ~20 s with warm cache; app is healthy within ~20 s
curl -s https://app.allyfolio.com/api/health      # {"ok":true}
```

Run it detached on the server (`setsid nohup sh -c "..." > /root/deploy.log 2>&1 < /dev/null &`), because SSH
connections to this host take 25–50 s to open and sometimes drop.

## 2. Backups

- `backup` service (alpine) runs `deploy/backup.sh` daily at `BACKUP_TIME` (03:15 UTC by default). It uses an online
  `sqlite3 .backup`, which is WAL-safe. Output: `app/backups/allyfolio-<UTCSTAMP>.db.gz`. It keeps the 14 newest.
- Offsite copy: only if `BACKUP_RCLONE_REMOTE` is set in `app/.env` (see `deploy/rclone`). **As of 2026-11-02 it is NOT set,
  so all backups sit on the same disk as prod.** Losing the host means losing the backups too. Configure an offsite remote.
- Disk on 2026-11-02: 15 G used of 75 G (21%).
- Size on 2026-11-02: about 6.6 KB gzipped, 155 KB raw.

## 3. Backup-restore drill (`restore-drill.sh` + `drill-check.mjs`)

What it does:
1. Picks the newest `backups/allyfolio-*.db.gz` and gunzips it into `/root/restore-drill-<ts>/allyfolio.db`.
2. Starts an isolated copy of the current app image. Nothing is shared with prod:
   - network `restore-drill-net`, with its own egress container `restore-drill-egress`
   - app `restore-drill-app`, published on **127.0.0.1:18787 only**
   - the restored dir is bind-mounted; no prod volume and no `.env` (`ENV_FILE=/nonexistent`)
   - `MAILER=console`, empty `RESEND_API_KEY` / all Paddle keys, `BILLING_PROVIDER=none`, `WORKER=0`, random
     `SESSION_SECRET`
3. Inside the drill container (`drill-check.mjs`, phases):
   - `counts`: integrity check and row counts (read-only)
   - `link` + `callback`: magic-link login as the oldest existing user. The token is taken from the console-mailer log
     and never printed.
   - `signup`: temp user `restore-drill-<ts>@example.invalid`, logout, password login, `/app`
   - `scan`: `POST /api/scan` of https://example.com
4. A `trap` tears everything down (containers, network, restored dir) and checks that it's gone.

```sh
setsid nohup sh -c "/root/restore-drill.sh; echo DRILL_EXIT \$?" > /root/restore-drill.log 2>&1 < /dev/null &
cat /root/restore-drill.log
```

### Result: 2026-11-02 02:46:22–02:46:29 UTC (10:46 UTC+8). Total 7 s, exit 0

| Step | Time | Result |
|---|---|---|
| Latest backup | +0 s | `allyfolio-20261101T031500Z.db.gz` (6639 B, 2026-11-01 03:15 UTC); 14-day rotation working (Oct 28 … Nov 1 present) |
| Restore | +0 s | 155,648 B, `PRAGMA integrity_check` = ok |
| Drill app healthy | +2 s | `{"ok":true}` on 127.0.0.1:18787; prod containers still Up/healthy |
| Row counts | +3 s | users 2, teams 2, memberships 2, scans 7, sessions 3, billing_events 8, waitlist 1 |
| Existing-user login (magic link via console mailer) | +4 s | `/login/link` 200, callback 303 → `/app`, session set, `/app` 200 |
| Temp-user signup / logout / password login | +4 s | 303 → `/app`, 303, 303 → `/app`, `/app` 200 |
| Scan https://example.com | +4 s → +7 s | 200 in 2.3 s |
| Outbound mail | – | 0 Resend calls (console mailer) |
| Errors in drill log | – | 0 |
| Teardown | +7 s | containers=0, restored dir removed |

RTO estimate for a real restore: well under 5 minutes (gunzip + copy into the volume + restart). The data loss window is
up to 24 h (daily backup).

**Real restore (not drilled; prod writes):** `docker compose stop app`, then copy the gunzipped file into the volume
(e.g. `docker run --rm -v app_appdata:/data -v $PWD/backups:/b alpine sh -c 'gunzip -c /b/<file> > /data/allyfolio.db && rm -f /data/allyfolio.db-wal /data/allyfolio.db-shm'`),
then `docker compose start app` and check health. Keep a copy of the broken DB first.

## 4. Failure drill (`failure-drill.sh`)

### 4a. Forged Paddle webhook
`POST https://app.allyfolio.com/api/billing/webhook` with a random `Paddle-Signature: ts=…;h1=<random>`, then again
with no signature. `billing_events` is counted read-only before and after.

Result, 2026-11-02 02:51:46 UTC:
- forged signature → **400** `{"error":"invalid signature"}` in 64 ms
- missing signature → **400** `{"error":"invalid signature"}`
- `billing_events`: 8 → 8 (**no row added**)
- logged at warn (added in 8ce49b7): `{"level":40,"ip":"2.31.66.186","hasSignature":true,"bytes":161,"msg":"billing webhook rejected: invalid signature"}`.
  The payload and signature are not logged.

### 4b. Egress proxy outage
Baseline scan, then `docker compose stop -t 5 egress`, then a free scan (`rescan:true`), then
`docker compose start egress`, wait for healthy, then scan again.

Result, 2026-11-02 02:51:49–02:51:58 UTC:
| Step | Result |
|---|---|
| Baseline scan example.com | 200 in 1.73 s |
| Egress stopped | 02:51:49 |
| Free scan, egress down | **422 `load_failed` in 0.13 s**, friendly text: "We could not load that page this time…". No hang, no 500 |
| Egress started | 02:51:51. **Downtime 2 s** |
| Egress healthy | +5 s |
| Scan after restore | 200 in 1.23 s |
| App health | `{"ok":true}` |

Note: the egress container exits with code 1 on SIGTERM instead of 0. That's harmless because `restart: unless-stopped`
and `start` bring it back, but it's cosmetic noise in `docker compose ps -a`.

## 5. Quick checks
- Health: `curl -s https://app.allyfolio.com/api/health`
- Rejected webhooks: `docker compose logs app | grep 'billing webhook rejected'`
- Failed free scans: `docker compose logs app | grep 'free scan failed'`
