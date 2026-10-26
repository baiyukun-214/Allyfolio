# Deploying the Allyfolio app (Hetzner CPX31, Ubuntu 24.04)

Result: `https://app.allyfolio.com` (dashboard + API incl. `/api/scan`, `/api/billing/webhook`, `/api/health`)
running in Docker Compose: `app` (Fastify + Playwright worker), `egress` (scanner proxy), `backup`, `caddy` (TLS).
The marketing site stays on Cloudflare; it calls `/api/scan` cross-origin (allowed via `SITE_ORIGINS`).
Keep the site build flag `PUBLIC_APP_LIVE` unset until launch (it is not part of this deployment).

## 1. Server

Hetzner Cloud → CPX31, Ubuntu 24.04, location Falkenstein/Nuremberg/Helsinki, add your SSH key. Note the IPv4.
Optionally also add a Hetzner Cloud Firewall with the same rules as below.

```sh
ssh root@SERVER_IP
apt update && apt -y upgrade
adduser --disabled-password --gecos "" deploy && usermod -aG sudo deploy
rsync -a ~/.ssh /home/deploy/ && chown -R deploy:deploy /home/deploy/.ssh
# firewall: SSH, HTTP (needed for the ACME HTTP challenge), HTTPS
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
apt -y install unattended-upgrades sqlite3 && dpkg-reconfigure -f noninteractive unattended-upgrades
```

Note: Docker-published ports bypass ufw; only Caddy publishes ports (80/443), the app port 8787 is never published.

## 2. Docker

```sh
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt update && apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker deploy
docker run --rm hello-world
```

## 3. Clone

```sh
su - deploy
sudo mkdir -p /srv && sudo chown deploy /srv
git clone git@github.com:<you>/<allyfolio-repo>.git /srv/allyfolio-mono   # needs a deploy key or HTTPS token
cd /srv/allyfolio-mono/app
```

## 4. `.env`

```sh
cp .env.example .env && chmod 600 .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 32)|" .env
nano .env
```

Set at least:

```
PUBLIC_APP_URL=https://app.allyfolio.com
SITE_URL=https://allyfolio.com
SITE_ORIGINS=https://allyfolio.com,https://www.allyfolio.com
COOKIE_DOMAIN=.allyfolio.com
ALLOW_PRIVATE_TARGETS=0
MAILER=resend
RESEND_API_KEY=<from Resend; domain allyfolio.com verified (SPF/DKIM records in Cloudflare)>
MAIL_FROM="Allyfolio <hello@allyfolio.com>"
BILLING_PROVIDER=paddle
PADDLE_ENV=sandbox            # switch to live once the live account is approved
PADDLE_API_KEY=<…>
PADDLE_CLIENT_TOKEN=<…>
PADDLE_WEBHOOK_SECRET=<from the Paddle notification destination>
PADDLE_PRICE_STARTER=<pri_…>  PADDLE_PRICE_BUSINESS=<pri_…>  PADDLE_PRICE_AGENCY=<pri_…>  PADDLE_PRICE_ONEOFF=<pri_…>
```

Without `RESEND_API_KEY` the app logs emails to the container log instead of sending them (`docker compose logs app`).
Never commit `.env`.

## 5. DNS (Cloudflare)

DNS → Add record: **A**, name `app`, IPv4 `SERVER_IP` (and AAAA for IPv6 if wanted).

- **DNS only (grey cloud)** – recommended. Caddy gets Let's Encrypt certificates via the HTTP-01 / TLS-ALPN challenge, which needs ports 80/443 to reach the server directly.
- **Proxied (orange cloud)** – possible, but set SSL/TLS mode to **Full (strict)** and make sure the first certificate was issued (start with DNS only, then switch), and do not enable "Always Use HTTPS" redirects that block `/.well-known/acme-challenge/`. Caddy's HTTP challenge must still reach the server on port 80.

Check: `dig +short app.allyfolio.com` shows the server IP.

## 6. Start

```sh
cd /srv/allyfolio-mono/app
docker compose up -d --build
docker compose ps                         # app should become "healthy"
docker compose logs -f caddy              # certificate obtained
curl -fsS https://app.allyfolio.com/api/health   # {"ok":true}
curl -si -X OPTIONS https://app.allyfolio.com/api/scan -H 'Origin: https://allyfolio.com' -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin
```

## 7. Paddle

Paddle → Developer tools → Notifications → New destination:

- URL: `https://app.allyfolio.com/api/billing/webhook`
- Events: `subscription.*`, `transaction.completed` (or all)
- Copy the secret key into `PADDLE_WEBHOOK_SECRET`, then `docker compose up -d app`.

Prices/products can be created with `docker compose exec app npm run paddle:setup` (sandbox), or by hand
(Starter €19, Business €39, Agency €99 per month, one-off report €49); put the `pri_…` IDs into `.env`.
Going live: `PADDLE_ENV=live` with live API key, client token, price IDs and webhook secret, then `docker compose up -d app`.

## 8. Backups

The `backup` service runs daily at `BACKUP_TIME` (UTC) → `./backups/*.db.gz` (keeps `BACKUP_KEEP_DAILY`).

```sh
docker compose exec backup /deploy/backup.sh       # manual backup now
ls -lh backups/
```

Offsite: put `rclone.conf` (e.g. Hetzner Storage Box) in `deploy/rclone/` and set `BACKUP_RCLONE_REMOTE`. Also enable Hetzner server backups.
Restore: `docker compose stop app`, `gunzip -c backups/allyfolio-<stamp>.db.gz > /tmp/allyfolio.db`,
`docker compose cp /tmp/allyfolio.db app:/data/allyfolio.db` (remove `/data/allyfolio.db-wal`/`-shm`), `docker compose start app`.

## 9. Updates

```sh
cd /srv/allyfolio-mono && docker compose -f app/docker-compose.yml exec backup /deploy/backup.sh
git pull --ff-only && cd app && docker compose up -d --build
```
