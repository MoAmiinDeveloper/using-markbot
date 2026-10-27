-- Records stamped in the future (tracker clock not yet synced) froze the live
-- position and event rules. Ingest now replaces such times with the arrival
-- time; this repairs data stored before that fix.
DELETE FROM positions p
WHERE p.device_time > p.server_time + interval '10 minutes'
  AND EXISTS (SELECT 1 FROM positions q
              WHERE q.device_id = p.device_id AND q.device_time = p.server_time);

UPDATE positions
SET device_time = server_time,
    attributes = attributes || jsonb_build_object('originalDeviceTime', device_time)
WHERE device_time > server_time + interval '10 minutes';

-- Forget a latest position that is still in the future; the next real fix
-- becomes the latest one.
UPDATE device_state
SET position_time = NULL, position = NULL
WHERE position_time > now() + interval '10 minutes';
