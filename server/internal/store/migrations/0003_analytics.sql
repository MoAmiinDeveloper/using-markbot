-- Phase 3 (analytics): places (POIs), reverse-geocoding cache and report indexes.

CREATE TABLE places (
    id         bigserial PRIMARY KEY,
    name       text             NOT NULL,
    category   text             NOT NULL DEFAULT 'other'
                                CHECK (category IN ('depot', 'customer', 'fuel', 'parking', 'workshop', 'other')),
    lat        double precision NOT NULL,
    lng        double precision NOT NULL,
    radius     double precision NOT NULL DEFAULT 150,
    color      text             NOT NULL DEFAULT '#ffd700',
    created_at timestamptz      NOT NULL DEFAULT now(),
    updated_at timestamptz      NOT NULL DEFAULT now()
);

-- Reverse-geocoded addresses keyed by coordinates rounded to 1e-4 degrees
-- (~11 m). address = '' records a lookup that found nothing.
CREATE TABLE geocode_cache (
    lat_key    integer     NOT NULL,
    lng_key    integer     NOT NULL,
    address    text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lat_key, lng_key)
);

-- Reports and the dashboard aggregate events by type over a period.
CREATE INDEX events_type_time_idx ON events (type, time);
