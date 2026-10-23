# Somtel Driver (Android)

Native driver app for the Somtel Fleet platform — Kotlin, Jetpack Compose (Material 3), single activity.
It talks to the fleet server's driver API (`/api/v1/auth/login`, `/driver/*`, `/files/{id}`; see
`docs/API.md` → "Phase 4a → Driver app API").

## Features

- Sign in with server URL + email + password (driver accounts; admins allowed for testing). The JWT is
  kept in EncryptedSharedPreferences; a 401 from the server signs the driver out.
- Jobs: Active / History tabs, pull-to-refresh, priority and late indicators, stop progress.
- Job detail: one big button through the driver lifecycle (Accept → Start trip → Arrived → Start work →
  Complete), "Report problem" (→ failed with a reason), stops with Navigate (geo: intent / Google Maps
  fallback) and Arrived / Completed / Skip, Call customer, checklist (required items block Complete),
  notes, photos (camera, downscaled to ≤ 1600 px JPEG 80 %) and a signature pad (PNG).
- Offline-first: every change goes into a persisted queue (`files/queue/actions.json`), the UI updates
  immediately, and WorkManager retries with exponential backoff once a network is available. Items
  show "pending sync" until sent. Permanent rejections (e.g. 409 invalid transition) are dropped and
  shown once.
- New jobs: `/driver/updates?since=` is polled every 30 s while the app is open and every 15 min in the
  background (WorkManager); a "New job assigned: …" notification is posted. No Firebase.
- Optional "Share my location" (Profile screen): a foreground service (type `location`) using the
  platform `LocationManager` posts `/driver/location` every 15 s while a job is in progress.

## Build

Requirements: JDK 17 and the Android SDK (platform 35). The Gradle wrapper (8.14.3) is included.

```bash
cd android
./gradlew assembleDebug            # → app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest        # JVM unit tests (status rules, queue/sync, API client, maths)
./gradlew lint                     # non-fatal
```

CI: `.github/workflows/android.yml` builds the debug APK, runs the unit tests and lint on every push that
touches `android/**`, and uploads the APK as the `somtel-driver-debug-apk` artifact.

## Install

Download the `somtel-driver-debug-apk` artifact from the workflow run (or build locally), then:

```bash
adb install -r app-debug.apk
```

or copy the APK to the phone and open it (allow "install unknown apps" for your file manager/browser).
Android 8.0 (API 26) or newer is required.

## Configure the server

On the sign-in screen enter the server address the web dashboard is served from, e.g.
`https://fleet.example.com` or, on a LAN, `http://192.168.1.10:8080` (no `/api/v1` needed — it is added
automatically; a scheme-less host is treated as `https://`). The last server and email are remembered.

Create a driver login in the web app (Drivers → driver → account; API: `POST /drivers/{id}/account`).

> **Cleartext HTTP:** `res/xml/network_security_config.xml` permits cleartext traffic so drivers can use
> `http://` LAN addresses for testing; the login screen warns when `http://` is used. For production,
> serve the API over HTTPS (and you may then remove `cleartextTrafficPermitted`).

## Project layout

```
app/src/main/java/com/somtel/driver/
  core/            pure Kotlin (no Android imports) — unit-tested on the JVM
    model/         JSON models (kotlinx.serialization)
    net/           OkHttp API client + queue executor
    queue/         persisted action queue, job cache, sync engine
    JobRules.kt    driver status transitions, late detection, stop actions
    JobRepository.kt, OptimisticApplier.kt, NewJobDetector.kt, ServerUrl.kt, ApiError.kt,
    ImageScaling.kt, Signature.kt, MapsLinks.kt, TimeFormat.kt
  data/            SessionStore (encrypted), AppSettings
  work/            WorkManager sync + periodic updates workers
  location/        foreground location service
  notify/          notification channels + new-job notifications
  media/           photo downscaling, signature → PNG
  ui/              Compose screens (login, jobs, detail, signature, profile) + theme
```

Architecture: single activity, Navigation Compose, ViewModels + StateFlow, manual DI (`AppContainer`).

## Translations

All UI text is in `res/values/strings.xml`. A Somali (`values-so`) translation has not been added yet —
it should be done by a native speaker.
