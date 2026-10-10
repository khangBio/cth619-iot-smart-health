import { mkdirSync, writeFileSync } from 'node:fs';
import { devicePassword } from '../server/mqtt.js';
const dir = process.argv[2] || 'tmp/mosquitto';
mkdirSync(dir, { recursive: true });
let passwords = `platform:${process.env.MQTT_PASSWORD || 'local-demo-only'}\n`,
  acl = 'user platform\ntopic readwrite hospital/#\n';
for (let i = 1; i <= Number(process.env.DEVICE_COUNT || 6); i++) {
  const s = String(i).padStart(2, '0'),
    d = `dev-hp${s}`;
  passwords += `${d}:${devicePassword(d)}\n`;
  acl += `\nuser ${d}\ntopic write hospital/HP/devices/${d}/telemetry\ntopic write hospital/HP/devices/${d}/event\ntopic write hospital/HP/devices/${d}/status\ntopic read hospital/HP/devices/${d}/config\ntopic read hospital/HP/beds/HP-${s}/lamp/cmd\ntopic write hospital/HP/beds/HP-${s}/lamp/ack\n`;
}
writeFileSync(`${dir}/passwords.plain`, passwords, { mode: 0o600 });
writeFileSync(`${dir}/acl`, acl);
writeFileSync(
  `${dir}/mosquitto.conf`,
  'listener 1883\nallow_anonymous false\npassword_file /mosquitto/config/passwords\nacl_file /mosquitto/config/acl\nmax_packet_size 131072\nlog_dest stdout\n'
);
