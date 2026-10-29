-- Live activity for the vehicle cards: since when the vehicle is moving /
-- idle / stopped, and the odometer reading at the start of the local day
-- (today's distance = odometer now - day_start_km).
ALTER TABLE device_state
    ADD COLUMN motion_since timestamptz,
    ADD COLUMN day_key      text,             -- YYYY-MM-DD in the fleet time zone
    ADD COLUMN day_start_km double precision; -- odometerKm() at the start of day_key
