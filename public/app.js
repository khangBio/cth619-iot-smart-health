const $ = (s) => document.querySelector(s);
const app = $('#app'),
  dialog = $('#dialog');
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const fmt = (v, seconds = false) =>
  v
    ? new Date(v).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        ...(seconds ? { second: '2-digit' } : {}),
      })
    : '—';
const date = (v) => new Date(v).toLocaleDateString('vi-VN');
const stateNames = {
  assigned: 'Chờ tiếp nhận',
  accepted: 'Đã tiếp nhận',
  at_bed: 'Đã đến giường',
  in_progress: 'Đang xử lý',
  completed: 'Hoàn tất',
};
const ruleNames = {
  spo2_low: 'SpO₂ dưới ngưỡng',
  pulse_abnormal: 'Mạch ngoài ngưỡng',
  temperature_high: 'Nhiệt độ cao',
  nurse_call: 'Gọi điều dưỡng',
  offline: 'Mất dữ liệu',
};
const modeNames = {
  off: 'Tắt',
  red: 'Đỏ · đã nhận',
  red_blink: 'Đỏ nhấp nháy',
  blue: 'Xanh · gọi hỗ trợ',
  yellow: 'Vàng · kỹ thuật',
};
let user,
  data,
  page = 'overview',
  selected = 'BN-001',
  filter = 'all',
  patientTab = 'charts',
  history = [],
  hours = 1,
  search = '',
  loading = false,
  refreshPending = false;
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').style.display = 'block';
  setTimeout(() => ($('#toast').style.display = 'none'), 4000);
}
async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  const p = await r.json();
  if (!r.ok) {
    if (r.status === 401 && path != '/login') {
      user = null;
      login();
    }
    throw new Error(p.error || 'Không thể kết nối');
  }
  return p;
}
function pill(text, color = '') {
  return `<span class="pill ${color}">${esc(text)}</span>`;
}
function latest(b, code) {
  const r = b.latest?.readings.find((r) => r.code === code);
  return r && r.quality === 'valid' && b.online ? r.value : '—';
}
function measure(b, code) {
  return b.latest?.readings.find((r) => r.code === code);
}
function badge(b) {
  return !b.online
    ? pill('Mất dữ liệu', 'yellow')
    : b.alarms.some((a) => a.severity === 'critical')
      ? pill('Cảnh báo cao', 'red')
      : b.alarms.length
        ? pill('Cần chú ý', 'yellow')
        : b.quality && b.quality !== 'valid'
          ? pill('Chất lượng chưa đạt', 'yellow')
          : pill('Trong ngưỡng demo', 'green');
}
function login() {
  app.innerHTML = `<div class="login-page"><div class="login-art"><div class="brand"><span class="brandmark">✚</span><div>VitalCare<small>CONNECTED HEALTH</small></div></div><div class="eyebrow">IOT SMART HEALTH · CTH619</div><h1>Kết nối dữ liệu.<br>Chăm sóc kịp thời.</h1><p>Theo dõi chỉ số sinh tồn, cảnh báo tại giường và phối hợp chăm sóc trên một nền tảng.</p><div class="footerbrand">ESP32 / MQTT / NODE-RED / POSTGRESQL</div></div><div class="login-main"><div class="login-box"><div class="eyebrow">TRẠM TRỰC ĐIỀU DƯỠNG</div><h2>Chào mừng trở lại</h2><p class="subtitle">Đăng nhập để theo dõi khoa Hậu phẫu.</p><form id="login-form"><label class="field">Tài khoản<input name="username" value="nurse" autocomplete="username" required></label><label class="field">Mật khẩu<input name="password" type="password" autocomplete="current-password" required></label><div id="login-error" class="error"></div><button class="primary">Đăng nhập →</button></form><div class="info">Bản thử nghiệm với bệnh nhân giả lập.<br>Điều dưỡng: <b>nurse / nurse-demo</b><br>Quản trị: <b>admin / admin-demo</b><br>Ngưỡng chỉ phục vụ kiểm thử, không dùng quyết định lâm sàng.</div></div></div></div>`;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      user = await api('/login', 'POST', Object.fromEntries(new FormData(e.target)));
      await refresh(true);
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  };
}
const navs = [
  ['overview', '▦', 'Tổng quan khoa'],
  ['patient', '♡', 'Theo dõi bệnh nhân'],
  ['workflow', '☷', 'Điều phối chăm sóc'],
  ['devices', '⌁', 'Thiết bị IoT'],
  ['emr', '⇄', 'Đồng bộ HIS / EMR'],
  ['settings', '⚙', 'Cấu hình hệ thống'],
];
function render() {
  if (!data || !user) return;
  const active = navs.find((n) => n[0] === page);
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><span class="brandmark">✚</span><div>VitalCare<small>CONNECTED HEALTH</small></div></div><div class="navlabel">KHÔNG GIAN LÀM VIỆC</div><nav class="nav">${navs
    .filter((n) => n[0] !== 'settings' || user.role === 'admin')
    .map(
      ([id, icon, label]) =>
        `<button data-nav="${id}" class="${page === id ? 'active' : ''}"><span>${icon}</span>${label}</button>`
    )
    .join(
      ''
    )}</nav><div class="sidebar-bottom"><span class="dot ${data.mqtt ? '' : 'off'}"></span><b>${data.mqtt ? 'MQTT đã kết nối' : 'MQTT mất kết nối'}</b><br>${esc(data.database)} · ${data.beds.length} thiết bị<br><span style="color:#8c9eac">IIAF · IoT Information System</span></div></aside><div class="workspace"><header class="topbar"><div class="crumb">Bệnh viện mô phỏng <span style="margin:0 12px">/</span> Khoa Hậu phẫu <span style="margin:0 12px">/</span> <b>${active[2]}</b></div><div class="account"><span class="pill green">● Trực tuyến</span><div class="avatar">${user.role === 'admin' ? 'QT' : 'AN'}</div><div>${esc(user.name)}<small>Ca trực · Khoa Hậu phẫu</small></div><button data-action="logout" title="Đăng xuất">↪</button></div></header><main>${{ overview: overview, patient: patient, workflow: workflow, devices: devices, emr: emr, settings: settings }[page]()}<footer class="bottom-note"><span>CTH619 · Nguyên mẫu IoT y tế · Dữ liệu giả lập, không dùng cho chăm sóc thực tế</span><span>Cập nhật ${fmt(data.at, true)} · ${date(data.at)}</span></footer></main></div></div>`;
}
function head(title, subtitle, actions = '') {
  return `<div class="page-head"><div><div class="eyebrow">KHOA HẬU PHẪU / SMART HEALTH</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${actions}</div></div>`;
}
function overview() {
  const beds = data.beds.filter(
    (b) =>
      (filter === 'all' ||
        (filter === 'alert' && b.alarms.length) ||
        (filter === 'offline' && !b.online)) &&
      (!search ||
        `${b.name} ${b.patient_id} ${b.bed_id}`.toLowerCase().includes(search.toLowerCase()))
  );
  const open = data.requests.filter((r) => r.state !== 'completed');
  return (
    head(
      'Tổng quan khoa',
      'Theo dõi liên tục, kết nối mọi giường bệnh.',
      `<span class="pill">${date(data.at)}</span><button data-action="refresh">↻ Làm mới</button>`
    ) +
    `<div class="summary">${[
      [
        data.beds.length,
        'Giường đang theo dõi',
        `${data.beds.filter((b) => b.online).length} thiết bị đang gửi dữ liệu`,
        '▦',
      ],
      [
        data.beds.filter((b) => b.alarms.length).length,
        'Giường cần chú ý',
        'Cảnh báo sinh tồn & kỹ thuật',
        '♧',
      ],
      [
        open.filter((r) => r.state === 'assigned').length,
        'Chờ tiếp nhận',
        `${open.filter((r) => r.escalated).length} yêu cầu đã chuyển cấp`,
        '◷',
      ],
      [
        open.filter((r) => r.state !== 'assigned').length,
        'Đang chăm sóc',
        'Đã tiếp nhận / đang xử lý',
        '♡',
      ],
    ]
      .map(
        ([n, l, s, i]) =>
          `<div class="stat"><div><div class="stat-label">${l}</div><div class="stat-number">${n.toString().padStart(2, '0')}</div><div class="stat-note">${s}</div></div><div class="stat-icon">${i}</div></div>`
      )
      .join(
        ''
      )}</div><div class="sectionbar"><h2>Giường bệnh <small>${beds.length} / ${data.beds.length} giường</small></h2><div class="filters">${[
      ['all', 'Tất cả'],
      ['alert', 'Có cảnh báo'],
      ['offline', 'Mất dữ liệu'],
    ]
      .map(
        ([v, l]) =>
          `<button data-filter="${v}" class="${filter === v ? 'active' : ''}">${l}</button>`
      )
      .join(
        ''
      )}</div><input type="search" id="search" placeholder="Tìm tên, mã bệnh nhân, giường…" value="${esc(search)}" aria-label="Tìm bệnh nhân"></div><div class="bed-grid">${beds.map((b) => `<article class="bed-card ${b.alarms.length ? 'alarm' : ''}" data-patient="${b.patient_id}" tabindex="0" role="button" aria-label="Theo dõi ${esc(b.name)}"><div class="card-top"><div class="bed-num">▦ ${b.bed_id}<small>Phòng ${b.room}</small></div>${badge(b)}</div><div class="patient"><div class="patient-icon">♙</div><div><div class="patient-name">${esc(b.name)}</div><div class="patient-meta">${b.patient_id} · ${new Date().getFullYear() - b.birth_year} tuổi · ${b.sex}</div></div></div><div class="vitals">${vital(b, 'Mạch', 'pulse_rate', 'bpm', 'teal')}${vital(b, 'SpO₂', 'spo2', '%', 'blue')}${vital(b, 'Nhiệt độ', 'temperature', '°C')}${vital(b, 'Huyết áp', 'systolic', 'mmHg', 'bp', `${latest(b, 'systolic')}/${latest(b, 'diastolic')}`)}${vital(b, 'Nhịp thở', 'respiratory_rate', 'l/ph')}${vital(b, 'Cân nặng', 'weight', 'kg')}</div><div class="card-status ${b.alarms.length ? 'alert' : ''}"><span>${b.alarms.length ? '● ' + esc(ruleNames[b.alarms[0].rule]) : b.online ? (b.quality === 'valid' ? '✓ Chưa có cảnh báo' : '○ Cần kiểm tra chất lượng tín hiệu') : '○ Chưa có mẫu mới'}</span><span>${b.requests.length ? `${b.requests.length} yêu cầu mở` : '—'}</span></div><div class="card-foot"><span>♙ ${esc(b.nurse)}</span><span>${b.online ? '●' : '○'} ${fmt(b.latest_at, true)}</span></div></article>`).join('') || '<div class="empty">Không tìm thấy giường phù hợp.</div>'}</div><div class="sectionbar"><h2>Yêu cầu gần đây</h2><button data-nav="workflow">Xem tất cả →</button></div><div class="panel">${requestTable(open.slice(0, 4))}</div>`
  );
}
function vital(b, label, code, unit, color = '', override) {
  const r = measure(b, code);
  const abnormal =
    (code === 'spo2' && r?.value < data.rules.spo2Low) ||
    (code === 'pulse_rate' &&
      (r?.value < data.rules.pulseLow || r?.value > data.rules.pulseHigh)) ||
    (code === 'temperature' && r?.value > data.rules.temperatureHigh);
  return `<div><div class="vital-label">${label}${r && r.quality !== 'valid' ? ' · nhiễu' : ''}</div><div class="vital-value ${abnormal && b.online ? 'red' : color}">${override ?? latest(b, code)}<small>${unit}</small></div></div>`;
}
function chart(rows, series, min, max, { height = 235, dual = false } = {}) {
  const width = 780,
    left = 43,
    right = dual ? 45 : 20,
    top = 18,
    bottom = 32;
  const x0 = Date.parse(rows[0]?.measured_at || Date.now()),
    x1 = Date.parse(rows.at(-1)?.measured_at || Date.now()) + 1;
  const x = (t) => left + ((Date.parse(t) - x0) / (x1 - x0)) * (width - left - right),
    y = (v) => top + ((max - v) / (max - min)) * (height - top - bottom);
  let out = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Biểu đồ ${series.map((s) => s.label).join(', ')} theo thời gian">`;
  for (let i = 0; i <= 5; i++) {
    const v = min + ((max - min) * i) / 5;
    out += `<line x1="${left}" y1="${y(v)}" x2="${width - right}" y2="${y(v)}" stroke="#e8eef2" stroke-dasharray="3 4"/><text x="${left - 9}" y="${y(v) + 4}" text-anchor="end">${+v.toFixed(1)}</text>${dual ? `<text x="${width - right + 9}" y="${y(v) + 4}">${(v / 20 + 33).toFixed(1)}°</text>` : ''}`;
  }
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const p = rows[Math.round((i * (rows.length - 1)) / Math.max(1, Math.min(rows.length, 6) - 1))];
    out += `<text x="${x(p.measured_at)}" y="${height - 7}" text-anchor="middle">${fmt(p.measured_at, true)}</text>`;
  }
  for (const s of series) {
    let segment = [];
    const flush = () => {
      if (segment.length) {
        out += `<polyline points="${segment.map((a) => a.join(',')).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round"/>`;
        if (segment.length === 1)
          out += `<circle cx="${segment[0][0]}" cy="${segment[0][1]}" r="3" fill="${s.color}"/>`;
        segment = [];
      }
    };
    let prev;
    for (const row of rows) {
      const r = row.readings.find((r) => r.code === s.code);
      if (prev && Date.parse(row.measured_at) - prev > data.rules.offlineSeconds * 1000) flush();
      if (r && r.quality === 'valid') {
        const v = s.transform ? s.transform(r.value) : r.value;
        segment.push([x(row.measured_at), Math.max(top, Math.min(height - bottom, y(v)))]);
      } else flush();
      prev = Date.parse(row.measured_at);
    }
    flush();
  }
  if (!rows.length)
    out += `<text x="390" y="110" text-anchor="middle">Chưa có dữ liệu trong khoảng đã chọn</text>`;
  return out + '</svg>';
}
function patient() {
  const b = data.beds.find((b) => b.patient_id === selected) || data.beds[0];
  selected = b.patient_id;
  return (
    head(
      'Theo dõi bệnh nhân',
      'Dữ liệu đo, diễn biến sinh tồn và lịch sử chăm sóc.',
      `<select id="patient-select" aria-label="Chọn bệnh nhân">${data.beds.map((x) => `<option value="${x.patient_id}" ${x.patient_id === selected ? 'selected' : ''}>${x.bed_id} · ${esc(x.name)}</option>`).join('')}</select><select id="history-range" aria-label="Khoảng lịch sử">${[
        [1, '1 giờ qua'],
        [6, '6 giờ qua'],
        [24, '24 giờ qua'],
      ]
        .map(([v, l]) => `<option value="${v}" ${hours === v ? 'selected' : ''}>${l}</option>`)
        .join('')}</select>`
    ) +
    `<div class="patient-banner"><div class="avatar">${esc(b.name.split(' ').at(-1)[0])}</div><div style="flex:1"><h2>${esc(b.name)}</h2><div class="meta"><span>${b.patient_id} · ${b.encounter_id}</span><span>${new Date().getFullYear() - b.birth_year} tuổi · ${b.sex}</span><span>${b.bed_id} / ${b.room}</span><span>${esc(b.nurse)}</span></div><p class="subtitle" style="margin-top:10px">${esc(b.diagnosis)}</p></div>${badge(b)}</div><div class="detail-vitals">${[
      ['Mạch', 'pulse_rate', 'bpm', 'teal'],
      ['SpO₂', 'spo2', '%', 'blue'],
      ['Nhiệt độ', 'temperature', '°C'],
      ['Huyết áp', 'systolic', 'mmHg', 'bp', `${latest(b, 'systolic')}/${latest(b, 'diastolic')}`],
      ['Nhịp thở', 'respiratory_rate', 'l/ph'],
      ['Cân nặng', 'weight', 'kg'],
    ]
      .map((v) => `<div class="stat">${vital(b, ...v)}</div>`)
      .join('')}</div><div class="section-tabs">${[
      ['charts', 'Diễn biến sinh tồn'],
      ['sheet', 'Phiếu chức năng sống'],
      ['care', 'Cảnh báo & chăm sóc'],
      ['payload', 'Payload & cảm biến'],
    ]
      .map(
        ([id, l]) =>
          `<button data-tab="${id}" class="${patientTab === id ? 'active' : ''}">${l}</button>`
      )
      .join(
        ''
      )}</div>${patientTab === 'charts' ? charts(b) : patientTab === 'sheet' ? sheet(b) : patientTab === 'care' ? `<div class="panel">${requestTable(data.requests.filter((r) => r.patient_id === b.patient_id))}</div><div class="panel"><div class="panel-head"><h2>Ghi nhận chăm sóc đã hoàn tất</h2><button data-action="care-records">Xem ghi nhận</button></div></div>` : `<div class="panel"><div class="panel-head"><h2>Định danh & nguồn đo</h2><button data-action="payload">Xem JSON mới nhất</button></div><div class="panel-body"><div class="info">${esc(b.device_id)} · ESP32_BEDSIDE_MONITOR<br>Lần gán: ${esc(b.id)}<br>DS18B20: nhiệt độ; MPU6050: gia tốc. Mạch, SpO₂, nhịp thở, huyết áp, cân nặng là dữ liệu giả lập. Chế độ demo phần mềm giả lập cả hai cảm biến.</div><div class="table-scroll"><table><thead><tr><th>Cảm biến</th><th>Loại</th><th>Chỉ số</th><th>Chất lượng / nguồn</th></tr></thead><tbody>${b.sensors.map((s) => `<tr><td class="mono">${s.sensor_id}</td><td>${s.sensor_type}</td><td>${s.code} (${s.unit})</td><td>${esc(measure(b, s.code)?.quality || '—')} / ${esc(measure(b, s.code)?.source || '—')}</td></tr>`).join('')}</tbody></table></div></div></div>`}${data.demo ? demoControls(b) : ''}`
  );
}
function charts(b) {
  return `<div class="two-col"><div class="panel"><div class="panel-head"><h2>Nhịp tim / mạch</h2>${pill('bpm · theo mẫu đo', 'green')}</div><div class="panel-body">${chart(history, [{ code: 'pulse_rate', label: 'Mạch', color: '#0b9d86' }], 30, 160)}<p class="subtitle">Xu hướng mạch từ các mẫu đo; không phải sóng ECG.</p></div></div><div class="panel"><div class="panel-head"><h2>Độ bão hòa oxy</h2>${pill('SpO₂ · %', 'blue')}</div><div class="panel-body">${chart(history, [{ code: 'spo2', label: 'SpO₂', color: '#437fe0' }], 70, 100)}<p class="subtitle">Mẫu không hợp lệ và khoảng mất dữ liệu được ngắt đường.</p></div></div></div><div class="two-col"><div class="panel"><div class="panel-head"><h2>Mạch & nhiệt độ</h2><div class="legend"><span><i style="background:#447ee0"></i>Mạch</span><span><i style="background:#e06369"></i>Nhiệt độ</span></div></div><div class="panel-body">${chart(
    history,
    [
      { code: 'pulse_rate', label: 'Mạch', color: '#447ee0' },
      { code: 'temperature', label: 'Nhiệt độ', color: '#e06369', transform: (v) => (v - 33) * 20 },
    ],
    40,
    160,
    { dual: true }
  )}</div></div><div class="panel"><div class="panel-head"><h2>Nhịp thở</h2>${pill('lần/phút')}</div><div class="panel-body">${chart(history, [{ code: 'respiratory_rate', label: 'Nhịp thở', color: '#aa82d1' }], 0, 40)}</div></div></div><div class="actions no-print"><a class="link" href="/api/export/${b.patient_id}">↓ Xuất CSV · 24 giờ (tối đa 2.000 mẫu)</a><button data-action="emr-confirm" class="primary">Xác nhận mẫu mới nhất → EMR</button></div>`;
}
function sheet(b) {
  const rows = history.slice(-12),
    count = Math.max(1, rows.length),
    width = count * 65,
    height = 280;
  const read = (p, code) => {
    const r = p.readings.find((r) => r.code === code);
    return r?.quality === 'valid' ? r.value : '—';
  };
  const y = (v) => 20 + ((160 - v) / 120) * 240;
  let grid = '',
    axis =
      '<text x="27" y="12" text-anchor="middle">Mạch</text><text x="80" y="12" text-anchor="middle">°C</text>',
    lines = '';
  for (let v = 40; v <= 160; v += 2) {
    grid += `<line x1="0" x2="${width}" y1="${y(v)}" y2="${y(v)}" stroke="${v % 20 === 0 ? '#aabac8' : '#e1e7ed'}"/>`;
    if (v % 20 === 0)
      axis += `<text x="27" y="${y(v) + 4}" text-anchor="middle">${v}</text><text x="80" y="${y(v) + 4}" text-anchor="middle">${v / 20 + 33}</text>`;
  }
  for (let i = 1; i < count; i++)
    grid += `<line x1="${i * 65}" x2="${i * 65}" y1="0" y2="280" stroke="#aabac8"/>`;
  for (const [code, color, transform] of [
    ['pulse_rate', '#3d6ce1', (v) => v],
    ['temperature', '#df5e60', (v) => (v - 33) * 20],
  ]) {
    let previous = null;
    rows.forEach((p, i) => {
      const value = read(p, code);
      if (value === '—') {
        previous = null;
        return;
      }
      const point = {
        x: (i + 0.5) * 65,
        y: Math.max(20, Math.min(260, y(transform(value)))),
        time: Date.parse(p.measured_at),
      };
      if (previous && point.time - previous.time <= data.rules.offlineSeconds * 1000)
        lines += `<line x1="${previous.x}" y1="${previous.y}" x2="${point.x}" y2="${point.y}" stroke="${color}" stroke-width="2"/>`;
      lines += `<circle cx="${point.x}" cy="${point.y}" r="2.6" fill="${color}"/>`;
      previous = point;
    });
  }
  return `<div class="panel"><div class="panel-head"><h2>Phiếu theo dõi chức năng sống</h2><button data-action="print">⎙ In phiếu</button></div><div class="table-scroll"><div class="sheet"><h2>Phiếu theo dõi chức năng sống</h2><div class="sheet-info"><span>Họ tên: <b>${esc(b.name)}</b> · ${b.patient_id}</span><span>Tuổi: ${new Date().getFullYear() - b.birth_year} · Giới: ${b.sex}</span><span>Giường: ${b.bed_id} · ${b.encounter_id}</span></div><div class="sheet-info">Chẩn đoán: ${esc(b.diagnosis)}</div><table><colgroup><col style="width:110px">${Array.from({ length: count }, () => '<col>').join('')}</colgroup><tr><th>Ngày / giờ đo</th>${rows.map((p) => `<td>${date(p.measured_at)}<br>${fmt(p.measured_at, true)}<br>${p.bed_id}</td>`).join('') || '<td>Chưa có dữ liệu</td>'}</tr><tr><td style="padding:0"><svg class="chart" viewBox="0 0 110 280" preserveAspectRatio="none" style="height:280px">${axis}</svg></td><td colspan="${count}" style="padding:0"><svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="height:280px" role="img" aria-label="Đồ thị mạch và nhiệt độ khớp cột thời gian trên phiếu">${grid}${lines}</svg></td></tr>${[
    ['Mạch (lần/phút)', 'pulse_rate'],
    ['Nhiệt độ (°C)', 'temperature'],
    ['Huyết áp (mmHg)', 'bp'],
    ['Cân nặng (kg)', 'weight'],
    ['Nhịp thở (lần/phút)', 'respiratory_rate'],
    ['SpO₂ (%)', 'spo2'],
  ]
    .map(
      ([label, key]) =>
        `<tr><th>${label}</th>${rows.map((p) => `<td>${key === 'bp' ? read(p, 'systolic') + ' / ' + read(p, 'diastolic') : read(p, key)}</td>`).join('') || '<td>—</td>'}</tr>`
    )
    .join(
      ''
    )}</table><p class="subtitle" style="margin-top:12px">● Mạch: xanh · ● Nhiệt độ: đỏ · Mỗi cột là một thời điểm đo.<br>Tối đa 12 mẫu cuối của lịch sử đã lấy; không điền giá trị thiếu. Chưa phải hồ sơ đã ký xác nhận. Điểm ngoài thang đồ thị được chặn ở biên; bảng giữ nguyên giá trị.</p></div></div></div>`;
}
function requestTable(rows) {
  return rows.length
    ? `<div class="table-scroll"><table><thead><tr><th>Giường / bệnh nhân</th><th>Yêu cầu</th><th>Người phụ trách</th><th>Trạng thái</th><th>Phát sinh</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td><b>${r.current_bed_id || r.bed_id}</b><small>${r.patient_id}${r.current_bed_id && r.current_bed_id !== r.bed_id ? ` · Phát sinh tại ${r.bed_id}` : ''}</small></td><td>${esc(ruleNames[r.rule])}<small>${r.active ? 'Điều kiện đang tồn tại' : 'Điều kiện đã kết thúc'}${r.escalated ? ' · QUÁ HẠN / CHUYỂN CẤP' : ''}</small></td><td>${esc(r.assignee)}</td><td>${pill(stateNames[r.state], r.state === 'completed' ? 'green' : r.state === 'assigned' ? 'yellow' : 'blue')}</td><td>${fmt(r.created_at, true)}<small>${date(r.created_at)}</small></td><td><button data-request="${r.id}">${r.state === 'completed' ? 'Lịch sử' : 'Xử lý →'}</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">✓ Chưa có yêu cầu cần xử lý.<br>Yêu cầu từ rule hoặc nút gọi sẽ xuất hiện tại đây.</div>';
}
function workflow() {
  return (
    head('Điều phối chăm sóc', 'Tiếp nhận → Đến giường → Đang xử lý → Hoàn tất.') +
    `<div class="info">Cảnh báo và công việc được lưu độc lập. Ghi nhận chăm sóc cần người thực hiện và nội dung xử lý; hệ thống không tự hoàn tất khi chỉ số hồi phục.</div><div class="panel">${requestTable(data.requests.filter((r) => r.state !== 'completed'))}</div><div class="sectionbar"><h2>Đã hoàn tất</h2></div><div class="panel">${requestTable(data.requests.filter((r) => r.state === 'completed'))}</div>`
  );
}
function demoControls(b) {
  return `<div class="panel no-print"><div class="panel-head"><h2>Bàn thử nghiệm · ${b.device_id}</h2>${pill('SIMULATOR', 'blue')}</div><div class="panel-body"><div class="actions">${[
    ['normal', 'Bình thường'],
    ['hypoxia', 'SpO₂ thấp'],
    ['fever', 'Sốt'],
    ['motion', 'Nhiễu chuyển động'],
    ['offline', 'Mất dữ liệu'],
  ]
    .map(
      ([s, l]) =>
        `<button data-scenario="${s}" data-device="${b.device_id}" class="${b.scenario === s ? 'primary' : ''}">${l}</button>`
    )
    .join(
      ''
    )}<button data-call="${b.device_id}">♧ Gọi điều dưỡng</button></div><p class="subtitle" style="margin-top:12px">Luồng thử: MQTT → kiểm tra định danh → lưu → rule → lệnh đèn → ACK. Thời gian duy trì rule: ${data.rules.sustainSeconds}s; phục hồi: ${data.rules.recoverySeconds}s.</p></div></div>`;
}
function devices() {
  return (
    head(
      'Thiết bị & đèn tại giường',
      `${data.beds.length} thiết bị logic · 2 loại sensor Wokwi / ESP32 · RGB LED actuator.`
    ) +
    `<div class="info">${data.demo ? 'Đang chạy bộ giả lập MQTT bằng phần mềm. Bộ mã Wokwi có sẵn để chạy từng ESP32; không chạy trùng simulator và Wokwi cho cùng device_id.' : 'Chế độ tích hợp Wokwi / MQTT. Thao tác trên sensor trong Wokwi để đổi dữ liệu.'}</div><div class="panel"><div class="table-scroll"><table><thead><tr><th>Thiết bị / bệnh nhân</th><th>Cảm biến</th><th>Kết nối dữ liệu</th><th>Đèn yêu cầu</th><th>Xác nhận thực thi</th><th></th></tr></thead><tbody>${data.beds.map((b) => `<tr><td><b>${b.device_id}</b><small>${b.bed_id} · ${b.patient_id}</small></td><td>DS18B20 + MPU6050<small>6 kênh chỉ số giả lập</small></td><td>${pill(b.online ? 'Có dữ liệu mới' : 'Mất dữ liệu', b.online ? 'green' : 'yellow')}<small>${fmt(b.latest_at, true)}</small></td><td>${esc(modeNames[b.lamp?.mode] || '—')}</td><td>${b.lamp?.ack_at ? pill('ACK · ' + fmt(b.lamp.ack_at, true), 'green') : pill('Chưa xác nhận', 'yellow')}<small>${b.lamp ? b.lamp.attempts + ' lần gửi' : ''}</small></td><td><button data-patient="${b.patient_id}">Chi tiết →</button></td></tr>`).join('')}</tbody></table></div></div>${data.demo ? data.beds.map(demoControls).join('') : ''}`
  );
}
function emr() {
  return (
    head(
      'Đồng bộ HIS / EMR',
      'Kết quả đã xác nhận được gửi qua hàng đợi bền vững.',
      `<button data-action="emr-records">Xem bản ghi sandbox →</button>`
    ) +
    `<div class="info">Chọn bệnh nhân → kiểm tra mẫu và chất lượng → xác nhận gửi. Giữ thời gian đo, nguồn, bệnh nhân và lượt điều trị. Tự thử lại khi EMR lỗi; gửi lại cùng ID để chống trùng.</div><div class="panel"><div class="table-scroll"><table><thead><tr><th>Bản ghi</th><th>Bệnh nhân</th><th>Trạng thái</th><th>Số lần gửi</th><th>Phản hồi</th></tr></thead><tbody>${data.outbox.map((r) => `<tr><td class="mono">${esc(r.id)}</td><td>${r.patient_id}</td><td>${pill(r.state === 'sent' ? 'Đã tiếp nhận' : 'Chờ gửi / thử lại', r.state === 'sent' ? 'green' : 'yellow')}</td><td>${r.attempts}</td><td>${r.sent_at ? fmt(r.sent_at, true) : esc(r.last_error || '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Chưa có kết quả được xác nhận gửi.</td></tr>'}</tbody></table></div></div>`
  );
}
function settings() {
  const fields = {
    spo2Low: 'SpO₂ thấp (%)',
    pulseLow: 'Mạch thấp (bpm)',
    pulseHigh: 'Mạch cao (bpm)',
    temperatureHigh: 'Nhiệt độ cao (°C)',
    sustainSeconds: 'Duy trì bất thường (giây)',
    recoverySeconds: 'Duy trì phục hồi (giây)',
    offlineSeconds: 'Mất dữ liệu sau (giây)',
    escalationSeconds: 'Chuyển cấp sau (giây)',
    maxLiveAgeSeconds: 'Tuổi mẫu trực tiếp tối đa (giây)',
  };
  return (
    head('Cấu hình hệ thống', 'Tham số demo có phiên bản và nhật ký thay đổi.') +
    `<div class="info warning">Các ngưỡng dưới đây là tham số kiểm thử của học phần, chưa được thẩm định lâm sàng.</div><div class="panel"><div class="panel-head"><h2>Bộ quy tắc · phiên bản ${data.rules.version}</h2></div><form id="rules-form" class="panel-body"><div class="form-grid">${Object.entries(
      fields
    )
      .map(
        ([k, l]) =>
          `<label class="field">${l}<input name="${k}" type="number" step="0.1" value="${data.rules[k]}" required></label>`
      )
      .join(
        ''
      )}</div><button class="primary" style="margin-top:20px">Lưu phiên bản mới</button></form></div><div class="panel"><div class="panel-head"><h2>Chuyển giường · hoán đổi hai bệnh nhân</h2></div><form class="panel-body" id="swap-form"><div class="form-grid"><label class="field">Bệnh nhân tại thiết bị<select name="device_id">${data.beds.map((b) => `<option value="${b.device_id}">${b.bed_id} · ${esc(b.name)}</option>`).join('')}</select></label><label class="field">Đổi sang giường<select name="target_bed">${data.beds.map((b, i) => `<option value="${b.bed_id}" ${i === 1 ? 'selected' : ''}>${b.bed_id} · ${esc(b.name)}</option>`).join('')}</select></label></div><p class="subtitle" style="margin:15px 0">ESP32 và đèn ở lại giường. Đóng lần gán cũ, tạo lần gán mới; mẫu đến trễ giữ đúng người bệnh tại thời điểm đo. Công việc cũ giữ lịch sử giường phát sinh.</p><button class="primary">Cập nhật phân giường</button></form></div><button data-action="audit">Xem nhật ký thao tác</button>`
  );
}
async function refresh(force = false) {
  if (!user) return;
  if (loading) {
    if (force) refreshPending = true;
    return;
  }
  loading = true;
  try {
    data = await api('/state');
    $('#connection-banner').classList.add('hidden');
    app.dataset.stale = 'false';
    if (page === 'patient') {
      const patientId = selected;
      const rows = await api(
        `/patients/${patientId}/history?from=${encodeURIComponent(new Date(Date.now() - hours * 3600000).toISOString())}&limit=300`
      );
      if (patientId === selected) history = rows;
    }
    if (
      force ||
      (!dialog.open && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName))
    )
      render();
  } catch (e) {
    if (user) {
      $('#connection-banner').textContent =
        `Mất kết nối máy chủ hoặc truy vấn thất bại. Dữ liệu trên màn hình chưa được cập nhật; lần nhận cuối ${fmt(data?.at, true)}.`;
      $('#connection-banner').classList.remove('hidden');
      app.dataset.stale = 'true';
    }
    toast(e.message);
  } finally {
    loading = false;
    if (refreshPending) {
      refreshPending = false;
      void refresh(true);
    }
  }
}
async function requestDialog(id) {
  const r = data.requests.find((x) => x.id === id),
    events = await api(`/requests/${id}/events`);
  const next = {
    assigned: 'accepted',
    accepted: 'at_bed',
    at_bed: 'in_progress',
    in_progress: 'completed',
  }[r.state];
  dialog.innerHTML = `<h2>${esc(ruleNames[r.rule])} · ${r.current_bed_id || r.bed_id}</h2><p class="subtitle">${r.patient_id} · ${esc(r.assignee)} · ${stateNames[r.state]}</p><div class="timeline" style="margin-top:25px">${events.map((e) => `<p><b>${esc(stateNames[e.action] || (e.action === 'escalated' ? 'Chuyển cấp' : e.action))}</b><small>${fmt(e.at, true)} · ${esc(e.actor)}</small>${esc(e.note)}</p>`).join('')}</div>${next ? `<form id="transition-form"><label class="field">Ghi nhận đánh giá / hành động / kết quả<textarea name="note" placeholder="Nhập nội dung thực hiện tại giường…" ${next === 'completed' ? 'required minlength="5"' : ''}></textarea></label><div class="actions"><button class="primary">${stateNames[next]}</button><button type="button" data-close>Đóng</button></div></form>` : '<button data-close>Đóng</button>'}`;
  dialog.showModal();
  if (next)
    $('#transition-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(`/requests/${id}/transition`, 'POST', {
          state: next,
          note: new FormData(e.target).get('note'),
        });
        dialog.close();
        await refresh(true);
        toast('Đã lưu trạng thái và nhật ký');
      } catch (err) {
        toast(err.message);
      }
    };
}
function jsonDialog(title, value) {
  dialog.innerHTML = `<h2>${esc(title)}</h2><pre>${esc(JSON.stringify(value, null, 2))}</pre><button data-close>Đóng</button>`;
  dialog.showModal();
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button,[data-patient]');
  if (!b) return;
  try {
    if (b.hasAttribute('data-close')) return dialog.close();
    if (b.dataset.nav) {
      page = b.dataset.nav;
      await refresh(true);
      return;
    }
    if (b.dataset.patient) {
      selected = b.dataset.patient;
      page = 'patient';
      history = [];
      await refresh(true);
      return;
    }
    if (b.dataset.filter) {
      filter = b.dataset.filter;
      render();
      return;
    }
    if (b.dataset.tab) {
      patientTab = b.dataset.tab;
      render();
      return;
    }
    if (b.dataset.request) return await requestDialog(b.dataset.request);
    if (b.dataset.scenario) {
      await api(`/devices/${b.dataset.device}/scenario`, 'PUT', { scenario: b.dataset.scenario });
      await refresh(true);
      toast('Đã đổi kịch bản; chờ mẫu đo và thời gian duy trì rule');
      return;
    }
    if (b.dataset.call) {
      await api(`/devices/${b.dataset.call}/call`, 'POST', {});
      toast('Đã gửi sự kiện gọi qua MQTT');
      return;
    }
    if (b.dataset.care) {
      await api('/emr/care', 'POST', { care_id: b.dataset.care });
      dialog.close();
      toast('Đã xác nhận ghi nhận chăm sóc vào hàng đợi EMR');
      return;
    }
    switch (b.dataset.action) {
      case 'logout':
        await api('/logout', 'POST');
        user = null;
        login();
        break;
      case 'refresh':
        await refresh(true);
        break;
      case 'print':
        window.print();
        break;
      case 'payload':
        jsonDialog('Payload mới nhất', data.beds.find((b) => b.patient_id === selected)?.latest);
        break;
      case 'emr-records':
        jsonDialog('Bản ghi tại EMR sandbox', await api('/emr/records'));
        break;
      case 'audit':
        jsonDialog('Nhật ký thao tác', await api('/audit'));
        break;
      case 'care-records': {
        const records = await api(`/patients/${selected}/care`);
        dialog.innerHTML = `<h2>Ghi nhận chăm sóc</h2>${records.map((c) => `<p><b>${esc(c.actor)} · ${fmt(c.at, true)}</b><br>${esc(c.note)}</p><button data-care="${c.id}">Xác nhận gửi ghi nhận → EMR</button>`).join('') || '<p>Chưa có ghi nhận đã hoàn tất.</p>'}<p><button data-close>Đóng</button></p>`;
        dialog.showModal();
        break;
      }
      case 'emr-confirm': {
        const p = data.beds.find((b) => b.patient_id === selected)?.latest;
        if (!p) throw new Error('Chưa có mẫu đo');
        dialog.innerHTML = `<h2>Xác nhận kết quả gửi EMR</h2><p>${p.patient_id} · ${p.bed_id} · ${fmt(p.measured_at, true)} ${date(p.measured_at)}</p><p class="subtitle">Kiểm tra nguồn, giá trị và thời gian trước khi xác nhận.</p><pre>${esc(JSON.stringify(p.readings, null, 2))}</pre><button class="primary" id="confirm-emr">Xác nhận gửi bộ kết quả này</button> <button data-close>Đóng</button>`;
        dialog.showModal();
        $('#confirm-emr').onclick = async () => {
          try {
            await api('/emr/confirm', 'POST', { message_id: p.message_id });
            dialog.close();
            toast('Đã đưa vào hàng đợi đồng bộ');
          } catch (e) {
            toast(e.message);
          }
        };
        break;
      }
    }
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target.matches('.bed-card') && ['Enter', ' '].includes(e.key)) {
    e.preventDefault();
    e.target.click();
  }
});
document.addEventListener('change', async (e) => {
  if (e.target.id === 'patient-select') {
    selected = e.target.value;
    history = [];
    await refresh(true);
  }
  if (e.target.id === 'history-range') {
    hours = Number(e.target.value);
    await refresh(true);
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    $('#search').focus();
    $('#search').setSelectionRange(pos, pos);
  }
});
document.addEventListener('submit', async (e) => {
  if (!['rules-form', 'swap-form'].includes(e.target.id)) return;
  e.preventDefault();
  try {
    const body = Object.fromEntries(new FormData(e.target));
    if (e.target.id === 'rules-form') {
      await api(
        '/rules',
        'PUT',
        Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Number(v)]))
      );
      toast('Đã lưu bộ quy tắc');
    } else {
      await api('/assignments/swap', 'POST', body);
      toast('Đã cập nhật gán giường theo thời gian');
    }
    await refresh(true);
  } catch (err) {
    toast(err.message);
  }
});
try {
  user = await api('/me');
  await refresh(true);
} catch {
  login();
}
setInterval(() => refresh(), 3000);
