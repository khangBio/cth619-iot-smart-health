export const metrics = {
  pulse_rate: {
    label: 'Mạch',
    unit: '/min',
    sensor: 'pulse-sim',
    type: 'PPG_SIMULATOR',
    source: 'simulated',
    min: 0,
    max: 300,
    loinc: '8867-4',
  },
  spo2: {
    label: 'SpO₂',
    unit: '%',
    sensor: 'spo2-sim',
    type: 'OXIMETER_SIMULATOR',
    source: 'simulated',
    min: 0,
    max: 100,
    loinc: '2708-6',
  },
  temperature: {
    label: 'Nhiệt độ',
    unit: 'Cel',
    sensor: 'ds18b20',
    type: 'DS18B20',
    source: 'wokwi',
    min: 0,
    max: 60,
    loinc: '8310-5',
  },
  respiratory_rate: {
    label: 'Nhịp thở',
    unit: '/min',
    sensor: 'resp-sim',
    type: 'RESPIRATION_SIMULATOR',
    source: 'simulated',
    min: 0,
    max: 100,
    loinc: '9279-1',
  },
  systolic: {
    label: 'HA tâm thu',
    unit: 'mm[Hg]',
    sensor: 'bp-sim',
    type: 'NIBP_SIMULATOR',
    source: 'simulated',
    min: 0,
    max: 300,
    loinc: '8480-6',
  },
  diastolic: {
    label: 'HA tâm trương',
    unit: 'mm[Hg]',
    sensor: 'bp-sim',
    type: 'NIBP_SIMULATOR',
    source: 'simulated',
    min: 0,
    max: 200,
    loinc: '8462-4',
  },
  weight: {
    label: 'Cân nặng',
    unit: 'kg',
    sensor: 'scale-sim',
    type: 'SCALE_SIMULATOR',
    source: 'simulated',
    min: 0,
    max: 400,
    loinc: '29463-7',
  },
  motion: {
    label: 'Gia tốc',
    unit: 'm/s2',
    sensor: 'mpu6050',
    type: 'MPU6050',
    source: 'wokwi',
    min: 0,
    max: 100,
  },
};
export const defaultRules = {
  version: 1,
  spo2Low: 92,
  pulseLow: 50,
  pulseHigh: 120,
  temperatureHigh: 38.5,
  sustainSeconds: 5,
  recoverySeconds: 5,
  offlineSeconds: 15,
  escalationSeconds: 60,
  maxLiveAgeSeconds: 15,
};
export const nurses = ['Điều dưỡng An', 'Điều dưỡng Bình', 'Điều dưỡng Chi'];
export const names = [
  'Nguyễn Văn Minh',
  'Trần Thị Mai',
  'Lê Hoàng Nam',
  'Phạm Ngọc Lan',
  'Võ Thanh Tùng',
  'Đặng Thu Hà',
  'Bùi Văn Sơn',
  'Đỗ Thị Hạnh',
];
export function sensors(id) {
  return Object.entries(metrics).map(([code, m]) => ({
    sensor_id: `${id}-${m.sensor}`,
    sensor_type: m.type,
    code,
    unit: m.unit,
  }));
}
export function sample(
  assignment,
  sequence,
  scenario = 'normal',
  measuredAt = new Date().toISOString()
) {
  const n = Number(assignment.device_id.slice(-2)) || 1;
  const wave = Math.sin(sequence / 7 + n);
  const v = {
    pulse_rate: Math.round(75 + n + 5 * wave),
    spo2: +(97 + wave).toFixed(1),
    temperature: +(36.7 + 0.2 * wave).toFixed(1),
    respiratory_rate: Math.round(18 + wave * 2),
    systolic: Math.round(118 + wave * 5),
    diastolic: Math.round(76 + wave * 3),
    weight: 52 + n * 2,
    motion: +(9.81 + wave * 0.1).toFixed(2),
  };
  if (scenario === 'hypoxia') {
    v.spo2 = +(87 + wave).toFixed(1);
    v.pulse_rate = Math.round(128 + wave * 4);
  }
  if (scenario === 'fever') {
    v.temperature = +(39 + wave * 0.2).toFixed(1);
    v.pulse_rate = Math.round(110 + wave * 3);
  }
  if (scenario === 'motion') v.motion = 25;
  return {
    schema_version: 1,
    message_id: `${assignment.device_id}-${assignment.id}-${measuredAt}-${sequence}`,
    device_id: assignment.device_id,
    device_type: 'ESP32_BEDSIDE_MONITOR',
    assignment_id: assignment.id,
    patient_id: assignment.patient_id,
    encounter_id: assignment.encounter_id,
    ward_id: 'HP',
    bed_id: assignment.bed_id,
    measured_at: measuredAt,
    sequence,
    sampling_interval_ms: 1000,
    readings: Object.entries(metrics).map(([code, m]) => ({
      sensor_id: `${assignment.device_id}-${m.sensor}`,
      sensor_type: m.type,
      code,
      value: v[code],
      unit: m.unit,
      quality: scenario === 'motion' && ['pulse_rate', 'spo2'].includes(code) ? 'suspect' : 'valid',
      source: 'simulated',
    })),
  };
}
