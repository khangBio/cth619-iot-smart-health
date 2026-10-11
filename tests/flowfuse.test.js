import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { database } from '../server/db.js';
import { HealthService } from '../server/service.js';
import { createApp } from '../server/index.js';
import proxyFactory from '../infra/node-red/api-proxy.cjs';
import dashboard from '../infra/node-red/build-dashboard.cjs';

test('FlowFuse proxy preserves individual sessions, role checks, exports and CSRF protection', async () => {
  const db = await database({ file: ':memory:' });
  const service = new HealthService(db);
  await service.seed(6);
  const backend = createApp(service).listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const proxy = proxyFactory('http://127.0.0.1:' + backend.address().port);
  const gateway = http
    .createServer((req, res) =>
      proxy(req, res, () => {
        res.writeHead(404);
        res.end();
      })
    )
    .listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  const base = 'http://127.0.0.1:' + gateway.address().port;
  const api = (p, options = {}) => fetch(base + '/health-api' + p, options);
  const json = (body, method = 'POST', cookie) => ({
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  try {
    assert.equal((await api('/state')).status, 401);
    const login = await api(
      '/login',
      json({ username: 'nurse', password: process.env.NURSE_PASSWORD || 'nurse-demo' })
    );
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /Path=\/health-api/);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(cookie, /^ff_health_session=/);
    assert.equal(
      (
        await api('/state', {
          headers: { cookie: cookie.replace(/^ff_health_session=/, 'health_session=') },
        })
      ).status,
      401,
      'legacy dashboard cookie cannot silently restore a logged-out FlowFuse session'
    );
    const state = await api('/state', { headers: { cookie } });
    assert.equal(state.headers.get('cache-control'), 'no-store');
    assert.equal((await state.json()).beds.length, 6);
    assert.equal((await api('/state')).status, 401, 'another browser has no access to nurse data');
    assert.equal((await api('/rules', json({ spo2Low: 90 }, 'PUT', cookie))).status, 403);
    assert.equal((await api('/ingest', json({}))).status, 404);
    const forged = json({}, 'POST', cookie);
    forged.headers.origin = 'https://foreign.example';
    assert.equal((await api('/logout', forged)).status, 403);
    const csv = await api('/export/BN-001', { headers: { cookie } });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-disposition'), /attachment/);
    const admin = await api(
      '/login',
      json({ username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin-demo' })
    );
    const adminCookie = admin.headers.get('set-cookie').split(';')[0];
    assert.equal((await api('/audit', { headers: { cookie: adminCookie } })).status, 200);
    const logout = await api('/logout', json({}, 'POST', cookie));
    assert.match(logout.headers.get('set-cookie'), /Path=\/health-api/);
  } finally {
    gateway.closeAllConnections();
    backend.closeAllConnections();
    await Promise.all([new Promise((r) => gateway.close(r)), new Promise((r) => backend.close(r))]);
    await db.close();
  }
});

test('FlowFuse uses six native pages without patient payloads in shared message state', () => {
  const nodes = dashboard.dashboardNodes();
  assert.equal(nodes.filter((n) => n.type === 'ui-page').length, 6);
  const templates = nodes.filter((n) => n.type === 'ui-template');
  assert.equal(templates.length, 6);
  for (const n of templates) {
    assert.equal(n.storeOutMessages, false);
    assert.equal(n.resendOnRefresh, false);
    assert.equal(n.passthru, false);
    assert.doesNotMatch(n.format, /<iframe|__PAGE__|__TITLE__|__VISUALS__|__STYLES__/);
    assert.match(n.format, /\/health-api/);
  }
});
