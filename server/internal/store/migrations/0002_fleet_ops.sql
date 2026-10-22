-- Phase 2: geofences, events, commands, settings and notifications.

-- Devices resend un-ACKed records; keep one row per (device, device time).
DELETE FROM positions a USING positions b
WHERE a.device_id = b.device_id AND a.device_time = b.device_time AND a.id > b.id;
CREATE UNIQUE INDEX positions_device_time_key ON positions (device_id, device_time);
DROP INDEX positions_device_time_idx;

ALTER TABLE devices
    ADD COLUMN speed_limit double precision NOT NULL DEFAULT 0,
    ADD COLUMN source      text             NOT NULL DEFAULT 'direct' CHECK (source IN ('direct', 'traccar'));

CREATE TABLE geofences (
    id         bigserial PRIMARY KEY,
    name       text             NOT NULL,
    color      text             NOT NULL,
    type       text             NOT NULL CHECK (type IN ('circle', 'polygon')),
    center_lng double precision,
    center_lat double precision,
    radius     double precision,
    polygon    jsonb,           -- [[lng, lat], ...]
    device_ids bigint[]         NOT NULL DEFAULT '{}',
    created_at timestamptz      NOT NULL DEFAULT now(),
    updated_at timestamptz      NOT NULL DEFAULT now()
);

CREATE TABLE events (
    id          bigserial PRIMARY KEY,
    device_id   bigint           NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    type        text             NOT NULL,
    time        timestamptz      NOT NULL,
    lat         double precision NOT NULL DEFAULT 0,
    lng         double precision NOT NULL DEFAULT 0,
    geofence_id bigint           REFERENCES geofences (id) ON DELETE SET NULL,
    attributes  jsonb            NOT NULL DEFAULT '{}',
    message     text             NOT NULL DEFAULT '',
    created_at  timestamptz      NOT NULL DEFAULT now()
);
CREATE INDEX events_time_idx ON events (time DESC, id DESC);
CREATE INDEX events_device_time_idx ON events (device_id, time DESC, id DESC);

CREATE TABLE commands (
    id           bigserial PRIMARY KEY,
    device_id    bigint      NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    user_id      bigint      REFERENCES users (id) ON DELETE SET NULL,
    type         text        NOT NULL,
    text         text        NOT NULL,
    status       text        NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued', 'sent', 'success', 'failed', 'expired')),
    response     text        NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);
CREATE INDEX commands_device_idx ON commands (device_id, id DESC);
CREATE INDEX commands_queued_idx ON commands (device_id, id) WHERE status = 'queued';

-- Global settings and server-generated secrets (VAPID keys, Traccar token).
CREATE TABLE settings (
    key   text PRIMARY KEY,
    value jsonb NOT NULL
);

-- Per-user channel choices per event type; missing types use the defaults.
CREATE TABLE notification_prefs (
    user_id bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    events  jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE telegram_links (
    user_id    bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    chat_id    bigint      NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_subscriptions (
    id         bigserial PRIMARY KEY,
    user_id    bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    endpoint   text        NOT NULL UNIQUE,
    p256dh     text        NOT NULL,
    auth       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);
