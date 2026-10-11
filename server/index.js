import express from 'express';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { database } from './db.js';
import { HealthService, requireValue } from './service.js';
import { sample } from './model.js';
import { embeddedBroker, connectPlatform } from './mqtt.js';
import { startSimulator } from '../simulator/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eq = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a || ''),
    y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
};
export function createApp(service, { demo = false } = {}) {
  const app = express(),
    secret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb', type: ['application/json', 'application/fhir+json'] }));
  app.use((req, res, next) => {
    req.body ??= {};
    requireValue(
      typeof req.body === 'object' && !Array.isArray(req.body),
      'JSON body phải là object'
    );
    next();
  });
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    });
    next();
  });
  const sign = (s) => createHmac('sha256', secret).update(s).digest('base64url');
  const loginAttempts = new Map();
  app.post('/api/login', (req, res) => {
    const now = Date.now(),
      entry = loginAttempts.get(req.ip) || { start: now, count: 0 };
    if (now - entry.start > 60000) {
      entry.start = now;
      entry.count = 0;
    }
    requireValue(++entry.count <= 20, 'Thử lại sau một phút', 429);
    loginAttempts.set(req.ip, entry);
    const { username, password } = req.body;
    const role = username === 'admin' ? 'admin' : username === 'nurse' ? 'nurse' : null;
    requireValue(
      role &&
        eq(
          password,
          role === 'admin'
            ? process.env.ADMIN_PASSWORD || 'admin-demo'
            : process.env.NURSE_PASSWORD || 'nurse-demo'
        ),
      'Tài khoản hoặc mật khẩu không đúng',
      401
    );
    const user = {
      role,
      name: role === 'admin' ? 'Điều dưỡng trưởng' : 'Điều dưỡng An',
      exp: Date.now() + 8 * 3600000,
    };
    const body = Buffer.from(JSON.stringify(user)).toString('base64url');
    res.cookie('health_session', `${body}.${sign(body)}`, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      maxAge: 8 * 3600000,
    });
    res.json(user);
  });
  app.post('/api/logout', (req, res) => {
    res.clearCookie('health_session');
    res.json({ ok: true });
  });
  const auth = (req, res, next) => {
    try {
      const token = req.headers.cookie
        ?.split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('health_session='))
        ?.slice(15);
      const [body, signature] = (token || '').split('.');
      requireValue(body && eq(signature, sign(body)), 'Vui lòng đăng nhập', 401);
      req.user = JSON.parse(Buffer.from(body, 'base64url').toString());
      requireValue(req.user.exp > Date.now(), 'Phiên đã hết hạn', 401);
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin)
        requireValue(
          new URL(req.headers.origin).host === req.headers.host,
          'Origin không hợp lệ',
          403
        );
      next();
    } catch (e) {
      next(Object.assign(e, { status: e.status || 401 }));
    }
  };
  const admin = (req, res, next) => {
    requireValue(req.user.role === 'admin', 'Cần quyền quản trị', 403);
    next();
  };
  const ingestAuth = (req, res, next) => {
    requireValue(
      eq(req.headers.authorization, `Bearer ${process.env.INGEST_TOKEN || 'local-ingest-only'}`),
      'Invalid ingestion token',
      401
    );
    next();
  };
  app.get('/api/health', (req, res) =>
    res.json({ ok: true, database: service.db.kind, mqtt: !!service.mqtt?.connected, demo })
  );
  // Wokwi's virtual clock can run slower than real time. Firmware obtains a
  // fresh server clock before sampling, without changing ingestion timestamps.
  app.get('/api/time', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ epoch_ms: service.now() });
  });
  app.post('/api/ingest', ingestAuth, async (req, res) =>
    res.json(await service.ingest(req.body.payload || req.body, req.body.topic))
  );
  app.post('/api/ack', ingestAuth, async (req, res) =>
    res.json(await service.ack(req.body.payload || req.body, req.body.topic))
  );
  app.post('/api/device-status', ingestAuth, async (req, res) =>
    res.json(await service.deviceStatus(req.body.payload || req.body, req.body.topic))
  );
  app.get('/api/device-assignments', ingestAuth, async (req, res) =>
    res.json(await service.db.all('SELECT * FROM assignments WHERE ended_at IS NULL'))
  );
  app.post('/sandbox/fhir', async (req, res) => {
    requireValue(
      eq(req.headers.authorization, `Bearer ${process.env.EMR_TOKEN || 'local-emr-only'}`),
      'Invalid EMR token',
      401
    );
    const p = req.body;
    requireValue(
      p.resourceType === 'Bundle' &&
        p.type === 'transaction' &&
        typeof p.id === 'string' &&
        Array.isArray(p.entry) &&
        p.entry.length > 0 &&
        p.entry.every(
          (e) =>
            ['Observation', 'Communication'].includes(e.resource?.resourceType) &&
            e.request?.method === 'PUT'
        ),
      'Invalid FHIR bundle'
    );
    await service.atomic(() =>
      service.db.run(
        'INSERT INTO emr_records VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        [p.id, JSON.stringify(p), new Date().toISOString()]
      )
    );
    res.json({
      resourceType: 'Bundle',
      type: 'transaction-response',
      entry: p.entry.map((e) => ({ response: { status: '200 OK', location: e.request.url } })),
    });
  });
  app.use('/api', auth);
  app.get('/api/me', (req, res) => res.json(req.user));
  app.get('/api/state', async (req, res) =>
    res.json({ ...(await service.snapshot()), mqtt: !!service.mqtt?.connected, demo })
  );
  app.get('/api/patients/:id/history', async (req, res) =>
    res.json(
      await service.history(
        req.params.id,
        req.query.from || new Date(Date.now() - 3600000).toISOString(),
        req.query.to || new Date().toISOString(),
        Number(req.query.limit || 180)
      )
    )
  );
  app.get('/api/requests/:id/events', async (req, res) =>
    res.json(
      await service.db.all('SELECT * FROM request_events WHERE request_id=? ORDER BY at', [
        req.params.id,
      ])
    )
  );
  app.get('/api/patients/:id/care', async (req, res) =>
    res.json(
      await service.db.all('SELECT * FROM care_records WHERE patient_id=? ORDER BY at DESC', [
        req.params.id,
      ])
    )
  );
  app.post('/api/requests/:id/transition', async (req, res) =>
    res.json(
      await service.workflow(req.params.id, req.body.state, req.body.note || '', req.user.name)
    )
  );
  app.post('/api/emr/confirm', async (req, res) =>
    res.json(await service.confirmEmr(req.body.message_id, req.user.name))
  );
  app.post('/api/emr/care', async (req, res) =>
    res.json(await service.confirmCare(req.body.care_id, req.user.name))
  );
  app.get('/api/emr/records', async (req, res) =>
    res.json(await service.db.all('SELECT * FROM emr_records ORDER BY received_at DESC LIMIT 100'))
  );
  app.get('/api/audit', admin, async (req, res) =>
    res.json(await service.db.all('SELECT * FROM audit_logs ORDER BY at DESC LIMIT 200'))
  );
  app.put('/api/rules', admin, async (req, res) =>
    res.json(await service.updateRules(req.body, req.user.name))
  );
  app.post('/api/assignments/swap', admin, async (req, res) =>
    res.json(await service.transfer(req.body.device_id, req.body.target_bed, req.user.name))
  );
  app.put('/api/devices/:id/scenario', async (req, res) => {
    requireValue(demo, 'Chỉ bật điều khiển kịch bản trong chế độ demo', 403);
    requireValue(
      ['normal', 'hypoxia', 'fever', 'motion', 'offline'].includes(req.body.scenario),
      'Kịch bản không hợp lệ'
    );
    requireValue(
      await service.db.get('SELECT id FROM devices WHERE id=?', [req.params.id]),
      'Không tìm thấy thiết bị',
      404
    );
    await service.atomic(async () => {
      await service.db.run('UPDATE devices SET scenario=? WHERE id=?', [
        req.body.scenario,
        req.params.id,
      ]);
      await service.audit(req.user.name, 'scenario.update', { device: req.params.id, ...req.body });
    });
    res.json({ ok: true });
  });
  app.post('/api/devices/:id/call', async (req, res) => {
    requireValue(demo, 'Chỉ bật trong demo', 403);
    const a = await service.db.get(
      'SELECT * FROM assignments WHERE device_id=? AND ended_at IS NULL',
      [req.params.id]
    );
    requireValue(a, 'Không tìm thấy thiết bị', 404);
    const p = sample(a, Date.now());
    delete p.readings;
    p.event = 'nurse_call';
    await service.publish(`hospital/HP/devices/${a.device_id}/event`, p);
    res.json({ ok: true });
  });
  app.get('/api/export/:id', async (req, res) => {
    const rows = await service.history(
      req.params.id,
      req.query.from || new Date(Date.now() - 86400000).toISOString(),
      req.query.to || new Date().toISOString(),
      2000
    );
    const csv = [
      'patient_id,encounter_id,bed_id,device_id,measured_at,sensor_id,code,value,unit,quality,source',
      ...rows.flatMap((p) =>
        p.readings.map((r) =>
          [
            p.patient_id,
            p.encounter_id,
            p.bed_id,
            p.device_id,
            p.measured_at,
            r.sensor_id,
            r.code,
            r.value,
            r.unit,
            r.quality,
            r.source,
          ]
            .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
            .join(',')
        )
      ),
    ].join('\r\n');
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="vital-signs.csv"',
      })
      .send('\uFEFF' + csv);
  });
  if (process.env.DASHBOARD_URL)
    app.get('/', (req, res) => res.redirect(process.env.DASHBOARD_URL));
  app.use(express.static(resolve(root, 'public')));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API' }));
  app.use((error, req, res, next) => {
    console.warn(error.message);
    res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : 'Lỗi máy chủ; xem nhật ký' });
  });
  return app;
}
export async function start({
  demo = process.argv.includes('--demo'),
  port = Number(process.env.PORT || 3000),
  host = process.env.HOST || '127.0.0.1',
} = {}) {
  const db = await database({
    url: process.env.DATABASE_URL,
    file: process.env.SQLITE_PATH || 'data/health.db',
  });
  const service = new HealthService(db, {
    emrUrl: process.env.EMR_URL || `http://127.0.0.1:${port}/sandbox/fhir`,
    emrToken: process.env.EMR_TOKEN || 'local-emr-only',
  });
  await service.seed(Number(process.env.DEVICE_COUNT || 6));
  let broker, sim;
  if (demo) broker = await embeddedBroker(Number(process.env.MQTT_PORT || 1883));
  const mqtt = await connectPlatform(service, {
    direct: process.env.INGEST_VIA_NODE_RED !== 'true',
  });
  const app = createApp(service, { demo });
  const server = await new Promise((done, reject) => {
    const s = app.listen(port, host, () => done(s));
    s.on('error', reject);
  });
  if (demo)
    sim = startSimulator(await db.all('SELECT * FROM assignments WHERE ended_at IS NULL'), {
      scenario: async (id) =>
        (await db.get('SELECT scenario FROM devices WHERE id=?', [id])).scenario,
    });
  let busy = false,
    configTick = 0;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      if (mqtt.connected && configTick++ % 3 === 0)
        for (const a of await db.all('SELECT * FROM assignments WHERE ended_at IS NULL'))
          await service.publish(`hospital/HP/devices/${a.device_id}/config`, a, { retain: true });
      await service.tick();
    } catch (e) {
      console.error('Worker:', e);
    } finally {
      busy = false;
    }
  }, 10000);
  let emrJob = Promise.resolve();
  const emrTimer = setInterval(() => {
    if (!service.syncing)
      emrJob = service.syncEmr().catch((e) => console.error('EMR worker:', e.message));
  }, 2000);
  console.log(`Smart Health: http://${host}:${server.address().port} | ${db.kind} | demo=${demo}`);
  const close = async () => {
    clearInterval(timer);
    clearInterval(emrTimer);
    while (busy) await new Promise((resolve) => setTimeout(resolve, 20));
    await emrJob;
    await sim?.close();
    await mqtt.endAsync(true);
    await broker?.close();
    await new Promise((r) => server.close(r));
    await service.queue;
    await db.close();
  };
  return { app, server, service, close };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const running = await start();
  process.once('SIGINT', async () => {
    await running.close();
    process.exit(0);
  });
  process.once('SIGTERM', async () => {
    await running.close();
    process.exit(0);
  });
}
