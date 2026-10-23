#!/usr/bin/env bash
# Pull the latest Somtel Fleet, rebuild and restart. Data and settings are kept.
#   sudo bash /opt/fleet/scripts/cloud/update.sh
set -euo pipefail
APP_DIR=/opt/fleet
BRANCH="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
export PATH=/usr/local/go/bin:$PATH

git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
git -C "$APP_DIR" fetch -q origin "$BRANCH"
git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
(cd "$APP_DIR/web" && npm ci --no-audit --no-fund --loglevel=error && npm run build >/dev/null)
(cd "$APP_DIR/server" && go build -trimpath -ldflags='-s -w' -o bin/fleetd ./cmd/fleetd \
  && go build -trimpath -ldflags='-s -w' -o bin/simulator ./cmd/simulator)
chown -R fleet:fleet "$APP_DIR"
systemctl restart fleetd
sleep 2
echo "Updated to $(git -C "$APP_DIR" log --oneline -1) — fleetd is $(systemctl is-active fleetd)"
