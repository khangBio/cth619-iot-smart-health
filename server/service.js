import { randomUUID } from 'node:crypto';
import { defaultRules, metrics, names, nurses, sensors } from './model.js';

const uid = () => randomUUID();
const json = JSON.stringify;
const canonical = (value) =>
  json(value, function (key, item) {
    if (item && typeof item === 'object' && !Array.isArray(item))
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((k) => [k, item[k]])
      );
    return item;
  });
const iso = (ms) => new Date(ms).toISOString();
export function requireValue(ok, message, status = 400) {
  if (!ok) throw Object.assign(new Error(message), { status });
}
export class HealthService {
  constructor(
    db,
    { now = () => Date.now(), publish = async () => {}, emrUrl, emrToken = 'local-emr-only' } = {}
  ) {
    this.db = db;
    this.now = now;
    this.publish = publish;
    this.emrUrl = emrUrl;
    this.emrToken = emrToken;
    this.queue = Promise.resolve();
  }
  atomic(fn) {
    const task = this.queue.then(() => this.db.transaction(fn));
    this.queue = task.catch(() => {});
    return task;
  }
  async audit(actor, action, detail) {
    await this.db.run('INSERT INTO audit_logs VALUES (?,?,?,?,?)', [
      uid(),
      actor,
      action,
      iso(this.now()),
      json(detail),
    ]);
  }
  async seed(count = 6) {
    requireValue(
      Number.isInteger(count) && count >= 6 && count <= 100,
      'DEVICE_COUNT phải từ 6 đến 100'
    );
    await this.atomic(async () => {
      await this.db.run('INSERT INTO settings VALUES (?,?) ON CONFLICT(id) DO NOTHING', [
        'rules',
        json(defaultRules),
      ]);
      for (let i = 1; i <= count; i++) {
        const suffix = String(i).padStart(2, '0'),
          p = `BN-${String(i).padStart(3, '0')}`,
          d = `dev-hp${suffix}`,
          b = `HP-${suffix}`,
          e = `ENC-${suffix}`;
        await this.db.run('INSERT INTO patients VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING', [
          p,
          `${names[(i - 1) % names.length]}${i > 8 ? ` ${i}` : ''}`,
          1950 + ((i * 3) % 50),
          i % 2 ? 'Nam' : 'Nữ',
          'Theo dõi hậu phẫu — hồ sơ giả lập',
        ]);
        await this.db.run('INSERT INTO encounters VALUES (?,?,?) ON CONFLICT(id) DO NOTHING', [
          e,
          p,
          iso(this.now() - 86400000),
        ]);
        await this.db.run('INSERT INTO beds VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING', [
          b,
          'HP',
          `P${Math.ceil(i / 4)}`,
          nurses[(i - 1) % 3],
        ]);
        await this.db.run(
          'INSERT INTO devices (id,type,sensors) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING',
          [d, 'ESP32_BEDSIDE_MONITOR', json(sensors(d))]
        );
        // Only create the initial assignment once; never undo a transfer on restart.
        if (!(await this.db.get('SELECT id FROM assignments WHERE device_id=?', [d])))
          await this.db.run('INSERT INTO assignments VALUES (?,?,?,?,?,?,NULL)', [
            `assign-${suffix}-v1`,
            d,
            p,
            e,
            b,
            (await this.db.get('SELECT admitted_at FROM encounters WHERE id=?', [e])).admitted_at,
          ]);
      }
    });
  }
  async rules() {
    return JSON.parse(
      (await this.db.get('SELECT value FROM settings WHERE id=?', ['rules'])).value
    );
  }
  async updateRules(input, actor) {
    return this.atomic(async () => {
      requireValue(
        input &&
          typeof input === 'object' &&
          !Array.isArray(input) &&
          Object.keys(input).length > 0,
        'Cần ít nhất một tham số rule'
      );
      const current = await this.rules();
      for (const [key, value] of Object.entries(input)) {
        requireValue(
          key in current && key !== 'version' && Number.isFinite(value),
          'Tham số rule không hợp lệ'
        );
      }
      const r = { ...current, ...input, version: current.version + 1 };
      requireValue(
        r.spo2Low > 0 &&
          r.spo2Low <= 100 &&
          r.pulseLow >= 0 &&
          r.pulseHigh > r.pulseLow &&
          r.pulseHigh <= 300 &&
          r.temperatureHigh >= 30 &&
          r.temperatureHigh <= 45,
        'Ngưỡng ngoài giới hạn cấu hình'
      );
      for (const key of [
        'sustainSeconds',
        'recoverySeconds',
        'offlineSeconds',
        'escalationSeconds',
        'maxLiveAgeSeconds',
      ])
        requireValue(r[key] >= 1 && r[key] <= 3600, 'Khoảng thời gian phải từ 1 đến 3600 giây');
      await this.db.run('UPDATE settings SET value=? WHERE id=?', [json(r), 'rules']);
      await this.db.run('DELETE FROM rule_state');
      await this.audit(actor, 'rules.update', r);
      return r;
    });
  }
  async assignment(payload) {
    const a = await this.db.get(
      'SELECT a.*,b.ward_id,e.admitted_at FROM assignments a JOIN beds b ON b.id=a.bed_id JOIN encounters e ON e.id=a.encounter_id WHERE a.id=?',
      [payload.assignment_id]
    );
    requireValue(
      a &&
        a.device_id === payload.device_id &&
        a.patient_id === payload.patient_id &&
        a.encounter_id === payload.encounter_id &&
        a.bed_id === payload.bed_id &&
        a.ward_id === payload.ward_id,
      'Sai định danh bệnh nhân / lượt điều trị / thiết bị / giường',
      422
    );
    const t = Date.parse(payload.measured_at);
    requireValue(
      typeof payload.measured_at === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
          payload.measured_at
        ) &&
        Number.isFinite(t) &&
        t >= Date.parse(a.admitted_at) &&
        t >= Date.parse(a.started_at) &&
        (!a.ended_at || t < Date.parse(a.ended_at)) &&
        t <= this.now() + 5000,
      'Thời gian đo ngoài hiệu lực gán thiết bị',
      422
    );
    return a;
  }
  async ingest(p, topic) {
    return this.atomic(async () => {
      requireValue(
        p &&
          p.schema_version === 1 &&
          typeof p.message_id === 'string' &&
          p.message_id.length > 0 &&
          p.message_id.length <= 180 &&
          Number.isInteger(p.sequence) &&
          p.sequence >= 0 &&
          p.device_type === 'ESP32_BEDSIDE_MONITOR',
        'Payload thiếu định danh hoặc sai phiên bản'
      );
      for (const key of [
        'device_id',
        'assignment_id',
        'patient_id',
        'encounter_id',
        'bed_id',
        'ward_id',
      ])
        requireValue(
          typeof p[key] === 'string' && p[key].length > 0 && p[key].length <= 128,
          `Thiếu hoặc sai định danh ${key}`
        );
      requireValue(
        Number.isInteger(p.sampling_interval_ms) &&
          p.sampling_interval_ms >= 100 &&
          p.sampling_interval_ms <= 3600000,
        'sampling_interval_ms không hợp lệ'
      );
      if (topic)
        requireValue(
          topic ===
            `hospital/${p.ward_id}/devices/${p.device_id}/${p.event ? 'event' : 'telemetry'}`,
          'Topic không khớp payload',
          422
        );
      const a = await this.assignment(p);
      const old = await this.db.get('SELECT payload FROM messages WHERE id=?', [p.message_id]);
      if (old) {
        requireValue(
          canonical(JSON.parse(old.payload)) === canonical(p),
          'message_id đã được dùng cho payload khác',
          409
        );
        return { duplicate: true };
      }
      requireValue(p.event === undefined || p.event === 'nurse_call', 'Sự kiện không hợp lệ');
      if (p.event)
        requireValue(
          p.readings === undefined || (Array.isArray(p.readings) && p.readings.length === 0),
          'Event không chứa phép đo'
        );
      if (!p.event) {
        requireValue(
          Array.isArray(p.readings) &&
            p.readings.length === Object.keys(metrics).length &&
            p.readings.every((r) => r && typeof r === 'object' && !Array.isArray(r)) &&
            new Set(p.readings.map((r) => r.code)).size === p.readings.length,
          'Payload phải đủ 8 chỉ số và không trùng mã'
        );
        for (const r of p.readings) {
          const m = metrics[r.code];
          requireValue(
            m &&
              r.sensor_id === `${p.device_id}-${m.sensor}` &&
              r.sensor_type === m.type &&
              r.unit === m.unit &&
              Number.isFinite(r.value) &&
              r.value >= m.min &&
              r.value <= m.max &&
              ['valid', 'suspect', 'invalid'].includes(r.quality) &&
              ['simulated', 'wokwi'].includes(r.source),
            `Phép đo không hợp lệ: ${r.code}`,
            422
          );
        }
      }
      const measured = iso(Date.parse(p.measured_at)),
        received = iso(this.now());
      await this.db.run('INSERT INTO messages VALUES (?,?,?,?,?,?,?)', [
        p.message_id,
        p.device_id,
        a.id,
        a.patient_id,
        measured,
        received,
        canonical(p),
      ]);
      for (const r of p.readings || [])
        await this.db.run('INSERT INTO measurements VALUES (?,?,?,?,?,?,?,?,?,?)', [
          `${p.message_id}:${r.code}`,
          p.message_id,
          a.patient_id,
          r.code,
          r.value,
          r.unit,
          r.quality,
          r.source,
          r.sensor_id,
          measured,
        ]);
      const d = await this.db.get('SELECT * FROM devices WHERE id=?', [p.device_id]),
        rules = await this.rules();
      const live =
        !a.ended_at &&
        this.now() - Date.parse(measured) <= rules.maxLiveAgeSeconds * 1000 &&
        (p.event || !d.latest_at || measured > d.latest_at);
      if (!a.ended_at)
        await this.db.run('UPDATE devices SET last_seen=? WHERE id=?', [received, p.device_id]);
      if (live) {
        if (p.event)
          await this.raise(a, 'nurse_call', 'call', { event: p.event, measured_at: measured });
        else {
          await this.db.run('UPDATE devices SET latest_at=?,latest=? WHERE id=?', [
            measured,
            json(p),
            p.device_id,
          ]);
          await this.clear(a.id, 'offline');
          const by = Object.fromEntries(p.readings.map((r) => [r.code, r]));
          for (const [rule, codes, bad] of [
            ['spo2_low', ['spo2'], by.spo2.value < rules.spo2Low],
            [
              'pulse_abnormal',
              ['pulse_rate'],
              by.pulse_rate.value < rules.pulseLow || by.pulse_rate.value > rules.pulseHigh,
            ],
            ['temperature_high', ['temperature'], by.temperature.value > rules.temperatureHigh],
          ]) {
            const good = codes.every((c) => by[c].quality === 'valid');
            const key = `${a.id}:${rule}`,
              state = await this.db.get('SELECT * FROM rule_state WHERE id=?', [key]);
            let since = state?.since_at,
              recovery = state?.recovery_at;
            const gap =
              d.latest_at &&
              Date.parse(measured) - Date.parse(d.latest_at) > rules.offlineSeconds * 1000;
            if (!good || gap) {
              since = null;
              recovery = null;
            }
            if (good && bad) {
              since ||= measured;
              recovery = null;
              if (Date.parse(measured) - Date.parse(since) >= rules.sustainSeconds * 1000)
                await this.raise(a, rule, rule === 'temperature_high' ? 'warning' : 'critical', {
                  values: codes.map((c) => by[c]),
                  rules,
                  measured_at: measured,
                });
            } else if (good) {
              since = null;
              recovery ||= measured;
              if (Date.parse(measured) - Date.parse(recovery) >= rules.recoverySeconds * 1000)
                await this.clear(a.id, rule);
            }
            await this.db.run(
              'INSERT INTO rule_state VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET since_at=excluded.since_at,recovery_at=excluded.recovery_at',
              [key, since || null, recovery || null]
            );
          }
        }
        await this.lamp(a);
      }
      return { duplicate: false, live, patient_id: a.patient_id, measured_at: measured };
    });
  }
  async raise(a, rule, severity, evidence) {
    if (
      await this.db.get('SELECT id FROM alarms WHERE assignment_id=? AND rule=? AND active=1', [
        a.id,
        rule,
      ])
    )
      return;
    const alarmId = uid(),
      requestId = uid(),
      at = iso(this.now()),
      bed = await this.db.get('SELECT nurse FROM beds WHERE id=?', [a.bed_id]);
    await this.db.run('INSERT INTO alarms VALUES (?,?,?,?,?,?,1,?,NULL,?)', [
      alarmId,
      a.id,
      a.patient_id,
      a.bed_id,
      rule,
      severity,
      at,
      json(evidence),
    ]);
    await this.db.run('INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,0)', [
      requestId,
      alarmId,
      a.patient_id,
      a.bed_id,
      'assigned',
      bed.nurse,
      at,
      at,
    ]);
    await this.db.run('INSERT INTO request_events VALUES (?,?,?,?,?,?)', [
      uid(),
      requestId,
      'system',
      'assigned',
      at,
      bed.nurse,
    ]);
  }
  async clear(assignmentId, rule) {
    await this.db.run(
      'UPDATE alarms SET active=0,cleared_at=? WHERE assignment_id=? AND rule=? AND active=1',
      [iso(this.now()), assignmentId, rule]
    );
  }
  async lamp(a, force = false) {
    const alarms = await this.db.all(
      'SELECT a.*,r.state FROM alarms a JOIN requests r ON r.alarm_id=a.id WHERE a.assignment_id=? AND a.active=1',
      [a.id]
    );
    let mode = 'off';
    if (alarms.some((x) => x.severity === 'critical' || x.severity === 'warning'))
      mode = alarms.some(
        (x) => ['critical', 'warning'].includes(x.severity) && x.state === 'assigned'
      )
        ? 'red_blink'
        : 'red';
    else if (alarms.some((x) => x.rule === 'offline')) mode = 'yellow';
    else if (alarms.some((x) => x.rule === 'nurse_call')) mode = 'blue';
    const last = await this.db.get(
      'SELECT * FROM commands WHERE device_id=? ORDER BY created_at DESC,id DESC LIMIT 1',
      [a.device_id]
    );
    if (
      force ||
      !last ||
      last.mode !== mode ||
      last.assignment_id !== a.id ||
      (!last.ack_at && Date.parse(last.expires_at) <= this.now())
    ) {
      const created = Math.max(this.now(), last ? Date.parse(last.created_at) + 1 : 0);
      await this.db.run('INSERT INTO commands VALUES (?,?,?,?,?,?,?,NULL,0)', [
        uid(),
        a.device_id,
        a.id,
        a.bed_id,
        mode,
        iso(created),
        iso(this.now() + 10000),
      ]);
    }
  }
  async ack(p, topic) {
    return this.atomic(async () => {
      requireValue(
        p && typeof p.command_id === 'string' && p.command_id.length <= 128,
        'ACK thiếu command_id'
      );
      const c = await this.db.get('SELECT * FROM commands WHERE id=?', [p.command_id]);
      requireValue(
        c &&
          p.assignment_id === c.assignment_id &&
          p.device_id === c.device_id &&
          p.bed_id === c.bed_id &&
          p.mode === c.mode &&
          p.status === 'applied' &&
          (!topic || topic === `hospital/HP/beds/${c.bed_id}/lamp/ack`),
        'ACK không khớp lệnh',
        422
      );
      const active = await this.db.get(
        'SELECT id FROM assignments WHERE id=? AND ended_at IS NULL',
        [c.assignment_id]
      );
      requireValue(active && Date.parse(c.expires_at) > this.now(), 'ACK đã hết hạn', 409);
      await this.db.run('UPDATE commands SET ack_at=COALESCE(ack_at,?) WHERE id=?', [
        iso(this.now()),
        c.id,
      ]);
      return { accepted: true };
    });
  }
  async deviceStatus(p, topic) {
    return this.atomic(async () => {
      const match = /^hospital\/HP\/devices\/(dev-hp\d{2,3})\/status$/.exec(topic || '');
      requireValue(match && p && typeof p.online === 'boolean', 'Trạng thái thiết bị không hợp lệ');
      const a = await this.db.get(
        'SELECT * FROM assignments WHERE device_id=? AND ended_at IS NULL',
        [match[1]]
      );
      requireValue(a, 'Thiết bị chưa được đăng ký', 422);
      // A reboot resets GPIO. Reissue the desired state even if an older command was ACKed.
      if (p.online) await this.lamp(a, true);
      return { accepted: true };
    });
  }
  async workflow(id, state, note, actor) {
    return this.atomic(async () => {
      const r = await this.db.get(
        'SELECT r.*,a.active,a.rule,a.assignment_id FROM requests r JOIN alarms a ON a.id=r.alarm_id WHERE r.id=?',
        [id]
      );
      requireValue(r, 'Không tìm thấy yêu cầu', 404);
      const transitions = {
        assigned: 'accepted',
        accepted: 'at_bed',
        at_bed: 'in_progress',
        in_progress: 'completed',
      };
      requireValue(
        transitions[r.state] === state,
        'Bước xử lý không hợp lệ hoặc yêu cầu đã thay đổi',
        409
      );
      requireValue(typeof note === 'string' && note.length <= 2000, 'Ghi chú không hợp lệ');
      if (state === 'completed') {
        requireValue(note.trim().length >= 5, 'Cần ghi nhận đánh giá, hành động và kết quả');
        requireValue(
          !r.active || r.rule === 'nurse_call',
          'Điều kiện cảnh báo vẫn còn; cần đánh giá và chờ phục hồi',
          409
        );
        if (r.rule === 'nurse_call') await this.clear(r.assignment_id, 'nurse_call');
        await this.db.run('INSERT INTO care_records VALUES (?,?,?,?,?,?)', [
          uid(),
          id,
          r.patient_id,
          actor,
          iso(this.now()),
          note.trim(),
        ]);
      }
      await this.db.run(
        'UPDATE requests SET state=?,assignee=?,updated_at=?,escalated=0 WHERE id=?',
        [state, actor, iso(this.now()), id]
      );
      await this.db.run('INSERT INTO request_events VALUES (?,?,?,?,?,?)', [
        uid(),
        id,
        actor,
        state,
        iso(this.now()),
        note,
      ]);
      await this.audit(actor, 'request.' + state, { id, note });
      const a = await this.db.get('SELECT * FROM assignments WHERE id=? AND ended_at IS NULL', [
        r.assignment_id,
      ]);
      if (a) await this.lamp(a);
      return { state };
    });
  }
  async transfer(deviceId, targetBed, actor) {
    return this.atomic(async () => {
      requireValue(
        typeof deviceId === 'string' && typeof targetBed === 'string',
        'Cần device_id và target_bed'
      );
      const a = await this.db.get(
        'SELECT * FROM assignments WHERE device_id=? AND ended_at IS NULL',
        [deviceId]
      );
      const b = await this.db.get('SELECT * FROM assignments WHERE bed_id=? AND ended_at IS NULL', [
        targetBed,
      ]);
      requireValue(a && b && a.id !== b.id, 'Chọn hai giường khác nhau đang được gán', 422);
      const at = iso(this.now());
      // Bedside monitors stay at their physical bed; swap patient + encounter bindings.
      await this.db.run('UPDATE assignments SET ended_at=? WHERE id IN (?,?)', [at, a.id, b.id]);
      const result = [];
      for (const [slot, patient] of [
        [a, b],
        [b, a],
      ]) {
        const next = {
          ...slot,
          id: `assign-${uid()}`,
          patient_id: patient.patient_id,
          encounter_id: patient.encounter_id,
          started_at: at,
          ended_at: null,
        };
        await this.db.run('INSERT INTO assignments VALUES (?,?,?,?,?,?,NULL)', [
          next.id,
          next.device_id,
          next.patient_id,
          next.encounter_id,
          next.bed_id,
          at,
        ]);
        await this.db.run(
          'UPDATE devices SET latest=NULL,latest_at=NULL,last_seen=NULL WHERE id=?',
          [slot.device_id]
        );
        await this.db.run(
          'UPDATE alarms SET active=0,cleared_at=? WHERE assignment_id=? AND active=1',
          [at, slot.id]
        );
        await this.lamp(next, true);
        result.push(next);
      }
      await this.audit(actor, 'assignment.swap', { previous: [a, b], next: result });
      return result;
    });
  }
  async tick() {
    await this.atomic(async () => {
      const r = await this.rules(),
        at = this.now();
      const assignments = await this.db.all(
        'SELECT a.*,d.latest_at FROM assignments a JOIN devices d ON d.id=a.device_id WHERE a.ended_at IS NULL'
      );
      for (const a of assignments) {
        if (at - Date.parse(a.latest_at || a.started_at) > r.offlineSeconds * 1000)
          await this.raise(a, 'offline', 'technical', {
            latest_at: a.latest_at,
            detected_at: iso(at),
            rules: r,
          });
        await this.lamp(a);
      }
      const pending = await this.db.all(
        "SELECT * FROM requests WHERE state IN ('assigned','accepted') AND escalated=0"
      );
      for (const req of pending)
        if (at - Date.parse(req.updated_at) >= r.escalationSeconds * 1000) {
          await this.db.run('UPDATE requests SET escalated=1,assignee=? WHERE id=?', [
            'Điều dưỡng trưởng',
            req.id,
          ]);
          await this.db.run('INSERT INTO request_events VALUES (?,?,?,?,?,?)', [
            uid(),
            req.id,
            'system',
            'escalated',
            iso(at),
            'Quá hạn tiếp nhận / đến giường',
          ]);
        }
    });
    const commands = await this.db.all(
      'SELECT c.* FROM commands c JOIN assignments a ON a.id=c.assignment_id WHERE c.ack_at IS NULL AND c.expires_at>? AND a.ended_at IS NULL AND NOT EXISTS (SELECT 1 FROM commands n WHERE n.device_id=c.device_id AND n.created_at>c.created_at)',
      [iso(this.now())]
    );
    for (const c of commands) {
      try {
        await this.publish(`hospital/HP/beds/${c.bed_id}/lamp/cmd`, {
          command_id: c.id,
          device_id: c.device_id,
          assignment_id: c.assignment_id,
          bed_id: c.bed_id,
          mode: c.mode,
          issued_at: c.created_at,
          expires_at: c.expires_at,
        });
        await this.atomic(() =>
          this.db.run('UPDATE commands SET attempts=attempts+1 WHERE id=?', [c.id])
        );
      } catch {
        /* Persisted command retries until its expiry; next tick creates a replacement. */
      }
    }
  }
  async snapshot() {
    await this.queue;
    return this.db.transaction(() => this.readSnapshot());
  }
  async readSnapshot() {
    const rules = await this.rules();
    const beds = await this.db.all(
      'SELECT a.*,b.room,b.nurse,p.name,p.birth_year,p.sex,p.diagnosis,d.latest,d.latest_at,d.last_seen,d.scenario,d.sensors FROM assignments a JOIN beds b ON b.id=a.bed_id JOIN patients p ON p.id=a.patient_id JOIN devices d ON d.id=a.device_id WHERE a.ended_at IS NULL ORDER BY a.bed_id'
    );
    const alarms = await this.db.all(
      'SELECT * FROM alarms WHERE active=1 OR id IN (SELECT id FROM alarms WHERE active=0 ORDER BY opened_at DESC LIMIT 100) ORDER BY opened_at DESC'
    );
    const requests = await this.db.all(
      "SELECT r.*,a.rule,a.severity,a.active,ca.bed_id AS current_bed_id FROM requests r JOIN alarms a ON a.id=r.alarm_id LEFT JOIN assignments ca ON ca.patient_id=r.patient_id AND ca.ended_at IS NULL WHERE r.state<>'completed' OR r.id IN (SELECT id FROM requests WHERE state='completed' ORDER BY updated_at DESC LIMIT 100) ORDER BY r.created_at DESC"
    );
    for (const b of beds) {
      b.latest = b.latest ? JSON.parse(b.latest) : null;
      b.sensors = JSON.parse(b.sensors);
      b.online =
        !!b.latest_at && this.now() - Date.parse(b.latest_at) <= rules.offlineSeconds * 1000;
      b.quality = b.latest
        ? b.latest.readings.some((r) => r.quality === 'invalid')
          ? 'invalid'
          : b.latest.readings.some((r) => r.quality === 'suspect')
            ? 'suspect'
            : 'valid'
        : 'unknown';
      b.alarms = alarms.filter((a) => a.assignment_id === b.id && a.active);
      b.requests = requests.filter((r) => r.patient_id === b.patient_id && r.state !== 'completed');
      b.lamp = await this.db.get(
        'SELECT * FROM commands WHERE device_id=? ORDER BY created_at DESC,id DESC LIMIT 1',
        [b.device_id]
      );
    }
    return {
      at: iso(this.now()),
      beds,
      alarms,
      requests,
      rules,
      database: this.db.kind,
      outbox: await this.db.all(
        'SELECT id,patient_id,state,attempts,last_error,sent_at FROM emr_outbox ORDER BY next_at DESC LIMIT 100'
      ),
    };
  }
  async history(patientId, from, to, limit = 180) {
    requireValue(
      typeof patientId === 'string' &&
        Number.isFinite(Date.parse(from)) &&
        Number.isFinite(Date.parse(to)) &&
        Date.parse(from) <= Date.parse(to),
      'Khoảng thời gian không hợp lệ'
    );
    requireValue(
      Number.isInteger(limit) && limit >= 1 && limit <= 2000,
      'limit phải từ 1 đến 2000'
    );
    requireValue(Date.parse(to) - Date.parse(from) <= 31 * 86400000, 'Mỗi truy vấn tối đa 31 ngày');
    const scope = `FROM messages m WHERE m.patient_id=? AND m.measured_at>=? AND m.measured_at<=?
      AND EXISTS (SELECT 1 FROM measurements v WHERE v.message_id=m.id)`;
    const params = [patientId, iso(Date.parse(from)), iso(Date.parse(to))];
    // Select IDs inside SQL first; at most limit payloads are loaded into Node memory.
    const rows =
      limit === 1
        ? await this.db.all(
            `SELECT m.payload ${scope} ORDER BY m.measured_at DESC,m.id DESC LIMIT 1`,
            params
          )
        : await this.db.all(
            `WITH ranked AS (
          SELECT m.id,m.measured_at,ROW_NUMBER() OVER (ORDER BY m.measured_at,m.id)-1 AS position,
          COUNT(*) OVER () AS total ${scope}
        ) SELECT m.payload FROM ranked r JOIN messages m ON m.id=r.id
        WHERE r.total<=? OR r.position=0 OR r.position=r.total-1
          OR (r.position*(CAST(? AS INTEGER)-1))/NULLIF(r.total-1,0)>((r.position-1)*(CAST(? AS INTEGER)-1))/NULLIF(r.total-1,0)
        ORDER BY r.measured_at,r.id`,
            [...params, limit, limit, limit]
          );
    return rows.map((r) => JSON.parse(r.payload));
  }
  async confirmEmr(messageId, actor) {
    return this.atomic(async () => {
      requireValue(
        typeof messageId === 'string' && messageId.length <= 180,
        'Cần message_id hợp lệ'
      );
      const row = await this.db.get('SELECT * FROM messages WHERE id=?', [messageId]);
      requireValue(row, 'Không tìm thấy phép đo', 404);
      const p = JSON.parse(row.payload);
      requireValue(
        !p.event && p.readings.every((r) => r.quality === 'valid'),
        'Chỉ xác nhận bộ kết quả có chất lượng hợp lệ',
        422
      );
      const id = `obs-${Buffer.from(messageId).toString('base64url').slice(0, 20)}-${(await import('node:crypto')).createHash('sha256').update(messageId).digest('hex').slice(0, 16)}`;
      const coding = (code) => ({ coding: [{ system: 'http://loinc.org', code }] });
      const quantity = (r) => ({
        value: r.value,
        unit: r.unit,
        system: 'http://unitsofmeasure.org',
        code: r.unit,
      });
      const base = {
        resourceType: 'Observation',
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'vital-signs',
              },
            ],
          },
        ],
        subject: { reference: `Patient/${p.patient_id}` },
        encounter: { reference: `Encounter/${p.encounter_id}` },
        effectiveDateTime: p.measured_at,
        issued: iso(this.now()),
        device: { reference: `Device/${p.device_id}` },
        note: [{ text: `Dữ liệu mô phỏng; xác nhận bởi ${actor}; assignment ${p.assignment_id}` }],
      };
      const resources = p.readings
        .filter((r) => metrics[r.code].loinc && !['systolic', 'diastolic'].includes(r.code))
        .map((r) => ({
          ...base,
          id: `${id}-${r.code.replaceAll('_', '-')}`,
          code: coding(metrics[r.code].loinc),
          valueQuantity: quantity(r),
        }));
      resources.push({
        ...base,
        id: `${id}-bp`,
        code: coding('85354-9'),
        component: p.readings
          .filter((r) => ['systolic', 'diastolic'].includes(r.code))
          .map((r) => ({ code: coding(metrics[r.code].loinc), valueQuantity: quantity(r) })),
      });
      const bundle = {
        resourceType: 'Bundle',
        type: 'transaction',
        id,
        entry: resources.map((resource) => ({
          resource,
          request: { method: 'PUT', url: `Observation/${resource.id}` },
        })),
      };
      await this.db.run(
        'INSERT INTO emr_outbox (id,patient_id,payload,state,next_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
        [id, p.patient_id, json(bundle), 'pending', iso(this.now())]
      );
      await this.audit(actor, 'emr.confirm', { messageId, id });
      return { id };
    });
  }
  async confirmCare(id, actor) {
    return this.atomic(async () => {
      requireValue(typeof id === 'string' && id.length <= 128, 'Cần care_id hợp lệ');
      const c = await this.db.get('SELECT * FROM care_records WHERE id=?', [id]);
      requireValue(c, 'Không tìm thấy ghi nhận chăm sóc', 404);
      const resource = {
        resourceType: 'Communication',
        id: `care-${id}`,
        status: 'completed',
        subject: { reference: `Patient/${c.patient_id}` },
        sent: c.at,
        payload: [{ contentString: `${c.actor}: ${c.note}` }],
      };
      const bundle = {
        resourceType: 'Bundle',
        type: 'transaction',
        id: resource.id,
        entry: [{ resource, request: { method: 'PUT', url: `Communication/${resource.id}` } }],
      };
      await this.db.run(
        'INSERT INTO emr_outbox (id,patient_id,payload,state,next_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
        [resource.id, c.patient_id, json(bundle), 'pending', iso(this.now())]
      );
      await this.audit(actor, 'care.confirm', { id });
      return { id: resource.id };
    });
  }
  async syncEmr() {
    if (!this.emrUrl || this.syncing) return;
    this.syncing = true;
    try {
      const rows = await this.db.all(
        "SELECT * FROM emr_outbox WHERE state='pending' AND next_at<=? LIMIT 10",
        [iso(this.now())]
      );
      for (const row of rows) {
        try {
          const result = await fetch(this.emrUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/fhir+json',
              Authorization: `Bearer ${this.emrToken}`,
              'Idempotency-Key': row.id,
            },
            body: row.payload,
            signal: AbortSignal.timeout(4000),
          });
          if (!result.ok) throw new Error(`EMR HTTP ${result.status}`);
          const response = await result.json();
          requireValue(
            response.resourceType === 'Bundle' &&
              response.type === 'transaction-response' &&
              response.entry?.length === JSON.parse(row.payload).entry.length &&
              response.entry.every((e) => /^2\d\d/.test(e.response?.status)),
            'EMR trả kết quả không hợp lệ',
            502
          );
          await this.atomic(() =>
            this.db.run(
              "UPDATE emr_outbox SET state='sent',sent_at=?,attempts=attempts+1,last_error=NULL WHERE id=?",
              [iso(this.now()), row.id]
            )
          );
        } catch (e) {
          await this.atomic(() =>
            this.db.run(
              'UPDATE emr_outbox SET attempts=attempts+1,last_error=?,next_at=? WHERE id=?',
              [
                String(e.message).slice(0, 300),
                iso(this.now() + Math.min(60000, 1000 * 2 ** Math.min(row.attempts, 6))),
                row.id,
              ]
            )
          );
        }
      }
    } finally {
      this.syncing = false;
    }
  }
}
