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

---

# Phase 2 additions

## Device changes

`Device` gains:
```jsonc
"speedLimit": 0,          // km/h, 0 = use global default from /settings
"source": "direct",       // direct (connected to our gateway) | traccar (bridged, no commands)
"commands": true          // whether the device can receive commands right now (direct + connected over TCP)
```
`speedLimit` is accepted by POST/PATCH `/devices`.

Positions: `(device_id, device_time)` is unique; resent duplicates are ignored.

## Events (alerts)

```jsonc
Event = {
  "id": 991, "deviceId": 12,
  "type": "geofenceEnter",   // geofenceEnter | geofenceExit | overspeed | ignitionOn | ignitionOff | alarm | commandResult
  "time": "...",             // device time of the triggering fix
  "lat": 25.2, "lng": 55.3,
  "geofenceId": 3,           // only for geofence events, else null
  "attributes": { "speed": 112, "limit": 100, "alarm": "sos", "geofenceName": "Depot" },
  "message": "Truck 07 entered Depot"   // human readable, server-generated
}
```
Rules (server side, evaluated in device-time order on new fixes only — records older than the
last evaluated fix for that device are stored but don't fire events):
- **geofence**: enter/exit when the fix moves into/out of a geofence that applies to the device.
  Invalid fixes are ignored.
- **overspeed**: speed > limit (device `speedLimit`, else global) continuously for
  `overspeedMinDuration` seconds → one event; re-arms after speed drops below limit.
- **ignitionOn / ignitionOff**: on change of `attributes.ignition`.
- **alarm**: when `attributes.alarm` is present (sos, powerCut, towing, crash, jamming).

| Method | Path | Notes |
|---|---|---|
| GET | `/events?deviceId=&type=&from=&to=&limit=` | `Event[]` newest first, default last 7 days, limit default 200 (max 5000) |

WebSocket: `{"type": "event", "data": Event}` for every new event.

## Geofences

```jsonc
Geofence = {
  "id": 3, "name": "Depot", "color": "#22c55e",
  "type": "circle",                 // circle | polygon
  "center": [55.27, 25.20],         // [lng, lat], circle only
  "radius": 250,                    // meters, circle only
  "polygon": [[lng, lat], ...],     // polygon only, ≥ 3 points, not closed (first != last)
  "deviceIds": [],                  // empty = applies to all devices
  "createdAt": "..."
}
```
| Method | Path | Notes |
|---|---|---|
| GET | `/geofences` | `Geofence[]` |
| POST | `/geofences` | admin → 201 `Geofence` |
| PATCH | `/geofences/{id}` | admin, any subset |
| DELETE | `/geofences/{id}` | admin, 204 |

WebSocket: `{"type": "geofences"}` (no data) whenever geofences change — client refetches.

## Commands

```jsonc
Command = {
  "id": 55, "deviceId": 12, "userId": 1,
  "type": "engineStop",   // engineStop | engineResume | reboot | getInfo | getVersion | custom
  "text": "setdigout 1",  // raw text sent to the device
  "status": "queued",     // queued | sent | success | failed | expired
  "response": "",         // device reply
  "createdAt": "...", "completedAt": null
}
```
Teltonika mapping: engineStop → `setdigout 1`, engineResume → `setdigout 0`, reboot → `cpureset`,
getInfo → `getinfo`, getVersion → `getver`, custom → body `text`.
If the device is not connected the command is `queued` and sent when it next connects (expires
after 24h → `expired`). Bridged (`source: traccar`) devices reject commands with 409.

| Method | Path | Notes |
|---|---|---|
| POST | `/devices/{id}/commands` | body `{"type": "...", "text": "..."}` → 202 `Command`. engineStop/engineResume/custom are admin only |
| GET | `/devices/{id}/commands?limit=` | `Command[]` newest first |

WebSocket: `{"type": "command", "data": Command}` on every status change.

## Settings & notifications

Global settings (admin):
```jsonc
Settings = {
  "speedLimit": 100,              // km/h default
  "overspeedMinDuration": 20,     // seconds
  "telegramBotToken": "",         // write-only: GET returns "" and telegramConfigured instead
  "telegramConfigured": true,     // read-only
  "telegramBotUsername": "my_fleet_bot", // read-only, from getMe
  "traccarToken": "a1b2..."       // token for the Traccar bridge URL; regenerate with POST below
}
```
| Method | Path | Notes |
|---|---|---|
| GET | `/settings` | any user (token fields only for admin) |
| PATCH | `/settings` | admin |
| POST | `/settings/traccar-token` | admin, regenerates → `Settings` |

Per-user notification preferences:
```jsonc
NotificationPrefs = {
  "telegramLinked": false,         // read-only
  "push": { "enabled": true },     // read-only: has ≥1 push subscription
  "events": {                      // per event type → channels
    "geofenceEnter": {"inApp": true, "telegram": true, "push": true},
    "geofenceExit":  {...}, "overspeed": {...}, "ignitionOn": {...}, "ignitionOff": {...}, "alarm": {...}
  }
}
```
| Method | Path | Notes |
|---|---|---|
| GET / PUT | `/me/notifications` | `NotificationPrefs` (PUT accepts `events` only) |
| POST | `/me/telegram/link` | → `{"url": "https://t.me/<bot>?start=<code>", "expiresAt": "..."}`. User opens it and presses Start; server (long-polling getUpdates — works without a public URL) links the chat and sends WS `{"type":"notifications"}` |
| DELETE | `/me/telegram` | unlink |
| POST | `/me/notifications/test` | sends a test message on all linked channels |
| GET | `/push/vapid-key` | `{"publicKey": "..."}` (VAPID keys generated once, stored in DB) |
| POST | `/push/subscriptions` | body = browser `PushSubscription.toJSON()` → 201 |
| DELETE | `/push/subscriptions` | body `{"endpoint": "..."}` → 204 |

Push payload (JSON, read by the service worker): `{"title", "body", "url": "/live?device=12", "tag": "event-991"}`.

## Traccar bridge

`POST /ingest/traccar?token=<traccarToken>` — no JWT. Accepts Traccar's JSON position forwarding
body `{"position": {...}, "device": {...}}`. Devices are matched/auto-registered by
`device.uniqueId` with `source: "traccar"`, `protocol` from the position. Speed is converted from
knots to km/h; common attributes are mapped to our normalized keys. Events/alerts run on bridged
positions exactly like direct ones.

Traccar config (`conf/traccar.xml`, Traccar 5.x/6.x — verified against `Keys.java`; there is no
`forward.enable`/`forward.json` key):
```xml
<entry key='forward.type'>json</entry>
<entry key='forward.url'>http://localhost:8080/api/v1/ingest/traccar?token=TOKEN</entry>
```

## Phase 2 implementation notes (clarifications, all additive)

- **Geofence JSON**: `center`/`radius` are omitted for polygons and `polygon` for circles. A closed
  ring (first point == last) is accepted and stored unclosed. `color` defaults to `#3b82f6`;
  `#rgb` and `#rrggbb` are accepted. Unknown `deviceIds` → 400.
- **Events**: `GET /events?type=` accepts a comma-separated list. Overspeed attributes also carry
  `maxSpeed`; `commandResult` events carry `{commandId, commandType, status, response}`.
  `commandResult` is in-app only (it has no entry in `NotificationPrefs.events`). A device's very
  first fix only establishes geofence/ignition state (no enter/ignition events), but alarms on it fire.
- **Commands**: `userId` is `0` when the issuing user was deleted. Commands left `sent` when the
  server stopped are marked `failed` on the next start.
- **Settings**: `PATCH /settings` with `telegramBotToken` validates it with Telegram `getMe`
  (400 if rejected, 502 if Telegram is unreachable); `""` removes the bot.
- **`POST /me/notifications/test`** → `{"telegram": true, "push": 1}` (delivered to the linked chat /
  number of push subscriptions that accepted it).
- **Traccar bridge**: wrong/missing token → 401; unparsable body → 400; with `AUTO_REGISTER=false`
  unknown devices are acknowledged with `{"status": "ignored"}` (200) so Traccar does not retry.

---

# Phase 3 additions — Trakzee-style operations (reports, drivers, maintenance, access control)

Ownership (for parallel work): **analytics module** = reports, exports, dashboard, places,
geocoding, driver-behaviour/idle events (`api/analytics_routes.go`, migration `0003_*`).
**management module** = roles/groups/users + access control, drivers, maintenance, reminders,
expenses, share links, odometer/engine-hours counters (`api/management_routes.go`,
`api/access.go`, migration `0004_*`).

## Roles & access control

`User.role`: `admin` (everything, all devices) | `manager` (manage devices/drivers/maintenance/
expenses/geofences of devices in their groups; non-engine commands) | `viewer` (read-only, their
groups). Existing `user` rows migrate to `manager`. Non-admins only see devices in their groups —
this applies to **every** endpoint returning device data (devices, positions, trips, events,
commands, reports, dashboard, summary, expenses, maintenance, drivers' vehicles) **and the
WebSocket** (per-client filtering). Admin-only endpoints stay admin-only.

```jsonc
Group = { "id": 1, "name": "North depot", "color": "#ffd700", "deviceIds": [1,2], "createdAt": "..." }
User  = { "id": 1, "email": "...", "name": "...", "role": "admin|manager|viewer",
          "groupIds": [1], "active": true, "createdAt": "...", "lastLoginAt": null }
```
`Device` gains `"groupIds": []`, `"odometer": 123456.7` (km — tracker odometer if reported, else
accumulated GPS distance; settable via PATCH `odometer` to calibrate), `"engineHours": 812.4`
(h, accumulated ignition-on time; settable via PATCH), `"driverId": null` (current driver).

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/groups` | GET: admin all, others their groups. POST admin |
| PATCH/DELETE | `/groups/{id}` | admin |
| GET/POST | `/users` | admin. POST `{email,name,password,role,groupIds}` |
| PATCH/DELETE | `/users/{id}` | admin (can't delete/demote self or last admin) |
| PATCH | `/me` | `{name?, currentPassword?, newPassword?}` |

`User` returned by `/me` and login gains `role` values above plus `groupIds`.

## Drivers

```jsonc
Driver = { "id": 1, "name": "Ahmed Ali", "phone": "", "licenseNumber": "", "licenseExpiry": "2027-01-31",
           "tag": "00000A1B2C3D",       // iButton/RFID id as reported in attributes.driverId (hex, case-insensitive)
           "deviceId": 4,                // currently assigned vehicle (manual) or null
           "notes": "", "createdAt": "..." }
```
Driver resolution for a position: matching `tag` from `attributes.driverId`, else the driver
manually assigned to the device. `GET/POST /drivers`, `PATCH/DELETE /drivers/{id}` (admin/manager).

## Maintenance & reminders

```jsonc
Maintenance = { "id": 1, "deviceId": 4, "name": "Oil change",
  "intervalKm": 10000, "intervalDays": 180, "intervalHours": 0,     // any combination, 0 = unused
  "lastServiceDate": "2026-08-01", "lastServiceKm": 80000, "lastServiceHours": 700,
  "notifyBeforeKm": 500, "notifyBeforeDays": 7, "notifyBeforeHours": 10,
  "status": "ok|dueSoon|overdue",               // computed, worst of the used intervals
  "nextDueKm": 90000, "nextDueDate": "2027-01-28", "nextDueHours": null,
  "remainingKm": 1200.5, "remainingDays": 40, "remainingHours": null }
ServiceRecord = { "id", "maintenanceId", "deviceId", "date", "odometer", "engineHours", "cost", "notes" }
Reminder = { "id", "deviceId": 4|null, "driverId": null|1, "kind": "insurance|registration|license|permit|inspection|other",
             "title": "Insurance renewal", "dueDate": "2026-12-31", "notifyDaysBefore": 14,
             "status": "ok|dueSoon|overdue", "notes": "" }
```
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/maintenance?deviceId=` | |
| PATCH/DELETE | `/maintenance/{id}` | |
| POST | `/maintenance/{id}/complete` | `{date, odometer?, engineHours?, cost?, notes?}` → resets the schedule, stores a ServiceRecord, creates an expense (category maintenance) when cost > 0 |
| GET | `/maintenance/{id}/history` | `ServiceRecord[]` |
| GET/POST | `/reminders?deviceId=&driverId=` | |
| PATCH/DELETE | `/reminders/{id}` | |

A background job (every 10 min) emits events `maintenanceDue` / `documentExpiry` once when an item
enters `dueSoon` and once when it becomes `overdue` (attributes: `{itemId, name, status, ...}`).

## Expenses

```jsonc
Expense = { "id", "deviceId", "driverId": null, "category": "fuel|maintenance|toll|parking|fine|insurance|tyres|other",
            "amount": 45.5, "liters": 30.2, "odometer": 81234, "date": "2026-10-20", "notes": "", "createdAt" }
```
`GET /expenses?deviceId=&from=&to=&category=`, `POST /expenses`, `PATCH/DELETE /expenses/{id}`.
Currency is a global setting.

## Share live location

`POST /devices/{id}/share` `{ "hours": 24 }` → `{ "token", "url": "/share/<token>", "expiresAt" }`
(admin/manager). `GET /devices/{id}/shares`, `DELETE /shares/{token}`.
Public (no auth): `GET /api/v1/public/share/{token}` → `{ "name", "category", "position": Position|null,
"status", "expiresAt" }` (no IMEI/phone). 410 when expired/revoked. The web app serves `/share/:token`.

## Settings additions
`Settings` gains `"currency": "USD"`, `"idleAlertMinutes": 0` (0 = off), `"harshScoring": true`.

## New event types
`harshAcceleration`, `harshBraking`, `harshCornering` (Teltonika green-driving IO 253 with value IO 254;
Traccar alarms `hardAcceleration/hardBraking/hardCornering`), `idle` (ignition on & speed ≤ 3 for ≥
`idleAlertMinutes`, once per idle period; attributes `{minutes}`), `maintenanceDue`, `documentExpiry`.
`NotificationPrefs.events` gains these keys (defaults: inApp on, telegram/push on except idle and harsh*).

## Places (POIs) & addresses

```jsonc
Place = { "id", "name": "Main warehouse", "category": "depot|customer|fuel|parking|workshop|other",
          "lat", "lng", "radius": 150, "color": "#ffd700", "createdAt" }
```
`GET/POST /places`, `PATCH/DELETE /places/{id}` (admin/manager).
`GET /geocode?lat=&lng=` → `{ "address": "Al Quoz, Dubai", "place": Place|null }` — nearest place within its
radius wins; otherwise reverse geocoding (env `GEOCODER=nominatim|off`, default `nominatim`,
`GEOCODER_URL` default `https://nominatim.openstreetmap.org`), cached in DB (rounded to ~10 m),
rate-limited to 1 req/s, never on the ingest path. Falls back to `"lat, lng"`.

## Reports

`GET /reports/{type}?deviceIds=1,2&groupId=&driverId=&from=&to=&format=json|csv|xlsx|pdf`
(default: all visible devices, last 24h; max range 93 days). Always filtered by access scope.

```jsonc
Report = { "type": "summary", "title": "Travel summary", "from": "...", "to": "...",
  "columns": [ { "key": "distance", "label": "Distance", "unit": "km", "kind": "number|duration|datetime|text|speed|money|link" } ],
  "rows": [ { "deviceId": 4, "device": "Truck 07", "distance": 123.4, ... } ],
  "totals": { "distance": 2345.6 } }   // optional
```
`kind: duration` values are seconds. CSV/XLSX/PDF render the same columns (PDF: Somtel-branded
header — navy bar, gold rule, logo text, period, generated-at; landscape A4).

| type | Rows (one per …) | Key columns |
|---|---|---|
| `summary` | device | distance, drivingTime, idleTime, stopTime, engineHours, maxSpeed, avgSpeed, trips, stops, overspeeds, harshEvents, alerts, fuelUsed (if reported) |
| `daily` | device × day | date, distance, drivingTime, idleTime, firstStart, lastStop, maxSpeed |
| `trips` | trip | device, driver, start, end, startAddress, endAddress, distance, duration, maxSpeed, avgSpeed |
| `stops` | stop ≥ 5 min | device, start, end, duration, address, ignition (on → idle stop) |
| `idle` | idle period ≥ 3 min | device, start, end, duration, address |
| `ignition` | ignition on→off span | device, on, off, duration, distance |
| `overspeed` | overspeed event | device, driver, time, speed, limit, maxSpeed, address |
| `geofence` | visit | device, geofence, enter, exit, duration |
| `alerts` | event | device, time, type, message, address |
| `driver` | driver (or device when no driver) | driver, distance, drivingTime, overspeeds, harshAcceleration, harshBraking, harshCornering, idleTime, score (0–100) |
| `expenses` | expense | date, device, category, amount, liters, notes; totals per category |
| `maintenance` | maintenance item | device, item, status, nextDue, remaining, lastService |
| `systemLog` | device | packets, firstPacket, lastPacket, gaps (> 30 min without data), longestGap, avgInterval |

Driver score: `100 − (overspeeds×5 + harsh×3 + idleHours×2)` per 100 km driven, clamped 0–100
(documented in the report subtitle).

## Dashboard

`GET /dashboard?days=7` → 
```jsonc
{ "distanceByDay": [ { "date": "2026-10-16", "distance": 812.3 } ],
  "alertsByType": { "overspeed": 12, ... }, "topVehicles": [ { "deviceId", "name", "distance" } ],
  "driverScores": [ { "driverId"|null, "name", "score", "distance" } ],
  "maintenance": { "dueSoon": 2, "overdue": 1 }, "reminders": { "dueSoon": 1, "overdue": 0 },
  "expenses": { "total": 1234.5, "currency": "USD" },   // current month
  "utilization": 0.42 }   // driving time / (vehicles × period), 0..1
```
