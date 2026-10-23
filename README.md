# Somtel Fleet — GPS fleet tracking & management

A fast, modern fleet tracking platform (Trakzee-style). Teltonika devices first; new tracker
vendors plug in through a single `protocol.Protocol` interface.

- **Server** (`server/`): Go — Teltonika Codec 8 / 8E / 16 gateway (TCP + UDP), PostgreSQL,
  REST + WebSocket API, JWT auth. One binary: `cmd/fleetd`.
- **Web** (`web/`): React + TypeScript + Tailwind + MapLibre — live map, history playback,
  trips, dashboard, device management, dark/light themes.
- **Simulator** (`server/cmd/simulator`): fake Teltonika fleet for demos and load tests.

Docs: [architecture & roadmap](docs/ARCHITECTURE.md) · [API contract](docs/API.md)

## Cloud server (real devices)

One command on a fresh Ubuntu server — see [docs/DEPLOY.md](docs/DEPLOY.md).

## Quick start (Docker)

```sh
cp .env.example .env        # change JWT_SECRET and ADMIN_PASSWORD
docker compose up -d --build
# UI:   http://localhost:8080   (admin@fleet.local / admin by default)
# Point Teltonika devices at <server-ip>:5027 (TCP or UDP)
```

## Development

```sh
# 1. PostgreSQL with a database "fleet" (user/password fleet/fleet)
# 2. Server
cd server && go run ./cmd/fleetd
# 3. Web (hot reload, proxies /api to :8080)
cd web && npm install && npm run dev
# 4. Simulated vehicles
cd server && go run ./cmd/simulator -devices 25
#    add -sensors for fuel (io9, mV; calibration [[0,0],[4500,120]]) and
#    temperature (io72, multiplier 0.1, max 8 °C) sensor data
```

## Running on Windows (no Docker)

In PowerShell, from the cloned folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1   # one time: Go, Node, PostgreSQL via winget
powershell -ExecutionPolicy Bypass -File scripts\windows\start.ps1 -Demo
```

## Running on an Android phone (Termux)

Install **Termux** and **Termux:API** from F-Droid (the Play Store versions are outdated), then:

```sh
pkg install -y git
git clone -b claude/fleet-tracking-management-xli9z8 https://github.com/MoAmiinDeveloper/using-markbot.git
cd using-markbot
bash scripts/termux/setup.sh          # one time, ~10 min
bash scripts/termux/start.sh --phone  # server + this phone as a live GPS tracker
```

Open http://localhost:8080 in the phone's browser. `--demo` adds 10 simulated vehicles.
Grant Termux:API location permission when Android asks. The phone tracker reports as IMEI
`350000000000001`; "ignition" means the phone is charging, so in a car charger it behaves
like a real vehicle tracker. To track the phone against a server elsewhere:
`server/bin/phonetracker -addr <server>:5027 -imei <15 digits>`.

## Configuring a Teltonika device

In Teltonika Configurator → GPRS: set *Domain* to your server address, *Port* `5027`,
*Protocol* TCP (or UDP). Codec 8 Extended is recommended (System → Data Protocol).
Devices auto-register on first connection (`AUTO_REGISTER=true`); rename them in **Devices**.

## Alerts, notifications & Traccar bridge

- **Telegram**: create a bot with @BotFather and paste its token in **Settings**. The server
  long-polls Telegram (no public URL needed); users link their chat from **Notifications**.
- **Web Push**: VAPID keys are generated on first start. Set `VAPID_SUBJECT` to a contact
  `mailto:` address. Browsers require HTTPS (or `localhost`) for push.
- **Traccar**: devices on an existing Traccar server can be bridged in by enabling JSON
  forwarding to `/api/v1/ingest/traccar?token=<token from Settings>` (see
  [API contract](docs/API.md#traccar-bridge)). Bridged devices get alerts but no commands.
