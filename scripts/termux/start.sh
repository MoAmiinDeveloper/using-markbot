#!/data/data/com.termux/files/usr/bin/bash
# Starts FleetOS on Android (Termux).
#   bash scripts/termux/start.sh             # server only
#   bash scripts/termux/start.sh --phone     # + this phone reports its GPS as a tracker
#   bash scripts/termux/start.sh --demo      # + 10 simulated vehicles
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGDATA="$PREFIX/var/lib/postgresql"
BIN="$ROOT/server/bin"

set -a; . "$HOME/.fleetos.env"; set +a
export WEB_DIR="$ROOT/web/dist"

pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" -w start
termux-wake-lock 2>/dev/null || true   # keep running with the screen off

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; termux-wake-unlock 2>/dev/null || true; }
trap cleanup EXIT INT TERM

"$BIN/fleetd" &
pids+=($!)
sleep 2

for arg in "$@"; do
  case "$arg" in
    --phone) "$BIN/phonetracker" -addr localhost:5027 -interval 10s & pids+=($!) ;;
    --demo)  "$BIN/simulator" -devices 10 -interval 3s & pids+=($!) ;;
  esac
done

# Best effort only: Android often forbids `ip`, and Termux:API may be missing.
IP="$(timeout 5 termux-wifi-connectioninfo 2>/dev/null | sed -n 's/.*"ip": *"\([0-9.]*\)".*/\1/p')" || IP=""
echo
echo "Somtel Fleet is running:"
echo "  on this phone:      http://localhost:8080"
if [ -n "$IP" ] && [ "$IP" != "0.0.0.0" ]; then
  echo "  same Wi-Fi network: http://$IP:8080   (trackers: $IP:5027)"
fi
echo "Press Ctrl+C to stop."
wait
