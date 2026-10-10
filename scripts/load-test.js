import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { database } from '../server/db.js';
import { HealthService } from '../server/service.js';
import { embeddedBroker, connectPlatform } from '../server/mqtt.js';
import { startSimulator } from '../simulator/index.js';
const duration = Number(process.env.LOAD_SECONDS || 10);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const percentile = (values, q) =>
  values.length
    ? values.sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))]
    : null;
mkdirSync('tmp/load', { recursive: true });
mkdirSync('docs', { recursive: true });
const results = [];
for (const count of [6, 10, 20, 40]) {
  const file = `tmp/load/${Date.now()}-${count}.db`,
    db = await database({ file });
  const service = new HealthService(db);
  await service.seed(count);
  const broker = await embeddedBroker(0),
    url = `mqtt://127.0.0.1:${broker.port}`,
    platform = await connectPlatform(service, { url });
  const sim = startSimulator(await db.all('SELECT * FROM assignments'), { url });
  const cpu = process.cpuUsage(),
    start = performance.now();
  await delay(duration * 1000 + 250);
  await sim.close();
  await service.queue;
  const elapsed = performance.now() - start;
  const rows = await db.all('SELECT measured_at,received_at FROM messages');
  const latencies = rows.map((r) => Date.parse(r.received_at) - Date.parse(r.measured_at));
  const queryStart = performance.now();
  await service.history(
    'BN-001',
    new Date(Date.now() - 60000).toISOString(),
    new Date().toISOString()
  );
  const queryMs = performance.now() - queryStart;
  const used = process.cpuUsage(cpu);
  await platform.endAsync(true);
  await broker.close();
  await service.queue;
  await db.close();
  results.push({
    devices: count,
    targetSamples: count * Math.floor(duration),
    generated: sim.stats.generated,
    published: sim.stats.published,
    publishErrors: sim.stats.errors,
    received: rows.length,
    missing: sim.stats.generated - rows.length,
    elapsedSeconds: +(elapsed / 1000).toFixed(2),
    receivedPerSecond: +(rows.length / (elapsed / 1000)).toFixed(2),
    measurementToReceiveMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: Math.max(...latencies),
    },
    historyQueryMs: +queryMs.toFixed(2),
    cpuMs: +((used.user + used.system) / 1000).toFixed(2),
    processRssMB: +(process.memoryUsage().rss / 1024 / 1024).toFixed(1),
    sqliteBytes: statSync(file).size,
  });
  console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(
  'docs/load-results.json',
  JSON.stringify(
    {
      runAt: new Date().toISOString(),
      node: process.version,
      os: process.platform,
      durationSeconds: duration,
      scope:
        'Local smoke load: real MQTT, SQLite on disk, 1 sample/s/device. Not a clinical or capacity certification. Latency is measurement timestamp to ingestion start, not commit/UI latency. RSS includes prior runs in the same process.',
      results,
    },
    null,
    2
  ) + '\n'
);
