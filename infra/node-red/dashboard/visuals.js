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
function chart(rows, series, min, max, { height = 235, dual = false, offlineSeconds = 15 } = {}) {
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
      if (prev && Date.parse(row.measured_at) - prev > offlineSeconds * 1000) flush();
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
function sheet(b, history, offlineSeconds = 15) {
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
      if (previous && point.time - previous.time <= offlineSeconds * 1000)
        lines += `<line x1="${previous.x}" y1="${previous.y}" x2="${point.x}" y2="${point.y}" stroke="${color}" stroke-width="2"/>`;
      lines += `<circle cx="${point.x}" cy="${point.y}" r="2.6" fill="${color}"/>`;
      previous = point;
    });
  }
  return `<div class="panel"><div class="panel-head"><h2>Phiếu theo dõi chức năng sống</h2></div><div class="table-scroll"><div class="sheet"><h2>Phiếu theo dõi chức năng sống</h2><div class="sheet-info"><span>Họ tên: <b>${esc(b.name)}</b> · ${b.patient_id}</span><span>Tuổi: ${new Date().getFullYear() - b.birth_year} · Giới: ${b.sex}</span><span>Giường: ${b.bed_id} · ${b.encounter_id}</span></div><div class="sheet-info">Chẩn đoán: ${esc(b.diagnosis)}</div><table><colgroup><col style="width:110px">${Array.from({ length: count }, () => '<col>').join('')}</colgroup><tr><th>Ngày / giờ đo</th>${rows.map((p) => `<td>${date(p.measured_at)}<br>${fmt(p.measured_at, true)}<br>${p.bed_id}</td>`).join('') || '<td>Chưa có dữ liệu</td>'}</tr><tr><td style="padding:0"><svg class="chart" viewBox="0 0 110 280" preserveAspectRatio="none" style="height:280px">${axis}</svg></td><td colspan="${count}" style="padding:0"><svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="height:280px" role="img" aria-label="Đồ thị mạch và nhiệt độ khớp cột thời gian trên phiếu">${grid}${lines}</svg></td></tr>${[
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
