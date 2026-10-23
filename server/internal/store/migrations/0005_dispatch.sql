-- Phase 4a (dispatch module): driver role + driver accounts, jobs with stops,
-- checklists, attachments and a timeline, and routes (path management).

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'manager', 'viewer', 'driver'));

-- Driver login (role 'driver'); deleting the user unlinks the driver.
ALTER TABLE drivers ADD COLUMN user_id bigint UNIQUE REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE routes (
    id                    bigserial PRIMARY KEY,
    name                  text             NOT NULL,
    color                 text             NOT NULL DEFAULT '#ffd700',
    path                  jsonb            NOT NULL, -- [[lng, lat], ...]
    corridor              double precision NOT NULL DEFAULT 200, -- m each side
    min_deviation_seconds integer          NOT NULL DEFAULT 60,
    created_at            timestamptz      NOT NULL DEFAULT now(),
    updated_at            timestamptz      NOT NULL DEFAULT now()
);

CREATE TABLE route_devices (
    route_id  bigint NOT NULL REFERENCES routes (id) ON DELETE CASCADE,
    device_id bigint NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    PRIMARY KEY (route_id, device_id)
);
CREATE INDEX route_devices_device_idx ON route_devices (device_id);

CREATE TABLE jobs (
    id              bigserial PRIMARY KEY,
    title           text        NOT NULL,
    description     text        NOT NULL DEFAULT '',
    priority        text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
    status          text        NOT NULL DEFAULT 'unassigned'
                    CHECK (status IN ('unassigned', 'assigned', 'accepted', 'enRoute', 'arrived', 'inProgress',
                                      'completed', 'failed', 'cancelled')),
    device_id       bigint      REFERENCES devices (id) ON DELETE SET NULL,
    driver_id       bigint      REFERENCES drivers (id) ON DELETE SET NULL,
    route_id        bigint      REFERENCES routes (id) ON DELETE SET NULL,
    customer_name   text        NOT NULL DEFAULT '',
    customer_phone  text        NOT NULL DEFAULT '',
    scheduled_start timestamptz,
    due_by          timestamptz,
    notes           text        NOT NULL DEFAULT '',
    failure_reason  text        NOT NULL DEFAULT '',
    late_notified   boolean     NOT NULL DEFAULT false, -- jobLate raised for the current due_by
    created_by      bigint      REFERENCES users (id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz
);
CREATE INDEX jobs_status_idx ON jobs (status);
CREATE INDEX jobs_device_idx ON jobs (device_id);
CREATE INDEX jobs_driver_idx ON jobs (driver_id, updated_at);
CREATE INDEX jobs_sort_idx ON jobs ((COALESCE(scheduled_start, created_at)) DESC, id DESC);
CREATE INDEX jobs_due_idx ON jobs (due_by) WHERE NOT late_notified AND due_by IS NOT NULL;

CREATE TABLE job_stops (
    id           bigserial PRIMARY KEY,
    job_id       bigint           NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    seq          integer          NOT NULL,
    name         text             NOT NULL DEFAULT '',
    address      text             NOT NULL DEFAULT '',
    lat          double precision NOT NULL,
    lng          double precision NOT NULL,
    radius       double precision NOT NULL DEFAULT 150,
    status       text             NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'arrived', 'completed', 'skipped')),
    arrived_at   timestamptz,
    departed_at  timestamptz,
    completed_at timestamptz,
    notes        text             NOT NULL DEFAULT ''
);
CREATE INDEX job_stops_job_idx ON job_stops (job_id, seq);

CREATE TABLE job_checklist (
    id       bigserial PRIMARY KEY,
    job_id   bigint      NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    seq      integer     NOT NULL,
    text     text        NOT NULL,
    required boolean     NOT NULL DEFAULT false,
    done     boolean     NOT NULL DEFAULT false,
    done_at  timestamptz
);
CREATE INDEX job_checklist_job_idx ON job_checklist (job_id, seq);

-- Files live on disk under DATA_DIR; path is relative to it.
CREATE TABLE job_attachments (
    id           bigserial PRIMARY KEY,
    job_id       bigint      NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    stop_id      bigint      REFERENCES job_stops (id) ON DELETE SET NULL,
    kind         text        NOT NULL CHECK (kind IN ('photo', 'signature', 'document')),
    name         text        NOT NULL,
    content_type text        NOT NULL,
    size         bigint      NOT NULL,
    path         text        NOT NULL,
    user_id      bigint      REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_attachments_job_idx ON job_attachments (job_id, id);

CREATE TABLE job_events (
    id      bigserial PRIMARY KEY,
    job_id  bigint      NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    time    timestamptz NOT NULL DEFAULT now(),
    user_id bigint      REFERENCES users (id) ON DELETE SET NULL,
    kind    text        NOT NULL,
    data    jsonb       NOT NULL DEFAULT '{}'
);
CREATE INDEX job_events_job_idx ON job_events (job_id, time, id);
