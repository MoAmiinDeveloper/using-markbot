#!/usr/bin/env bash
# Somtel Fleet — one-command install on a fresh Ubuntu 22.04/24.04 server.
#
#   sudo bash install.sh                      # HTTPS on <server-ip>.sslip.io (no domain needed)
#   sudo DOMAIN=fleet.example.com bash install.sh
#
# Installs PostgreSQL, Go, Node.js and Caddy (automatic HTTPS), builds Somtel Fleet,
# runs it as a systemd service, opens the firewall for web (80/443) and Teltonika (5027).
# Safe to re-run: existing database, secrets and admin account are kept.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/MoAmiinDeveloper/using-markbot.git}"
BRANCH="${BRANCH:-claude/fleet-tracking-management-xli9z8}"
APP_DIR=/opt/fleet
ENV_FILE=/etc/fleet/fleet.env
GPS_PORT="${GPS_PORT:-5027}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || echo "Warning: tested on Ubuntu only (found ${ID:-unknown})."
export DEBIAN_FRONTEND=noninteractive
log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

log "Installing system packages"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates gnupg postgresql ufw debian-keyring debian-archive-keyring apt-transport-https >/dev/null

# Small servers (1 GB) run out of memory building the web UI; add swap once.
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 3000 ] && ! swapon --show | grep -q /swapfile; then
  log "Adding 2 GB swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  log "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

GO_VERSION="$(curl -fsSL 'https://go.dev/VERSION?m=text' | head -1)"
if [ "$(/usr/local/go/bin/go version 2>/dev/null | awk '{print $3}')" != "$GO_VERSION" ]; then
  log "Installing $GO_VERSION"
  ARCH="$(dpkg --print-architecture)"   # amd64 | arm64
  curl -fsSL "https://go.dev/dl/${GO_VERSION}.linux-${ARCH}.tar.gz" -o /tmp/go.tgz
  rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tgz && rm /tmp/go.tgz
fi
export PATH=/usr/local/go/bin:$PATH

if ! command -v caddy >/dev/null; then
  log "Installing Caddy (automatic HTTPS)"
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

log "Fetching Somtel Fleet ($BRANCH)"
id fleet >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin fleet
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH" && git -C "$APP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q -b "$BRANCH" "$REPO_URL" "$APP_DIR" || {
    echo "Clone failed. If the repository is private, re-run with a GitHub token:"
    echo "  sudo REPO_URL=https://<TOKEN>@github.com/MoAmiinDeveloper/using-markbot.git bash $0"
    exit 1
  }
fi

log "Building web UI (a few minutes on small servers)"
(cd "$APP_DIR/web" && npm ci --no-audit --no-fund --loglevel=error && npm run build >/dev/null)
log "Building server"
(cd "$APP_DIR/server" && go build -trimpath -ldflags='-s -w' -o bin/fleetd ./cmd/fleetd \
  && go build -trimpath -ldflags='-s -w' -o bin/simulator ./cmd/simulator)
chown -R fleet:fleet "$APP_DIR"

PUBLIC_IP="$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')"
DOMAIN="${DOMAIN:-${PUBLIC_IP//./-}.sslip.io}"

mkdir -p /etc/fleet && chmod 750 /etc/fleet
if [ ! -f "$ENV_FILE" ]; then
  log "Creating database and secrets"
  DB_PASS="$(openssl rand -hex 16)"
  ADMIN_PASS="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)"
  runuser -u postgres -- psql -qtc "SELECT 1 FROM pg_roles WHERE rolname='fleet'" | grep -q 1 \
    && runuser -u postgres -- psql -qc "ALTER ROLE fleet PASSWORD '$DB_PASS'" \
    || runuser -u postgres -- psql -qc "CREATE ROLE fleet LOGIN PASSWORD '$DB_PASS'"
  runuser -u postgres -- psql -qtc "SELECT 1 FROM pg_database WHERE datname='fleet'" | grep -q 1 \
    || runuser -u postgres -- createdb -O fleet fleet
  cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgres://fleet:${DB_PASS}@localhost:5432/fleet?sslmode=disable
HTTP_ADDR=127.0.0.1:8080
TELTONIKA_ADDR=:${GPS_PORT}
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=admin@fleet.local
ADMIN_PASSWORD=${ADMIN_PASS}
AUTO_REGISTER=true
WEB_DIR=${APP_DIR}/web/dist
LOG_FORMAT=json
DATA_DIR=/var/lib/fleet
EOF
  echo "$ADMIN_PASS" > /etc/fleet/initial-admin-password
fi
# Uploaded files (job attachments); older env files get the setting appended.
grep -q '^DATA_DIR=' "$ENV_FILE" || echo "DATA_DIR=/var/lib/fleet" >> "$ENV_FILE"
mkdir -p /var/lib/fleet && chown fleet:fleet /var/lib/fleet && chmod 750 /var/lib/fleet
chown -R root:fleet /etc/fleet && chmod 640 "$ENV_FILE" /etc/fleet/initial-admin-password 2>/dev/null || true

log "Installing services"
cat > /etc/systemd/system/fleetd.service <<EOF
[Unit]
Description=Somtel Fleet server
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=fleet
EnvironmentFile=${ENV_FILE}
ExecStart=${APP_DIR}/server/bin/fleetd
Restart=always
RestartSec=3
LimitNOFILE=65536
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8080
}
EOF

systemctl daemon-reload
systemctl enable --now postgresql >/dev/null
systemctl enable fleetd >/dev/null && systemctl restart fleetd
systemctl enable caddy >/dev/null && systemctl restart caddy

log "Opening firewall: SSH, web, Teltonika ${GPS_PORT}"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
ufw allow "${GPS_PORT}/tcp" >/dev/null && ufw allow "${GPS_PORT}/udp" >/dev/null
ufw --force enable >/dev/null

sleep 3
STATUS="$(systemctl is-active fleetd)"
cat <<EOF

────────────────────────────────────────────────────────────
 Somtel Fleet is ${STATUS}

 Web app:   https://${DOMAIN}
 Login:     admin@fleet.local
 Password:  $(cat /etc/fleet/initial-admin-password 2>/dev/null || echo '(unchanged — see /etc/fleet/initial-admin-password)')

 Teltonika devices → server ${PUBLIC_IP}  port ${GPS_PORT}  protocol TCP

 Logs:      journalctl -u fleetd -f
 Update:    sudo bash ${APP_DIR}/scripts/cloud/update.sh
────────────────────────────────────────────────────────────
EOF
[ "$STATUS" = "active" ] || { echo "fleetd is not running — check: journalctl -u fleetd -n 50"; exit 1; }
