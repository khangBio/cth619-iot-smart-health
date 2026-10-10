import mqtt from 'mqtt';
import { sample } from '../server/model.js';
import { devicePassword } from '../server/mqtt.js';
import { pathToFileURL } from 'node:url';

export function startSimulator(
  assignments,
  { url = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883', scenario = async () => 'normal' } = {}
) {
  const timers = [],
    clients = [],
    pending = new Set(),
    stats = { generated: 0, published: 0, errors: 0 };
  for (const initial of assignments) {
    let assignment = initial,
      sequence = 0,
      busy = false,
      lastIssued = '';
    const client = mqtt.connect(url, {
      username: initial.device_id,
      password: devicePassword(initial.device_id),
      clientId: `sim-${initial.device_id}-${process.pid}`,
      reconnectPeriod: 1500,
      will: {
        topic: `hospital/HP/devices/${initial.device_id}/status`,
        payload: '{"online":false}',
        qos: 1,
        retain: true,
      },
    });
    clients.push(client);
    client.on('connect', async () => {
      try {
        await client.subscribeAsync(
          [
            `hospital/HP/beds/${initial.bed_id}/lamp/cmd`,
            `hospital/HP/devices/${initial.device_id}/config`,
          ],
          { qos: 1 }
        );
        await client.publishAsync(
          `hospital/HP/devices/${initial.device_id}/status`,
          '{"online":true}',
          { qos: 1, retain: true }
        );
      } catch (e) {
        console.warn('Simulator connection:', e.message);
      }
    });
    client.on('error', (e) => console.warn('Simulator:', e.message));
    client.on('message', async (topic, data) => {
      try {
        const p = JSON.parse(data);
        if (topic.endsWith('/config')) {
          if (p.device_id === initial.device_id && p.bed_id === initial.bed_id) {
            if (assignment.id !== p.id) lastIssued = '';
            assignment = p;
          }
          return;
        }
        if (
          p.device_id !== assignment.device_id ||
          p.assignment_id !== assignment.id ||
          p.bed_id !== assignment.bed_id ||
          Date.parse(p.expires_at) <= Date.now() ||
          !['off', 'red', 'red_blink', 'yellow', 'blue'].includes(p.mode) ||
          p.issued_at < lastIssued
        )
          return;
        // Software actuator applies state before returning its acknowledgement.
        client.lampMode = p.mode;
        lastIssued = p.issued_at;
        await client.publishAsync(
          `hospital/HP/beds/${assignment.bed_id}/lamp/ack`,
          JSON.stringify({ ...p, status: 'applied' }),
          { qos: 1 }
        );
      } catch (e) {
        console.warn('Simulator command:', e.message);
      }
    });
    const send = async () => {
      if (busy || !client.connected) return;
      busy = true;
      try {
        const mode = await scenario(assignment.device_id);
        if (mode !== 'offline') {
          stats.generated++;
          await client.publishAsync(
            `hospital/HP/devices/${assignment.device_id}/telemetry`,
            JSON.stringify(sample(assignment, sequence++, mode)),
            { qos: 1 }
          );
          stats.published++;
        }
      } catch (e) {
        stats.errors++;
        console.warn('Simulator publish:', e.message);
      } finally {
        busy = false;
      }
    };
    timers.push(
      setInterval(() => {
        const task = send();
        pending.add(task);
        task.finally(() => pending.delete(task));
      }, 1000)
    );
  }
  return {
    clients,
    stats,
    close: async () => {
      timers.forEach(clearInterval);
      await Promise.all([...pending]);
      await Promise.all(clients.map((c) => c.endAsync(true)));
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const response = await fetch(
    `${process.env.API_URL || 'http://127.0.0.1:3000'}/api/device-assignments`,
    { headers: { Authorization: `Bearer ${process.env.INGEST_TOKEN || 'local-ingest-only'}` } }
  );
  if (!response.ok) throw new Error('Không lấy được cấu hình gán thiết bị');
  startSimulator(await response.json());
}
