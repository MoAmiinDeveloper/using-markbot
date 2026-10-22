# Fleet API contract (v1)

Base URL: `/api/v1`. JSON everywhere. Times are RFC 3339 UTC strings.
Auth: `Authorization: Bearer <jwt>` on every endpoint except `/auth/login` and `/health`.
Errors: non-2xx with body `{"error": "human readable message"}`.

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/login` | `{"email","password"}` | `{"token": "...", "user": User}` |
| GET | `/me` | – | `User` |

`User = {"id": 1, "email": "admin@fleet.local", "name": "Admin", "role": "admin" | "user"}`

A default admin is created on first start from env `ADMIN_EMAIL` / `ADMIN_PASSWORD`
(defaults `admin@fleet.local` / `admin`).

## Devices

```jsonc
Device = {
  "id": 12,
  "name": "Truck 07",
  "imei": "356307042441013",
  "protocol": "teltonika",
  "plate": "ABC-123",          // may be ""
  "model": "FMB920",           // may be ""
  "category": "car",           // car | truck | van | bus | motorcycle | trailer | other
  "phone": "",                 // SIM number, may be ""
  "status": "moving",          // moving | idle | stopped | offline | never
  "lastSeen": "2026-10-22T10:00:00Z", // null if never connected
  "position": Position | null, // latest position
  "createdAt": "..."
}
```

Status rules (server side, recomputed on read and on each live update):
- `never` – no position ever received
- `offline` – last message older than `OFFLINE_AFTER` (default 10 min)
- `moving` – speed > 3 km/h
- `idle` – speed ≤ 3 and ignition on
- `stopped` – speed ≤ 3 and ignition off/unknown

| Method | Path | Notes |
|---|---|---|
| GET | `/devices` | `Device[]`, ordered by name |
| POST | `/devices` | body `{name, imei, protocol?, plate?, model?, category?, phone?}` → `Device` (201) |
| GET | `/devices/{id}` | `Device` |
| PATCH | `/devices/{id}` | any subset of the POST fields → `Device` |
| DELETE | `/devices/{id}` | 204, also deletes its positions |
| GET | `/devices/{id}/positions?from=&to=&limit=` | `Position[]` ascending by time. `from`/`to` RFC 3339 (default: last 24h). `limit` default 10000, max 100000 |
| GET | `/devices/{id}/trips?from=&to=` | `Trip[]` (see below) |

Unknown IMEIs connecting are auto-registered (name = `Device <last 6 of IMEI>`) when
`AUTO_REGISTER=true` (default), otherwise rejected.

```jsonc
Position = {
  "deviceId": 12, "imei": "...", "protocol": "teltonika",
  "time": "...", "serverTime": "...",
  "lat": 25.2048, "lng": 55.2708,
  "altitude": 12, "speed": 54.0, "course": 270, "satellites": 11,
  "valid": true, "priority": 0, "eventId": 0,
  "attributes": { "ignition": true, "power": 13.8, "battery": 4.1, "odometer": 123456, "rssi": 4, "io21": 4 }
}

Trip = {
  "start": "...", "end": "...",
  "startLat": .., "startLng": .., "endLat": .., "endLng": ..,
  "distance": 12345.6,   // meters (haversine sum)
  "duration": 1800,      // seconds
  "maxSpeed": 92.0, "avgSpeed": 41.2
}
```
Trip detection: a trip starts when speed > 3 km/h (or ignition turns on) and ends after
the vehicle has been stationary for ≥ 5 minutes.

## Summary

`GET /summary` → `{"total": 40, "moving": 12, "idle": 5, "stopped": 18, "offline": 4, "never": 1}`

## Live updates (WebSocket)

`GET /api/v1/ws?token=<jwt>` (token in query because browsers can't set WS headers).

Server → client messages, one JSON object per frame:

```jsonc
{"type": "position", "data": Position}                     // every new fix
{"type": "device",   "data": Device}                       // device created/updated/status changed
{"type": "deleted",  "data": {"id": 12}}                   // device removed
```
Client sends nothing (pings handled by the WS layer). On connect the client should
fetch `/devices` once and then apply the stream.

## Health

`GET /health` → `{"status":"ok"}` (no auth).
