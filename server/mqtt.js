import mqtt from 'mqtt';
import net from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Aedes } from 'aedes';
export async function withTimeout(promise, ms = 1500) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('MQTT publish timeout')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function devicePassword(deviceId, secret = process.env.MQTT_PASSWORD || 'local-demo-only') {
  return createHash('sha256').update(`${secret}:${deviceId}`).digest('hex').slice(0, 24);
}
const same = (a, b) => {
  const x = Buffer.from(a || ''),
    y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
};
export async function embeddedBroker(port = 1883, host = '127.0.0.1') {
  const broker = await Aedes.createBroker({ maxClientsIdLength: 100 });
  broker.authenticate = (client, username, password, done) => {
    const user = String(username || '');
    const allowed =
      user === 'platform'
        ? same(password?.toString(), process.env.MQTT_PASSWORD || 'local-demo-only')
        : /^dev-hp\d{2,3}$/.test(user) && same(password?.toString(), devicePassword(user));
    client.user = user;
    done(null, allowed);
  };
  const allowed = (client, topic, read) => {
    if (client.user === 'platform') return true;
    const bed = `HP-${client.user.slice(6)}`;
    return read
      ? [`hospital/HP/beds/${bed}/lamp/cmd`, `hospital/HP/devices/${client.user}/config`].includes(
          topic
        )
      : [
          `hospital/HP/devices/${client.user}/telemetry`,
          `hospital/HP/devices/${client.user}/event`,
          `hospital/HP/devices/${client.user}/status`,
          `hospital/HP/beds/${bed}/lamp/ack`,
        ].includes(topic);
  };
  broker.authorizePublish = (client, packet, done) =>
    done(allowed(client, packet.topic, false) ? null : new Error('Topic denied'));
  broker.authorizeSubscribe = (client, sub, done) =>
    done(null, allowed(client, sub.topic, true) ? sub : null);
  const server = net.createServer(broker.handle);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return {
    close: () => new Promise((resolve) => broker.close(() => server.close(resolve))),
    port: server.address().port,
  };
}
export async function connectPlatform(
  service,
  { url = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883', direct = true } = {}
) {
  const client = mqtt.connect(url, {
    username: process.env.MQTT_USERNAME || 'platform',
    password: process.env.MQTT_PASSWORD || 'local-demo-only',
    clientId: `health-platform-${process.pid}`,
    reconnectPeriod: 2000,
  });
  service.mqtt = client;
  service.publish = async (topic, p, { retain = false } = {}) => {
    if (!client.connected) throw new Error('MQTT offline');
    await withTimeout(client.publishAsync(topic, JSON.stringify(p), { qos: 1, retain }));
  };
  client.on('connect', () => {
    if (direct)
      client.subscribe(
        [
          'hospital/+/devices/+/telemetry',
          'hospital/+/devices/+/event',
          'hospital/+/devices/+/status',
          'hospital/+/beds/+/lamp/ack',
        ],
        { qos: 1 }
      );
  });
  client.on('message', async (topic, payload) => {
    try {
      if (payload.length > 131072) throw new Error('Payload vượt 128 KiB');
      const p = JSON.parse(payload.toString());
      if (topic.endsWith('/ack')) await service.ack(p, topic);
      else if (topic.endsWith('/status')) await service.deviceStatus(p, topic);
      else await service.ingest(p, topic);
    } catch (e) {
      console.warn(`Rejected MQTT ${topic}: ${e.message}`);
    }
  });
  client.on('error', (error) => console.warn('MQTT:', error.message));
  return client;
}
