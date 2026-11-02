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
- Offsite copy: **enabled since 2026-11-02** to Cloudflare R2. See "Offsite backups (Cloudflare R2)" below.
- Disk on 2026-11-02: 15 G used of 75 G (21%).
- Size on 2026-11-02: about 6.6 KB gzipped, 155 KB raw.

### Offsite backups (Cloudflare R2)

- **Where:** Cloudflare R2 bucket `allyfolio-backups`, via the rclone remote `r2` (S3 provider `Cloudflare`, EU
  jurisdiction endpoint, `no_check_bucket = true` because the token is scoped to the bucket and can't create buckets).
- **Schedule:** the same daily run as the local backup (`BACKUP_TIME`, 03:15 UTC = 11:15 UTC+8). Once the local file is
  written and rotated, `backup.sh` runs `rclone copy <file> r2:allyfolio-backups`. The log line is
  `[backup] copied offsite to r2:allyfolio-backups` (`docker compose logs backup`).
- **Retention:** locally the 14 newest files (`BACKUP_KEEP_DAILY`). On R2, objects older than `BACKUP_REMOTE_KEEP_DAYS`
  (30) days are deleted by `rclone delete --min-age 30d` after each copy. That step is `|| true`, so if the R2 token
  has no delete permission the old objects just accumulate silently. Check the bucket now and then, or add an R2 lifecycle
  rule as a backstop.
- **Configuration (no secrets in git):**
  - `app/.env` holds `BACKUP_RCLONE_REMOTE=r2:allyfolio-backups` and `BACKUP_REMOTE_KEEP_DAYS=30`.
  - `app/deploy/rclone/rclone.conf` (server only, `chmod 600`, git-ignored via `app/.gitignore`) holds the `r2` remote
    with the R2 access key ID and secret.
  - `docker-compose.yml` mounts `./deploy/rclone` read-only at `/root/.config/rclone` in the `backup` container.
  - `.env` is only read when the container is created. After you change it, run `docker compose up -d backup`
    (a plain `restart` is not enough).
- **Check it:**
  ```sh
  cd /srv/allyfolio-mono/app
  docker compose exec -T backup sh -c 'env | grep ^BACKUP_; cat /etc/crontabs/root; rclone ls r2:allyfolio-backups'
  ```
  Never `cat` rclone.conf or print the whole container env.

- **Verified 2026-11-02 03:14–03:15 UTC (11:14–11:15 UTC+8), read-only:** the container env has
  `BACKUP_RCLONE_REMOTE=r2:allyfolio-backups` and `BACKUP_REMOTE_KEEP_DAYS=30`. The crontab is
  `15 03 * * * /deploy/backup.sh`, crond is PID 1, and `rclone listremotes` shows `r2:`. The **scheduled** 03:15 UTC run
  wrote `allyfolio-20261102T031500Z.db.gz` (6928 B) and logged `copied offsite to r2:allyfolio-backups`.
  `rclone ls` shows it next to the manual `allyfolio-20261102T031316Z.db.gz`. The R2 delete path (30-day pruning) has
  not been exercised yet; nothing is older than 30 days.

#### Restore from R2 (host still alive)

```sh
cd /srv/allyfolio-mono/app
docker compose exec -T backup rclone ls r2:allyfolio-backups                         # pick a file
docker compose exec -T backup rclone copy r2:allyfolio-backups/<file> /backups/      # lands in app/backups/
```

Then follow **Real restore** at the end of section 3, using that file.

#### Restore onto a fresh host (old host and its disk are gone)

1. Provision the host, clone the repo to `/srv/allyfolio-mono`, and recreate `app/.env` from the password manager.
   Make sure the `BACKUP_*` lines are set as above.
2. In the Cloudflare dashboard → R2 → *Manage API tokens*, create a new token with **Object Read & Write** on the
   `allyfolio-backups` bucket only, then revoke the old token. Note the Access Key ID, Secret Access Key and the
   **EU** S3 endpoint (`https://<account-id>.eu.r2.cloudflarestorage.com`).
3. Recreate the rclone config without echoing the keys into shell history (e.g. run `rclone config` interactively:
   type `s3`, provider `Cloudflare`, paste the keys, then the endpoint), or write the file with an editor:
   ```ini
   [r2]
   type = s3
   provider = Cloudflare
   access_key_id = <new key id>
   secret_access_key = <new secret>
   endpoint = https://<account-id>.eu.r2.cloudflarestorage.com
   acl = private
   no_check_bucket = true
   ```
   Save it as `app/deploy/rclone/rclone.conf` and run `chmod 600` on it.
4. `cd app && mkdir -p backups && docker compose up -d backup`, then
   `docker compose exec -T backup rclone ls r2:allyfolio-backups` and copy the newest file into `/backups/` as above.
5. Bring up the stack once so the `app_appdata` volume exists (`docker compose up -d`), then do the **Real restore**
   steps (stop app → gunzip into the volume → remove `-wal`/`-shm` → start app). Check `/api/health` and log in.
6. Point DNS for `app.allyfolio.com` at the new host. Caddy then issues fresh certificates.

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
