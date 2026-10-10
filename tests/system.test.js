import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { database } from '../server/db.js';
import { HealthService } from '../server/service.js';
import { sample } from '../server/model.js';
import { createApp } from '../server/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
let db, s, now, a, seq;
beforeEach(async () => {
  now = Date.now();
  seq = 0;
  db = await database({ file: ':memory:' });
  s = new HealthService(db, { now: () => now });
  await s.seed(6);
  a = await db.get("SELECT * FROM assignments WHERE device_id='dev-hp01'");
});
afterEach(async () => {
  await s.queue;
  await db.close();
});
const send = async (mode = 'normal', assignment = a, advance = 1000) => {
  now += advance;
  return s.ingest(sample(assignment, seq++, mode, new Date(now).toISOString()));
};
const abnormal = async () => {
  for (let i = 0; i < 7; i++) await send('hypoxia');
};
test('Malformed payloads return validation errors without partial database writes', async () => {
  const good = sample(a, seq++, 'normal', new Date(now).toISOString());
  const missing = { ...good };
  delete missing.assignment_id;
  for (const p of [
    missing,
    { ...good, readings: [null, ...good.readings.slice(1)] },
    { ...good, sampling_interval_ms: 0 },
    { ...good, event: '', readings: good.readings },
    { ...good, event: 'nurse_call', readings: {} },
    { ...good, measured_at: '2026Z' },
  ]) {
    await assert.rejects(
      () => s.ingest(p),
      (e) => e.status === 400 || e.status === 422
    );
  }
  await assert.rejects(
    () => s.ack(null),
    (e) => e.status === 400
  );
  await assert.rejects(
    () => s.confirmEmr(undefined, 'Nurse'),
    (e) => e.status === 400
  );
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM messages')).n, 0);
});
test('Equivalent JSON key order is a duplicate, not a conflicting payload', async () => {
  const p = sample(a, seq++, 'normal', new Date(now).toISOString());
  await s.ingest(p);
  const reordered = Object.fromEntries(Object.entries(p).reverse());
  reordered.readings = p.readings.map((r) => Object.fromEntries(Object.entries(r).reverse()));
  assert.equal((await s.ingest(reordered)).duplicate, true);
});
test('Database readers cannot observe a partial transaction that later rolls back', async () => {
  let entered, release;
  const enteredGate = new Promise((r) => (entered = r)),
    releaseGate = new Promise((r) => (release = r));
  const original = (await db.get('SELECT name FROM patients WHERE id=?', [a.patient_id])).name;
  const transaction = db.transaction(async () => {
    await db.run('UPDATE patients SET name=? WHERE id=?', ['UNCOMMITTED', a.patient_id]);
    entered();
    await releaseGate;
    throw new Error('rollback test');
  });
  transaction.catch(() => {});
  await enteredGate;
  let readFinished = false;
  const reader = db.get('SELECT name FROM patients WHERE id=?', [a.patient_id]).then((row) => {
    readFinished = true;
    return row;
  });
  await nextTurn();
  assert.equal(readFinished, false);
  release();
  await assert.rejects(transaction, /rollback test/);
  assert.equal((await reader).name, original);
});
test('History SQL returns a bounded sample set, skips events and limit=1 selects latest measurement', async () => {
  for (let i = 0; i < 31; i++) await send();
  const event = sample(a, seq++, 'normal', new Date(now + 1).toISOString());
  delete event.readings;
  event.event = 'nurse_call';
  await s.ingest(event);
  const from = new Date(now - 60000).toISOString(),
    to = new Date(now + 1000).toISOString();
  assert.equal((await s.history(a.patient_id, from, to, 7)).length, 7);
  const latest = await s.history(a.patient_id, from, to, 1);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].measured_at, new Date(now).toISOString());
  await assert.rejects(
    () => s.history(a.patient_id, new Date(now - 32 * 86400000).toISOString(), to),
    /31 ngày/
  );
});
test('Snapshot distinguishes suspect data from valid data', async () => {
  await send('motion');
  assert.equal((await s.snapshot()).beds[0].quality, 'suspect');
  await send();
  assert.equal((await s.snapshot()).beds[0].quality, 'valid');
});
test('Open nursing requests show the current patient bed after a transfer', async () => {
  await abnormal();
  now += 1000;
  await s.transfer(a.device_id, 'HP-02', 'Admin');
  const request = (await s.snapshot()).requests.find((r) => r.patient_id === a.patient_id);
  assert.equal(request.bed_id, 'HP-01');
  assert.equal(request.current_bed_id, 'HP-02');
});
test('An accepted request can escalate again if arrival at the bed is overdue', async () => {
  const p = sample(a, seq++, 'normal', new Date(now).toISOString());
  delete p.readings;
  p.event = 'nurse_call';
  await s.ingest(p);
  const r = await db.get('SELECT * FROM requests');
  now += 61000;
  await s.tick();
  await s.workflow(r.id, 'accepted', '', 'Nurse');
  assert.equal((await db.get('SELECT escalated FROM requests WHERE id=?', [r.id])).escalated, 0);
  now += 61000;
  await s.tick();
  assert.equal((await db.get('SELECT escalated FROM requests WHERE id=?', [r.id])).escalated, 1);
  assert.equal(
    (
      await db.get(
        "SELECT COUNT(*) AS n FROM request_events WHERE request_id=? AND action='escalated'",
        [r.id]
      )
    ).n,
    2
  );
});
test('T01/T04: six devices, unique identities, eight readings and two physical sensor types', async () => {
  for (const assignment of await db.all('SELECT * FROM assignments'))
    await send('normal', assignment);
  const state = await s.snapshot();
  assert.equal(state.beds.length, 6);
  assert.equal(state.alarms.length, 0);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM measurements')).n, 48);
  for (const b of state.beds) {
    assert.equal(b.latest.patient_id, b.patient_id);
    assert.ok(b.sensors.some((x) => x.sensor_type === 'DS18B20'));
    assert.ok(b.sensors.some((x) => x.sensor_type === 'MPU6050'));
  }
});
test('T02/T03: sustained abnormal data creates one episode per rule and a matching actuator command', async () => {
  await abnormal();
  const alarms = await db.all("SELECT * FROM alarms WHERE severity='critical'");
  assert.equal(alarms.length, 2);
  await send('hypoxia');
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM alarms')).n, 2);
  const c = await db.get('SELECT * FROM commands ORDER BY created_at DESC LIMIT 1');
  assert.equal(c.mode, 'red_blink');
  await s.ack({
    command_id: c.id,
    device_id: c.device_id,
    assignment_id: c.assignment_id,
    bed_id: c.bed_id,
    mode: c.mode,
    status: 'applied',
  });
  assert.ok((await db.get('SELECT ack_at FROM commands WHERE id=?', [c.id])).ack_at);
});
test('T05: stored patient history is chronological and respects actual sample times', async () => {
  for (let i = 0; i < 12; i++) await send();
  const h = await s.history(
    a.patient_id,
    new Date(now - 60000).toISOString(),
    new Date(now).toISOString(),
    5
  );
  assert.equal(h.length, 5);
  assert.ok(h.every((x) => x.patient_id === a.patient_id));
  assert.ok(Date.parse(h[0].measured_at) < Date.parse(h.at(-1).measured_at));
});
test('T06/T07: nurse call is assigned, escalated and progresses with explicit care record', async () => {
  await send(); // The button may be pressed in the same timestamp second as the latest telemetry.
  const p = sample(a, seq++, 'normal', new Date(now).toISOString());
  delete p.readings;
  p.event = 'nurse_call';
  await s.ingest(p);
  let r = await db.get('SELECT * FROM requests');
  assert.equal(r.state, 'assigned');
  assert.equal(r.assignee, 'Điều dưỡng An');
  now += 61000;
  await s.tick();
  r = await db.get('SELECT * FROM requests WHERE id=?', [r.id]);
  assert.equal(r.escalated, 1);
  for (const step of ['accepted', 'at_bed', 'in_progress', 'completed'])
    await s.workflow(
      r.id,
      step,
      'Đã đánh giá tại giường, hỗ trợ và ghi nhận kết quả',
      'Điều dưỡng An'
    );
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM care_records')).n, 1);
  assert.equal((await db.get("SELECT active FROM alarms WHERE rule='nurse_call'")).active, 0);
  await assert.rejects(() => s.workflow(r.id, 'completed', 'Đã xử lý', 'Nurse'), /Bước xử lý/);
});
test('Workflow cannot skip steps, auto-complete or clear a persisting physiological alarm', async () => {
  await abnormal();
  const r = await db.get('SELECT * FROM requests LIMIT 1');
  await assert.rejects(() => s.workflow(r.id, 'completed', 'Done', 'Nurse'));
  for (const step of ['accepted', 'at_bed', 'in_progress'])
    await s.workflow(r.id, step, '', 'Nurse');
  await assert.rejects(() => s.workflow(r.id, 'completed', 'Đã đánh giá', 'Nurse'), /vẫn còn/);
  for (let i = 0; i < 7; i++) await send('normal');
  assert.equal(
    (await db.get('SELECT state FROM requests WHERE id=?', [r.id])).state,
    'in_progress'
  );
  await s.workflow(r.id, 'completed', 'Đã đánh giá, theo dõi hồi phục', 'Nurse');
});
test('T08/T09: swap preserves late samples with original patient; stale assignment cannot control current lamp', async () => {
  const late = sample(a, seq++, 'hypoxia', new Date(now).toISOString());
  now += 1000;
  const swapped = await s.transfer(a.device_id, 'HP-02', 'Admin');
  const result = await s.ingest(late);
  assert.equal(result.live, false);
  assert.equal(result.patient_id, a.patient_id);
  const current = swapped.find((x) => x.device_id === a.device_id);
  assert.notEqual(current.patient_id, a.patient_id);
  const newer = sample(a, seq++, 'normal', new Date(now + 1000).toISOString());
  await assert.rejects(() => s.ingest(newer), /hiệu lực/);
  await send('normal', current);
  const b = (await s.snapshot()).beds.find((x) => x.device_id === a.device_id);
  assert.equal(b.latest.patient_id, current.patient_id);
  await s.seed(6);
  assert.equal(
    (
      await db.get('SELECT id FROM assignments WHERE device_id=? AND ended_at IS NULL', [
        a.device_id,
      ])
    ).id,
    current.id
  );
});
test('T10: offline generates technical alarm and never presents stale values as online', async () => {
  await send();
  now += 16000;
  await s.tick();
  const b = (await s.snapshot()).beds[0];
  assert.equal(b.online, false);
  assert.ok(b.alarms.some((x) => x.rule === 'offline'));
  await send();
  assert.equal((await s.snapshot()).beds[0].online, true);
});
test('T13: deduplication, collision detection, topic/patient identity and rejected payload transaction', async () => {
  const p = sample(a, seq++, 'normal', new Date(now).toISOString());
  await s.ingest(p);
  assert.equal((await s.ingest(p)).duplicate, true);
  await assert.rejects(() => s.ingest({ ...p, sequence: 999 }), /payload khác/);
  await assert.rejects(
    () => s.ingest({ ...p, message_id: 'wrong-patient', patient_id: 'BN-999' }),
    /Sai định danh/
  );
  await assert.rejects(
    () => s.ingest({ ...p, message_id: 'wrong-topic' }, 'hospital/HP/devices/dev-hp02/telemetry'),
    /Topic/
  );
  const bad = structuredClone(p);
  bad.message_id = 'wrong-unit';
  bad.readings[0].unit = 'bad';
  await assert.rejects(() => s.ingest(bad));
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM messages')).n, 1);
});
test('T14: suspect quality interrupts sustain and cannot clear an existing alarm', async () => {
  await abnormal();
  for (let i = 0; i < 8; i++) await send('motion');
  assert.equal((await db.get("SELECT active FROM alarms WHERE rule='spo2_low'")).active, 1);
  const last = await db.get('SELECT id FROM messages ORDER BY measured_at DESC LIMIT 1');
  await assert.rejects(() => s.confirmEmr(last.id, 'Nurse'), /chất lượng/);
});
test('Old and out-of-order measurements are stored but never overwrite live values', async () => {
  await send();
  const current = (await s.snapshot()).beds[0].latest_at;
  const p = sample(a, seq++, 'hypoxia', new Date(now - 60000).toISOString());
  const result = await s.ingest(p);
  assert.equal(result.live, false);
  assert.equal((await s.snapshot()).beds[0].latest_at, current);
});
test('T11: EMR outage retries durably; confirmation is idempotent, BP uses two components', async () => {
  await send();
  const row = await db.get('SELECT id FROM messages');
  const first = await s.confirmEmr(row.id, 'Nurse');
  await s.confirmEmr(row.id, 'Nurse');
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM emr_outbox')).n, 1);
  s.emrUrl = 'http://127.0.0.1:1/unavailable';
  await s.syncEmr();
  let out = await db.get('SELECT * FROM emr_outbox');
  assert.equal(out.state, 'pending');
  assert.equal(out.attempts, 1);
  assert.ok(out.last_error);
  const bundle = JSON.parse(out.payload);
  const bp = bundle.entry.find((x) => x.resource.code.coding[0].code === '85354-9').resource;
  assert.equal(bp.component.length, 2);
  assert.equal(bp.subject.reference, `Patient/${a.patient_id}`);
  const app = createApp(s);
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  try {
    s.emrUrl = `http://127.0.0.1:${server.address().port}/sandbox/fhir`;
    now += 2000;
    await s.syncEmr();
    out = await db.get('SELECT * FROM emr_outbox');
    assert.equal(out.state, 'sent');
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM emr_records')).n, 1);
    assert.equal(out.id, first.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test('T12: SQLite restart restores active alarms, workflow and commands', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'health-test-'));
  let disk;
  try {
    disk = await database({ file: join(dir, 'health.db') });
    const s1 = new HealthService(disk, { now: () => now });
    await s1.seed();
    for (let i = 0; i < 7; i++) {
      now += 1000;
      await s1.ingest(sample(a, i, 'hypoxia', new Date(now).toISOString()));
    }
    await disk.close();
    disk = await database({ file: join(dir, 'health.db') });
    const s2 = new HealthService(disk, { now: () => now });
    await s2.seed();
    const state = await s2.snapshot();
    assert.equal(state.requests.length, 2);
    assert.equal(state.alarms.length, 2);
    assert.equal(state.beds[0].lamp.mode, 'red_blink');
  } finally {
    await disk?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('ACK rejects wrong device, expired command and old assignment', async () => {
  await send();
  const c = await db.get('SELECT * FROM commands LIMIT 1');
  const ack = {
    command_id: c.id,
    device_id: c.device_id,
    assignment_id: c.assignment_id,
    bed_id: c.bed_id,
    mode: c.mode,
    status: 'applied',
  };
  await assert.rejects(() => s.ack({ ...ack, device_id: 'dev-hp02' }));
  now += 11000;
  await assert.rejects(() => s.ack(ack), /hết hạn/);
});
test('Device reconnect reissues desired lamp state even when the previous command was acknowledged', async () => {
  await abnormal();
  const c = await db.get('SELECT * FROM commands ORDER BY created_at DESC LIMIT 1');
  await s.ack({
    command_id: c.id,
    device_id: c.device_id,
    assignment_id: c.assignment_id,
    bed_id: c.bed_id,
    mode: c.mode,
    status: 'applied',
  });
  now += 1000;
  await s.deviceStatus({ online: true }, `hospital/HP/devices/${a.device_id}/status`);
  const latest = await db.get('SELECT * FROM commands ORDER BY created_at DESC LIMIT 1');
  assert.notEqual(latest.id, c.id);
  assert.equal(latest.mode, 'red_blink');
  assert.equal(latest.ack_at, null);
});
test('HTTP auth, roles and persisted rule version prevent anonymous writes', async () => {
  const app = createApp(s, { demo: true });
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/state')).status, 401);
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nurse', password: 'nurse-demo' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base + '/api/state', { headers: { cookie } })).status, 200);
    assert.equal(
      (
        await fetch(base + '/api/rules', {
          method: 'PUT',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: '{"spo2Low":90}',
        })
      ).status,
      403
    );
    assert.equal(
      (
        await fetch(base + '/api/devices/dev-hp01/call', {
          method: 'POST',
          headers: { cookie, 'Content-Type': 'application/json', origin: 'https://evil.example' },
          body: '{}',
        })
      ).status,
      403
    );
    await s.updateRules({ spo2Low: 90 }, 'Admin');
    assert.equal((await s.rules()).version, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
