#!/bin/sh
# Entry point of the "backup" service: run backup.sh daily at BACKUP_TIME (UTC, HH:MM) via busybox crond.
set -eu
apk add --no-cache sqlite rclone tzdata >/dev/null
T="${BACKUP_TIME:-03:15}"; H="${T%%:*}"; M="${T##*:}"
echo "$M $H * * * /deploy/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
[ "${BACKUP_ON_START:-0}" = "1" ] && /deploy/backup.sh
echo "[backup] scheduled daily at $T UTC, keeping ${BACKUP_KEEP_DAILY:-14}"
exec crond -f -l 8
