# Architecture & roadmap

```
 Trackers (Teltonika FMB/FMC/FMM…)            Browser (React + MapLibre)
        │ TCP :5027 / UDP :5027                        │  REST /api/v1  +  WebSocket /api/v1/ws
        ▼                                              ▼
 ┌──────────────────────────────┐   domain.Sink  ┌──────────────────────────────┐
 │ gateway  (per-protocol port) │ ─────────────▶ │ store (Postgres, batch write) │
 │  └ protocol/teltonika        │                │ hub  (in-memory live fan-out) │
 │  └ protocol/<next vendor>    │                │ api  (chi REST + WS + JWT)    │
 └──────────────────────────────┘                └──────────────────────────────┘
                    single Go binary: cmd/fleetd
```

* **Protocol plug-ins.** Each vendor implements `protocol.Protocol` (`server/internal/protocol`)
  and gets its own listening port. Decoders emit normalized `domain.Position` values with
  well-known attribute keys (`ignition`, `power`, `odometer`…), so the store, API and UI never
  know which vendor a device uses.
* **No data loss.** Gateway ACKs a packet only after `Sink.Positions` returned nil
  (persisted). On error the device keeps the records and resends.
* **Speed.** Go goroutine per connection, pgx batch inserts, latest state cached in memory,
  WebSocket fan-out from memory (no DB round-trip for live view).
* **Storage.** PostgreSQL. `positions` unique on `(device_id, device_time)` (resends are ignored). Ready to move to
  TimescaleDB hypertables / partitioning when volume requires (Phase 4).

## Phases

| Phase | Scope |
|---|---|
| **1 – Core tracking** *(this one)* | Teltonika Codec 8 / 8E / 16 over TCP+UDP, device registry, auth, live map, history playback, trips, device management, device simulator |
| 2 – Fleet operations | Geofences (polygon/circle) + enter/exit events, alerts (overspeed, ignition, SOS, power cut, towing) with in-app + email/Telegram notifications, Codec 12 commands (engine block, reboot) from UI |
| 3 – Reports & drivers | Trip/stop/idle/fuel/mileage reports with CSV/PDF export, drivers (iButton/RFID), maintenance schedules, groups & sub-users with per-device permissions |
| 4 – Scale & multi-tenant | Companies/resellers (Trakzee-style white label), TimescaleDB, Redis pub/sub for multi-node, rate limiting, audit log |
| 5 – More devices & mobile | Additional protocols (Queclink, Concox/GT06, Ruptela, Meitrack…), mobile app/PWA, public share links, OSRM route snapping |
