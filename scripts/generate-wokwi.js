import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { devicePassword } from '../server/mqtt.js';
const count = Number(process.env.DEVICE_COUNT || 6);
const mqttPort = Number(process.env.WOKWI_MQTT_PORT || process.env.DOCKER_MQTT_PORT || 1883);
if (!Number.isInteger(mqttPort) || mqttPort < 1 || mqttPort > 65535)
  throw new Error('Wokwi MQTT port must be an integer from 1 to 65535');
for (let i = 1; i <= count; i++) {
  const s = String(i).padStart(2, '0'),
    id = `dev-hp${s}`,
    dir = `firmware/${id}`;
  mkdirSync(dir, { recursive: true });
  for (const f of ['sketch.ino', 'libraries.txt', 'platformio.ini', 'wokwi.toml'])
    copyFileSync(`firmware/template/${f}`, `${dir}/${f}`);
  writeFileSync(
    `${dir}/config.h`,
    `#pragma once\n#define DEVICE_ID "${id}"\n#define BED_ID "HP-${s}"\n#define INITIAL_ASSIGNMENT "assign-${s}-v1"\n#define INITIAL_PATIENT "BN-${String(i).padStart(3, '0')}"\n#define INITIAL_ENCOUNTER "ENC-${s}"\n#define MQTT_HOST "host.wokwi.internal"\n#define MQTT_PORT ${mqttPort}\n#define MQTT_PASSWORD "${devicePassword(id)}"\n`
  );
  const diagram = {
    version: 1,
    author: 'CTH619 Smart Health',
    editor: 'wokwi',
    parts: [
      { type: 'wokwi-esp32-devkit-v1', id: 'esp', top: 0, left: 0, attrs: {} },
      { type: 'wokwi-ds18b20', id: 'temp', top: -10, left: 230, attrs: { temperature: '36.8' } },
      { type: 'wokwi-mpu6050', id: 'mpu', top: 140, left: 240, attrs: {} },
      { type: 'wokwi-rgb-led', id: 'lamp', top: -65, left: -110, attrs: { common: 'cathode' } },
      {
        type: 'wokwi-pushbutton',
        id: 'call',
        top: 185,
        left: -120,
        attrs: { color: 'blue', label: 'Gọi điều dưỡng', bounce: '0' },
      },
      { type: 'wokwi-potentiometer', id: 'scenario', top: 280, left: 230, attrs: { value: '0' } },
      ...['r', 'g', 'b'].map((c, i) => ({
        type: 'wokwi-resistor',
        id: `r${c}`,
        top: -5 + i * 35,
        left: -80,
        attrs: { value: '220' },
      })),
      { type: 'wokwi-resistor', id: 'pullup', top: 60, left: 170, attrs: { value: '4700' } },
    ],
    connections: [
      ['esp:TX0', '$serialMonitor:RX', '', []],
      ['esp:RX0', '$serialMonitor:TX', '', []],
      ['temp:VCC', 'esp:3V3', 'red', []],
      ['temp:GND', 'esp:GND.1', 'black', []],
      ['temp:DQ', 'esp:D4', 'green', []],
      ['pullup:1', 'esp:3V3', 'red', []],
      ['pullup:2', 'temp:DQ', 'green', []],
      ['mpu:VCC', 'esp:3V3', 'red', []],
      ['mpu:GND', 'esp:GND.1', 'black', []],
      ['mpu:SDA', 'esp:D21', 'green', []],
      ['mpu:SCL', 'esp:D22', 'blue', []],
      ['lamp:COM', 'esp:GND.1', 'black', []],
      ['lamp:R', 'rr:1', 'red', []],
      ['rr:2', 'esp:D25', 'red', []],
      ['lamp:G', 'rg:1', 'green', []],
      ['rg:2', 'esp:D26', 'green', []],
      ['lamp:B', 'rb:1', 'blue', []],
      ['rb:2', 'esp:D27', 'blue', []],
      ['call:1.l', 'esp:D13', 'blue', []],
      ['call:2.l', 'esp:GND.1', 'black', []],
      ['scenario:VCC', 'esp:3V3', 'red', []],
      ['scenario:GND', 'esp:GND.1', 'black', []],
      ['scenario:SIG', 'esp:D34', 'purple', []],
    ],
  };
  writeFileSync(`${dir}/diagram.json`, JSON.stringify(diagram, null, 2) + '\n');
}
console.log(
  `Generated ${count} separate ESP32 projects with DS18B20 + MPU6050 + RGB LED + call button.`
);
