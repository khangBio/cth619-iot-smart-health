import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database } from '../server/db.js';
import { HealthService } from '../server/service.js';
import { embeddedBroker, connectPlatform, withTimeout } from '../server/mqtt.js';
import { startSimulator } from '../simulator/index.js';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
test('MQTT publish timeout bounds a broker acknowledgement that never arrives', async () => {
  await assert.rejects(() => withTimeout(new Promise(() => {}), 20), /timeout/);
});
test('Real MQTT end-to-end: six authenticated publishers → database → alarm → command → actuator ACK', async () => {
  const db = await database({ file: ':memory:' });
  const s = new HealthService(db);
  await s.seed(6);
  await s.updateRules({ sustainSeconds: 1 }, 'test');
  const broker = await embeddedBroker(0);
  const url = `mqtt://127.0.0.1:${broker.port}`;
  const platform = await connectPlatform(s, { url });
  const sim = startSimulator(await db.all('SELECT * FROM assignments'), {
    url,
    scenario: async (id) => (id === 'dev-hp01' ? 'hypoxia' : 'normal'),
  });
  try {
    const deadline = Date.now() + 12000;
    let state;
    while (Date.now() < deadline) {
      await delay(500);
      await s.tick();
      state = await s.snapshot();
      if (
        state.beds.every((b) => b.online) &&
        state.beds[0].alarms.some((a) => a.rule === 'spo2_low') &&
        state.beds[0].lamp?.mode === 'red_blink' &&
        state.beds[0].lamp.ack_at
      )
        break;
    }
    assert.ok(state.beds.every((b) => b.online));
    assert.ok(state.beds[0].alarms.some((a) => a.rule === 'spo2_low'));
    assert.equal(state.beds[0].lamp.mode, 'red_blink');
    assert.ok(state.beds[0].lamp.ack_at);
    assert.equal(sim.clients[0].lampMode, 'red_blink');
  } finally {
    await sim.close();
    await platform.endAsync(true);
    await broker.close();
    await s.queue;
    await db.close();
  }
});
