-- Phase 4a (automation module): scheduled report delivery, run log,
-- sensors with calibration and their latest computed state.
-- Email notifications use users.email (the login address).

CREATE TABLE report_schedules (
    id           bigserial PRIMARY KEY,
    name         text        NOT NULL,
    report_type  text        NOT NULL,
    filters      jsonb       NOT NULL DEFAULT '{}', -- {"deviceIds": [], "groupId": null, "driverId": null}
    period       text        NOT NULL CHECK (period IN ('yesterday', 'today', 'lastWeek', 'thisWeek', 'lastMonth', 'thisMonth')),
    frequency    text        NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
    hour         integer     NOT NULL DEFAULT 7 CHECK (hour BETWEEN 0 AND 23),
    weekday      integer     NOT NULL DEFAULT 1 CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
    month_day    integer     NOT NULL DEFAULT 1 CHECK (month_day BETWEEN 1 AND 31),
    timezone     text        NOT NULL DEFAULT 'UTC',
    format       text        NOT NULL DEFAULT 'pdf' CHECK (format IN ('pdf', 'xlsx', 'csv')),
    telegram_user_ids bigint[] NOT NULL DEFAULT '{}',
    emails       text[]      NOT NULL DEFAULT '{}',
    enabled      boolean     NOT NULL DEFAULT true,
    created_by   bigint      REFERENCES users (id) ON DELETE SET NULL, -- report access scope
    last_run_at  timestamptz,
    last_status  text,       -- ok | error | NULL (never ran)
    last_error   text        NOT NULL DEFAULT '',
    next_run_at  timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_schedules_due_idx ON report_schedules (next_run_at) WHERE enabled;

CREATE TABLE report_runs (
    id          bigserial PRIMARY KEY,
    schedule_id bigint      NOT NULL REFERENCES report_schedules (id) ON DELETE CASCADE,
    time        timestamptz NOT NULL DEFAULT now(),
    status      text        NOT NULL CHECK (status IN ('ok', 'error')),
    error       text        NOT NULL DEFAULT '',
    recipients  jsonb       NOT NULL DEFAULT '[]', -- ["email:ops@example.com", "telegram:Admin"]
    manual      boolean     NOT NULL DEFAULT false
);
CREATE INDEX report_runs_schedule_idx ON report_runs (schedule_id, time DESC);

CREATE TABLE sensors (
    id                  bigserial PRIMARY KEY,
    device_id           bigint           NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    name                text             NOT NULL,
    type                text             NOT NULL CHECK (type IN ('fuel', 'temperature', 'humidity', 'voltage', 'generic')),
    source              text             NOT NULL,          -- position attribute key
    calibration         jsonb            NOT NULL DEFAULT '[]', -- [[raw, value], ...] sorted by raw
    multiplier          double precision NOT NULL DEFAULT 1,
    "offset"            double precision NOT NULL DEFAULT 0,
    unit                text             NOT NULL DEFAULT '',
    decimals            integer          NOT NULL DEFAULT 1,
    min_value           double precision,
    max_value           double precision,
    tank_capacity       double precision,
    fuel_drop_threshold double precision,
    fuel_fill_threshold double precision,
    smoothing           integer          NOT NULL DEFAULT 1,
    created_at          timestamptz      NOT NULL DEFAULT now(),
    updated_at          timestamptz      NOT NULL DEFAULT now()
);
CREATE INDEX sensors_device_idx ON sensors (device_id);

-- Latest computed value and detector state (excursion flags), flushed
-- periodically by the sensors service so restarts neither lose the value
-- shown on the device nor re-announce an excursion.
CREATE TABLE sensor_state (
    sensor_id  bigint PRIMARY KEY REFERENCES sensors (id) ON DELETE CASCADE,
    value      double precision,
    time       timestamptz,
    state      jsonb       NOT NULL DEFAULT '{}',
    updated_at timestamptz NOT NULL DEFAULT now()
);
