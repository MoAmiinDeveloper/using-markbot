#!/data/data/com.termux/files/usr/bin/bash
# One-time setup of FleetOS on Android (Termux): installs dependencies,
# creates the PostgreSQL database and builds the server and web UI.
#   bash scripts/termux/setup.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGDATA="$PREFIX/var/lib/postgresql"
ENV_FILE="$HOME/.fleetos.env"

echo "==> Installing packages"
pkg update -y
pkg install -y golang nodejs-lts postgresql termux-api openssl-tool

echo "==> Setting up PostgreSQL"
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"
  initdb "$PGDATA" >/dev/null
fi
pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" -w start
psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='fleet'" | grep -q 1 \
  || psql -d postgres -qc "CREATE ROLE fleet LOGIN PASSWORD 'fleet'"
psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='fleet'" | grep -q 1 \
  || createdb -O fleet fleet

if [ ! -f "$ENV_FILE" ]; then
  echo "==> Writing $ENV_FILE (edit ADMIN_PASSWORD here)"
  cat > "$ENV_FILE" <<CONF
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=admin@fleet.local
ADMIN_PASSWORD=admin
AUTO_REGISTER=true
CONF
fi

echo "==> Building web UI (takes a few minutes on a phone)"
cd "$ROOT/web" && npm ci --no-audit --no-fund && npm run build

echo "==> Building server"
cd "$ROOT/server"
go build -o bin/fleetd ./cmd/fleetd
go build -o bin/simulator ./cmd/simulator
go build -o bin/phonetracker ./cmd/phonetracker

echo
echo "Done. Start with:  bash scripts/termux/start.sh"
