CREATE TABLE users (
    id            bigserial PRIMARY KEY,
    email         text        NOT NULL UNIQUE,
    name          text        NOT NULL DEFAULT '',
    password_hash text        NOT NULL,
    role          text        NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
    id         bigserial PRIMARY KEY,
    imei       text        NOT NULL UNIQUE,
    name       text        NOT NULL,
    protocol   text        NOT NULL,
    plate      text        NOT NULL DEFAULT '',
    model      text        NOT NULL DEFAULT '',
    category   text        NOT NULL DEFAULT 'car',
    phone      text        NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE positions (
    id          bigserial PRIMARY KEY,
    device_id   bigint           NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    device_time timestamptz      NOT NULL,
    server_time timestamptz      NOT NULL DEFAULT now(),
    lat         double precision NOT NULL,
    lng         double precision NOT NULL,
    altitude    double precision NOT NULL DEFAULT 0,
    speed       double precision NOT NULL DEFAULT 0,
    course      double precision NOT NULL DEFAULT 0,
    satellites  integer          NOT NULL DEFAULT 0,
    valid       boolean          NOT NULL DEFAULT true,
    priority    integer          NOT NULL DEFAULT 0,
    event_id    integer          NOT NULL DEFAULT 0,
    attributes  jsonb            NOT NULL DEFAULT '{}'
);

CREATE INDEX positions_device_time_idx ON positions (device_id, device_time);

-- Latest known state per device; position is the newest fix by device time.
CREATE TABLE device_state (
    device_id     bigint PRIMARY KEY REFERENCES devices (id) ON DELETE CASCADE,
    position_time timestamptz,
    position      jsonb,
    last_seen     timestamptz
);
