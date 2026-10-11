-- Select and run each numbered query separately in pgAdmin Query Tool.
-- These queries read application data; SET changes only this SQL session.
SET TIME ZONE 'Asia/Ho_Chi_Minh';

-- 01. Current patient / bed / device assignments.
SELECT a.bed_id, a.device_id, a.patient_id, p.name,
       a.encounter_id, a.id AS assignment_id,
       a.started_at::timestamptz AS assigned_at
FROM assignments a
JOIN patients p ON p.id = a.patient_id
WHERE a.ended_at IS NULL
ORDER BY a.bed_id;

-- 02. Most recently received telemetry for each CURRENT assignment.
-- Transport delay differs from sample age at query time.
SELECT a.bed_id, a.device_id, a.patient_id,
       m.id AS message_id,
       m.measured_at::timestamptz AS measured_at,
       m.received_at::timestamptz AS received_at,
       round(extract(epoch FROM
         (m.received_at::timestamptz - m.measured_at::timestamptz))::numeric, 2)
         AS transport_delay_seconds,
       round(extract(epoch FROM
         (now() - m.measured_at::timestamptz))::numeric, 2)
         AS sample_age_seconds
FROM assignments a
LEFT JOIN LATERAL (
  SELECT msg.* FROM messages msg
  WHERE msg.assignment_id = a.id
    AND EXISTS (SELECT 1 FROM measurements v WHERE v.message_id = msg.id)
  ORDER BY msg.received_at DESC, msg.id DESC LIMIT 1
) m ON true
WHERE a.ended_at IS NULL
ORDER BY a.bed_id;

-- 03. Last 100 individual readings for one patient, including quality/source.
SELECT measured_at::timestamptz AS measured_at,
       code, value, unit, quality, source, sensor_id, message_id
FROM measurements
WHERE patient_id = 'BN-001'
ORDER BY measured_at DESC, message_id DESC, code
LIMIT 100;

-- 04. Last 20 telemetry packets pivoted to a vital-sign sheet.
-- Invalid/suspect values remain NULL, never converted to zero or forward-filled.
WITH recent AS (
  SELECT m.* FROM messages m
  WHERE m.patient_id = 'BN-001'
    AND EXISTS (SELECT 1 FROM measurements v WHERE v.message_id = m.id)
  ORDER BY m.measured_at DESC, m.id DESC LIMIT 20
)
SELECT r.id AS message_id, r.assignment_id, r.device_id,
       r.measured_at::timestamptz AS measured_at,
       max(v.value) FILTER (WHERE v.code='pulse_rate' AND v.quality='valid') AS pulse_bpm,
       max(v.value) FILTER (WHERE v.code='spo2' AND v.quality='valid') AS spo2_pct,
       max(v.value) FILTER (WHERE v.code='temperature' AND v.quality='valid') AS temperature_c,
       max(v.value) FILTER (WHERE v.code='systolic' AND v.quality='valid') AS systolic_mmhg,
       max(v.value) FILTER (WHERE v.code='diastolic' AND v.quality='valid') AS diastolic_mmhg,
       max(v.value) FILTER (WHERE v.code='respiratory_rate' AND v.quality='valid') AS respiration_per_min,
       max(v.value) FILTER (WHERE v.code='weight' AND v.quality='valid') AS weight_kg,
       count(*) FILTER (WHERE v.quality <> 'valid') AS excluded_readings
FROM recent r JOIN measurements v ON v.message_id=r.id
GROUP BY r.id, r.assignment_id, r.device_id, r.measured_at
ORDER BY r.measured_at DESC, r.id DESC;

-- 05. LINE CHART: one hour ending at the last stored sample, not necessarily now.
-- X = minute; Y = pulse_bpm (or spo2_pct, temperature_c in separate charts).
-- Change interval '1 hour' to '24 hours' for a longer HISTORICAL window.
WITH last_sample AS (
  SELECT max(measured_at::timestamptz) AS last_at
  FROM measurements WHERE patient_id='BN-001'
)
SELECT date_trunc('minute', m.measured_at::timestamptz) AS minute,
       round((avg(m.value) FILTER (WHERE m.code='pulse_rate'))::numeric, 2) AS pulse_bpm,
       round((avg(m.value) FILTER (WHERE m.code='spo2'))::numeric, 2) AS spo2_pct,
       round((avg(m.value) FILTER (WHERE m.code='temperature'))::numeric, 2) AS temperature_c,
       min(m.value) FILTER (WHERE m.code='spo2') AS spo2_min,
       count(*) FILTER (WHERE m.code='pulse_rate') AS pulse_samples
FROM measurements m CROSS JOIN last_sample l
WHERE m.patient_id='BN-001' AND m.quality='valid'
  AND m.code IN ('pulse_rate','spo2','temperature')
  AND m.measured_at::timestamptz BETWEEN l.last_at - interval '1 hour' AND l.last_at
GROUP BY 1 ORDER BY 1;

-- 06. BAR CHART: received telemetry count by device during the last 24 real hours.
-- X = device_id; Y = telemetry_count. Empty/zero results can mean devices stopped.
SELECT d.id AS device_id, count(m.id) AS telemetry_count
FROM devices d
LEFT JOIN messages m ON m.device_id=d.id
  AND m.received_at::timestamptz >= now() - interval '24 hours'
  AND EXISTS (SELECT 1 FROM measurements v WHERE v.message_id=m.id)
GROUP BY d.id ORDER BY d.id;

-- 07. Sources/quality: history can contain both Docker simulation and Wokwi data.
SELECT code, unit, source, quality, count(*) AS reading_count
FROM measurements GROUP BY code, unit, source, quality
ORDER BY code, source, quality;

-- 08. Open alarms and unfinished care tasks (they are different states).
SELECT a.patient_id, a.bed_id, a.rule, a.severity,
       a.active, a.opened_at::timestamptz AS opened_at,
       a.cleared_at::timestamptz AS cleared_at,
       r.id AS request_id, r.state, r.assignee, r.escalated
FROM alarms a LEFT JOIN requests r ON r.alarm_id=a.id
WHERE a.active=1 OR r.state <> 'completed'
ORDER BY a.opened_at DESC LIMIT 100;

-- 09. PIE/BAR CHART: care workflow distribution across stored history.
-- Category = state; value = request_count. This is NOT the count of active alarms.
SELECT state, count(*) AS request_count
FROM requests GROUP BY state ORDER BY state;

-- 10. Recent lamp commands and firmware ACK.
SELECT id AS command_id, device_id, bed_id, assignment_id, mode, attempts,
       created_at::timestamptz AS created_at,
       ack_at::timestamptz AS ack_at,
       CASE WHEN ack_at IS NOT NULL THEN 'acknowledged'
            WHEN expires_at::timestamptz < now() THEN 'expired_without_ack'
            ELSE 'waiting_for_ack' END AS command_status
FROM commands ORDER BY created_at DESC LIMIT 50;

-- 11. EMR delivery state. Empty result means no outbox rows yet.
SELECT state, count(*) AS record_count, max(attempts) AS max_attempts
FROM emr_outbox GROUP BY state ORDER BY state;

-- 12. Inspect the last original telemetry payload (TEXT -> JSONB).
SELECT m.id, m.device_id, m.patient_id,
       m.measured_at::timestamptz AS measured_at,
       m.payload::jsonb AS payload
FROM messages m
WHERE m.patient_id='BN-001'
  AND EXISTS (SELECT 1 FROM measurements v WHERE v.message_id=m.id)
ORDER BY m.received_at DESC, m.id DESC LIMIT 1;
