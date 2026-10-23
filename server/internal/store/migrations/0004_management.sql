-- Phase 3 (management module): roles, groups, drivers, maintenance, reminders,
-- expenses, share links and per-device odometer / engine-hour counters.

-- Roles: admin | manager | viewer. Existing 'user' accounts become managers.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'manager' WHERE role NOT IN ('admin', 'manager', 'viewer');
ALTER TABLE users
    ALTER COLUMN role SET DEFAULT 'viewer',
    ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'manager', 'viewer')),
    ADD COLUMN active        boolean NOT NULL DEFAULT true,
    ADD COLUMN last_login_at timestamptz;

CREATE TABLE groups (
    id         bigserial PRIMARY KEY,
    name       text        NOT NULL,
    color      text        NOT NULL DEFAULT '#ffd700',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_devices (
    group_id  bigint NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    device_id bigint NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, device_id)
);
CREATE INDEX group_devices_device_idx ON group_devices (device_id);

CREATE TABLE user_groups (
    user_id  bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    group_id bigint NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, group_id)
);
CREATE INDEX user_groups_group_idx ON user_groups (group_id);

-- Odometer / engine-hour counters. Offsets (set by PATCH /devices to
-- calibrate) live on the device; accumulators are advanced by ingest in the
-- same batch as the device_state upsert.
ALTER TABLE devices
    ADD COLUMN odometer_offset     double precision NOT NULL DEFAULT 0, -- km
    ADD COLUMN engine_hours_offset double precision NOT NULL DEFAULT 0; -- h
ALTER TABLE device_state
    ADD COLUMN gps_distance     double precision NOT NULL DEFAULT 0, -- m, haversine sum of valid in-order fixes
    ADD COLUMN engine_seconds   double precision NOT NULL DEFAULT 0, -- s with ignition on
    ADD COLUMN tracker_odometer double precision;                     -- m, last odometer reported by the tracker

CREATE TABLE drivers (
    id             bigserial PRIMARY KEY,
    name           text        NOT NULL,
    phone          text        NOT NULL DEFAULT '',
    license_number text        NOT NULL DEFAULT '',
    license_expiry date,
    tag            text        NOT NULL DEFAULT '', -- iButton/RFID id, upper-case hex; '' = none
    device_id      bigint      REFERENCES devices (id) ON DELETE SET NULL, -- manual assignment
    notes          text        NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX drivers_tag_key ON drivers (ltrim(upper(tag), '0')) WHERE tag <> '';
CREATE UNIQUE INDEX drivers_device_key ON drivers (device_id) WHERE device_id IS NOT NULL;

CREATE TABLE maintenance (
    id                  bigserial PRIMARY KEY,
    device_id           bigint           NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    name                text             NOT NULL,
    interval_km         double precision NOT NULL DEFAULT 0,
    interval_days       integer          NOT NULL DEFAULT 0,
    interval_hours      double precision NOT NULL DEFAULT 0,
    last_service_date   date             NOT NULL DEFAULT CURRENT_DATE,
    last_service_km     double precision NOT NULL DEFAULT 0,
    last_service_hours  double precision NOT NULL DEFAULT 0,
    notify_before_km    double precision NOT NULL DEFAULT 0,
    notify_before_days  integer          NOT NULL DEFAULT 0,
    notify_before_hours double precision NOT NULL DEFAULT 0,
    notified_status     text             NOT NULL DEFAULT 'ok', -- last status an event was raised for
    created_at          timestamptz      NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_device_idx ON maintenance (device_id);

CREATE TABLE service_records (
    id             bigserial PRIMARY KEY,
    maintenance_id bigint           NOT NULL REFERENCES maintenance (id) ON DELETE CASCADE,
    device_id      bigint           NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    date           date             NOT NULL,
    odometer       double precision NOT NULL DEFAULT 0,
    engine_hours   double precision NOT NULL DEFAULT 0,
    cost           double precision NOT NULL DEFAULT 0,
    notes          text             NOT NULL DEFAULT '',
    created_at     timestamptz      NOT NULL DEFAULT now()
);
CREATE INDEX service_records_maintenance_idx ON service_records (maintenance_id, date DESC, id DESC);

CREATE TABLE reminders (
    id                 bigserial PRIMARY KEY,
    device_id          bigint      REFERENCES devices (id) ON DELETE CASCADE,
    driver_id          bigint      REFERENCES drivers (id) ON DELETE CASCADE,
    kind               text        NOT NULL DEFAULT 'other'
                       CHECK (kind IN ('insurance', 'registration', 'license', 'permit', 'inspection', 'other')),
    title              text        NOT NULL,
    due_date           date        NOT NULL,
    notify_days_before integer     NOT NULL DEFAULT 14,
    notes              text        NOT NULL DEFAULT '',
    notified_status    text        NOT NULL DEFAULT 'ok',
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reminders_device_idx ON reminders (device_id);
CREATE INDEX reminders_driver_idx ON reminders (driver_id);

CREATE TABLE expenses (
    id         bigserial PRIMARY KEY,
    device_id  bigint           NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    driver_id  bigint           REFERENCES drivers (id) ON DELETE SET NULL,
    category   text             NOT NULL
               CHECK (category IN ('fuel', 'maintenance', 'toll', 'parking', 'fine', 'insurance', 'tyres', 'other')),
    amount     double precision NOT NULL,
    liters     double precision,
    odometer   double precision,
    date       date             NOT NULL,
    notes      text             NOT NULL DEFAULT '',
    created_at timestamptz      NOT NULL DEFAULT now()
);
CREATE INDEX expenses_date_idx ON expenses (date DESC, id DESC);
CREATE INDEX expenses_device_date_idx ON expenses (device_id, date DESC);

CREATE TABLE share_links (
    token      text PRIMARY KEY,
    device_id  bigint      NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    user_id    bigint      REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);
CREATE INDEX share_links_device_idx ON share_links (device_id);
