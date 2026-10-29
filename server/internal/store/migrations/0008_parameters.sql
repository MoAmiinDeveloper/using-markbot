-- Data parameters: names for raw attributes (mapped) and formulas that add
-- new attributes to every fix at ingest (calculated). device_id NULL applies
-- to all devices; a device-specific definition of the same key overrides it.
CREATE TABLE param_defs (
    id         bigserial PRIMARY KEY,
    device_id  bigint      REFERENCES devices (id) ON DELETE CASCADE,
    key        text        NOT NULL,
    kind       text        NOT NULL CHECK (kind IN ('mapped', 'calculated')),
    name       text        NOT NULL,
    expression text        NOT NULL DEFAULT '',
    unit       text        NOT NULL DEFAULT '',
    decimals   integer     NOT NULL DEFAULT 2,
    hidden     boolean     NOT NULL DEFAULT false,
    position   integer     NOT NULL DEFAULT 0, -- evaluation / display order
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX param_defs_key ON param_defs (COALESCE(device_id, 0), key);

-- Custom events: a condition over parameters that raises an event when it
-- has held for duration seconds. Empty device_ids = all devices.
CREATE TABLE custom_events (
    id           bigserial PRIMARY KEY,
    name         text        NOT NULL,
    condition    text        NOT NULL,
    device_ids   bigint[]    NOT NULL DEFAULT '{}',
    duration     integer     NOT NULL DEFAULT 0 CHECK (duration BETWEEN 0 AND 86400),
    message      text        NOT NULL DEFAULT '',
    severity     text        NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
    notify_end   boolean     NOT NULL DEFAULT false,
    enabled      boolean     NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Full registration: map icon plus vehicle, SIM, installation and owner details.
ALTER TABLE devices
    ADD COLUMN icon    text  NOT NULL DEFAULT '', -- '' = status arrow
    ADD COLUMN details jsonb NOT NULL DEFAULT '{}';
