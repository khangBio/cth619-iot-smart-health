<template>
  <main class="health-app">
    <header class="health-header">
      <div>
        <span class="eyebrow">VITALCARE / SMART HEALTH</span>
        <h1>__TITLE__</h1>
        <p>Theo dõi sinh tồn · Phối hợp chăm sóc · Kết nối IoT</p>
      </div>
      <div v-if="user" class="health-actions">
        <span
          >{{ user.name
          }}<small>{{ user.role === 'admin' ? 'Quản trị' : 'Điều dưỡng' }}</small></span
        ><button @click="logout">Đăng xuất</button>
      </div>
    </header>
    <div v-if="error" class="health-alert" role="alert">
      {{ error }} <button @click="refresh">Thử lại</button>
    </div>
    <div v-if="notice" class="health-notice" role="status">{{ notice }}</div>
    <section v-if="!user" class="health-login health-panel">
      <span class="eyebrow">KHÔNG GIAN CHĂM SÓC</span>
      <h2>Đăng nhập VitalCare</h2>
      <p>Truy cập dữ liệu theo tài khoản được phân quyền.</p>
      <form @submit.prevent="login">
        <label>Tài khoản<input v-model="username" autocomplete="username" required /></label
        ><label
          >Mật khẩu<input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required /></label
        ><button class="primary" :disabled="busy || starting">
          {{ busy ? 'Đang đăng nhập…' : 'Đăng nhập' }}
        </button>
      </form>
    </section>
    <template v-else-if="data">
      <div class="health-status">
        <span :class="['status-dot', connected ? 'green' : 'red']"></span
        >{{ connected ? 'Đã đồng bộ' : 'Mất kết nối · dữ liệu lần cuối' }} {{ time(data.at)
        }}<span>MQTT: {{ data.mqtt ? 'kết nối' : 'mất kết nối' }}</span
        ><span>{{ data.database }}</span>
      </div>
      <template v-if="page === 'overview'">
        <div class="health-stats">
          <article>
            <span>Giường đang theo dõi</span><strong>{{ beds.length }}</strong>
          </article>
          <article>
            <span>Thiết bị có số đo mới</span
            ><strong
              >{{ beds.filter((b) => b.online).length }}<small>/ {{ beds.length }}</small></strong
            >
          </article>
          <article class="danger">
            <span>Báo động đang hoạt động</span
            ><strong>{{ data.alarms.filter((a) => a.active).length }}</strong>
          </article>
          <article>
            <span>Yêu cầu chưa hoàn tất</span
            ><strong>{{ data.requests.filter((r) => r.state !== 'completed').length }}</strong>
          </article>
        </div>
        <div class="health-toolbar">
          <h2>Toàn cảnh khu điều trị</h2>
          <input
            v-model="search"
            placeholder="Tìm tên, giường hoặc bệnh nhân…"
            aria-label="Tìm bệnh nhân"
          /><select v-model="filter" aria-label="Lọc trạng thái">
            <option value="all">Tất cả trạng thái</option>
            <option value="alarm">Có báo động</option>
            <option value="offline">Mất dữ liệu</option>
          </select>
        </div>
        <div class="health-bed-grid">
          <a
            v-for="b in filteredBeds"
            :key="b.device_id"
            :href="'/dashboard/patient?patient=' + encodeURIComponent(b.patient_id)"
            :class="['health-bed', { alarming: b.alarms.length }]"
            ><div class="health-row">
              <span class="bed-tag"
                >{{ b.bed_id }} <small>{{ b.room }}</small></span
              ><span
                :class="[
                  'health-badge',
                  !b.online ? 'warning' : b.alarms.length ? 'critical' : 'ok',
                ]"
                >{{ status(b) }}</span
              >
            </div>
            <h2>{{ b.name }}</h2>
            <p>
              {{ b.patient_id }} · {{ b.sex }} · {{ new Date().getFullYear() - b.birth_year }} tuổi
            </p>
            <div class="health-vitals">
              <div v-for="v in vitals" :key="v[1]">
                <span>{{ v[0] }}</span
                ><strong
                  >{{ vitalValue(b, v[1]) }}<small>{{ v[2] }}</small></strong
                >
              </div>
            </div>
            <footer>
              <span
                >{{ b.device_id }} · nhận {{ time(b.received_at)
                }}<small v-if="!b.online && b.receiving"
                  >Mẫu trễ {{ b.sample_delay_seconds }} giây</small
                ></span
              ><span>{{ b.requests.length }} yêu cầu →</span>
            </footer></a
          >
        </div>
        <p v-if="!filteredBeds.length">Không có bệnh nhân phù hợp.</p>
      </template>
      <template v-if="page === 'patient'">
        <div class="health-toolbar">
          <select v-model="selected" @change="changePatient" aria-label="Chọn bệnh nhân">
            <option v-for="b in beds" :value="b.patient_id">
              {{ b.bed_id }} · {{ b.name }}
            </option></select
          ><select v-model="hours" @change="loadHistory" aria-label="Khoảng lịch sử">
            <option :value="1">1 giờ qua</option>
            <option :value="6">6 giờ qua</option>
            <option :value="24">24 giờ qua</option></select
          ><a :href="'/health-api/export/' + selected">Xuất CSV · 24 giờ</a>
        </div>
        <template v-if="patient"
          ><section class="health-panel health-patient">
            <div>
              <h2>{{ patient.name }}</h2>
              <p>
                {{ patient.patient_id }} · {{ patient.encounter_id }} · {{ patient.bed_id }} /
                {{ patient.room }}
              </p>
              <p>{{ patient.diagnosis }}</p>
            </div>
            <span :class="['health-badge', patient.online ? 'ok' : 'warning']">{{
              status(patient)
            }}</span>
          </section>
          <div v-if="!patient.online && patient.receiving" class="health-alert" role="status">
            Đang nhận bản tin, nhưng chưa có số đo đủ mới. Độ trễ đo–nhận của mẫu cuối:
            {{ patient.sample_delay_seconds }} giây. Các giá trị bên dưới là mẫu trễ vừa nhận, không
            phải số đo trực tuyến và không dùng để đánh giá báo động. Giờ đo:
            {{ stamp(patient.received_sample?.measured_at) }} · Giờ nhận:
            {{ stamp(patient.received_at) }}. Kiểm tra đồng bộ giờ và tốc độ mô phỏng Wokwi.
          </div>
          <div class="health-stats vitals-detail">
            <article v-for="v in vitals">
              <span>{{ v[0] }}</span
              ><strong
                >{{ vitalValue(patient, v[1]) }}<small>{{ v[2] }}</small></strong
              >
            </article>
          </div>
          <div class="health-tabs">
            <button
              v-for="tab in [
                ['charts', 'Diễn biến sinh tồn'],
                ['sheet', 'Phiếu chức năng sống'],
                ['payload', 'Payload & cảm biến'],
                ['care', 'Chăm sóc'],
              ]"
              @click="patientTab = tab[0]"
              :class="{ active: patientTab === tab[0] }"
            >
              {{ tab[1] }}
            </button>
          </div>
          <div v-if="historyLoading" role="status">Đang tải lịch sử…</div>
          <template v-if="patientTab === 'charts'"
            ><div class="health-charts">
              <section v-for="c in charts" class="health-panel">
                <h2>{{ c.title }}</h2>
                <div v-html="plot(c)"></div>
                <p>{{ c.note }}</p>
              </section>
            </div>
            <button
              class="primary"
              :disabled="!patient.latest || !patient.online || !connected"
              @click="confirmSample"
            >
              Xác nhận mẫu mới nhất → EMR
            </button></template
          >
          <template v-if="patientTab === 'sheet'"
            ><button class="no-print" @click="printSheet">In phiếu</button>
            <div class="health-print-sheet" v-html="sheetHtml"></div
          ></template>
          <section v-if="patientTab === 'payload'" class="health-panel">
            <h2>Định danh thiết bị và nguồn đo</h2>
            <p>{{ patient.device_id }} · ESP32_BEDSIDE_MONITOR · Lần gán: {{ patient.id }}</p>
            <p>
              DS18B20 đo nhiệt độ; MPU6050 đo gia tốc. Các chỉ số mạch, SpO₂, huyết áp, nhịp thở,
              cân nặng được giả lập trong firmware. Simulator phần mềm giả lập cả hai cảm biến.
            </p>
            <div class="health-table">
              <table>
                <thead>
                  <tr>
                    <th>Sensor ID</th>
                    <th>Loại</th>
                    <th>Chỉ số</th>
                    <th>Chất lượng</th>
                    <th>Nguồn</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in patient.sensors">
                    <td>{{ s.sensor_id }}</td>
                    <td>{{ s.sensor_type }}</td>
                    <td>{{ s.code }} ({{ s.unit }})</td>
                    <td>{{ reading(patient, s.code)?.quality || '—' }}</td>
                    <td>{{ reading(patient, s.code)?.source || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <details>
              <summary>Payload JSON mới nhất</summary>
              <pre>{{ JSON.stringify(patient.received_sample || patient.latest, null, 2) }}</pre>
            </details>
          </section>
          <section v-if="patientTab === 'care'" class="health-panel">
            <h2>Yêu cầu của bệnh nhân</h2>
            <div
              v-for="r in data.requests.filter((r) => r.patient_id === selected)"
              class="health-care"
            >
              <span>{{ ruleName(r.rule) }} · {{ stateName(r.state) }}</span
              ><button @click="openRequest(r)">Xem / xử lý</button>
            </div>
            <h2>Ghi nhận chăm sóc</h2>
            <p v-if="!care.length">Chưa có ghi nhận.</p>
            <article v-for="c in care" class="health-care">
              <div>
                {{ c.actor }} · {{ stamp(c.at) }}
                <p>{{ c.note }}</p>
              </div>
              <button @click="confirmCare(c)">Xác nhận → EMR</button>
            </article>
          </section>
        </template>
      </template>
      <template v-if="page === 'workflow'"
        ><div class="health-toolbar">
          <h2>Tiếp nhận & xử lý báo động</h2>
          <select v-model="requestFilter" aria-label="Lọc yêu cầu">
            <option value="open">Chưa hoàn tất</option>
            <option value="all">Tất cả</option>
            <option value="completed">Đã hoàn tất</option>
          </select>
        </div>
        <section class="health-panel health-table">
          <table>
            <thead>
              <tr>
                <th>Giường / bệnh nhân</th>
                <th>Báo động</th>
                <th>Trạng thái</th>
                <th>Phụ trách</th>
                <th>Cập nhật</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in filteredRequests" :key="r.id">
                <td>
                  {{ r.current_bed_id || r.bed_id }}<small>{{ r.patient_id }}</small>
                  <small v-if="r.current_bed_id && r.current_bed_id !== r.bed_id"
                    >Phát sinh tại {{ r.bed_id }}</small
                  >
                </td>
                <td>
                  {{ ruleName(r.rule)
                  }}<small
                    >{{ r.active ? 'Đang hoạt động' : 'Đã phục hồi' }}
                    {{ r.escalated ? '· Đã nâng cấp' : '' }}</small
                  >
                </td>
                <td>
                  <span class="health-badge">{{ stateName(r.state) }}</span>
                </td>
                <td>{{ r.assignee || 'Chưa tiếp nhận' }}</td>
                <td>{{ stamp(r.updated_at) }}</td>
                <td><button @click="openRequest(r)">Xem / xử lý</button></td>
              </tr>
              <tr v-if="!filteredRequests.length">
                <td colspan="6">Không có yêu cầu trong nhóm này.</td>
              </tr>
            </tbody>
          </table>
        </section></template
      >
      <template v-if="page === 'devices'"
        ><div class="health-bed-grid">
          <section v-for="b in beds" class="health-panel">
            <div class="health-row">
              <h2>{{ b.device_id }}</h2>
              <span :class="['health-badge', b.online ? 'ok' : 'warning']">{{
                b.receiving ? 'Đang nhận bản tin' : 'Không nhận số đo mới'
              }}</span>
            </div>
            <p>{{ b.bed_id }} · {{ b.patient_id }} · {{ b.name }}</p>
            <p>Bản tin số đo cuối: {{ stamp(b.received_at) }}</p>
            <p>
              Thời gian đo: {{ stamp(b.received_sample?.measured_at) }} · Độ trễ
              {{ b.sample_delay_seconds ?? '—' }} giây
            </p>
            <p>{{ status(b) }}</p>
            <p>Chất lượng: {{ b.quality }}</p>
            <p>
              Đèn: <b>{{ lampName(b.lamp?.mode) }}</b>
            </p>
            <p>
              ACK: {{ b.lamp?.ack_at ? stamp(b.lamp.ack_at) : 'Chưa xác nhận' }} ·
              {{ b.lamp?.attempts || 0 }} lần gửi
            </p>
            <details>
              <summary>{{ b.sensors.length }} kênh đo / cảm biến</summary>
              <ul>
                <li v-for="s in b.sensors">
                  {{ s.sensor_id }} · {{ s.sensor_type }} · {{ s.code }}
                </li>
              </ul>
            </details>
          </section>
        </div></template
      >
      <template v-if="page === 'emr'"
        ><section class="health-panel health-table">
          <h2>Hàng đợi đồng bộ EMR</h2>
          <p>
            Chỉ gửi mẫu đo / ghi nhận sau khi người dùng xác nhận. Lỗi vận chuyển được backend thử
            lại.
          </p>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Trạng thái</th>
                <th>Số lần gửi</th>
                <th>Lỗi gần nhất</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in data.outbox">
                <td>{{ o.id }}</td>
                <td>{{ o.state }}</td>
                <td>{{ o.attempts }}</td>
                <td>{{ o.last_error || '—' }}</td>
              </tr>
              <tr v-if="!data.outbox.length">
                <td colspan="4">Chưa có bản ghi trong hàng đợi.</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section class="health-panel">
          <h2>Bản ghi đã đến EMR sandbox</h2>
          <details v-for="r in records">
            <summary>{{ r.id }} · {{ stamp(r.received_at) }}</summary>
            <pre>{{ pretty(r.payload) }}</pre>
          </details>
          <p v-if="!records.length">Chưa có bản ghi.</p>
        </section></template
      >
      <template v-if="page === 'settings'"
        ><p v-if="user.role !== 'admin'" class="health-alert">
          Chức năng này chỉ dành cho tài khoản quản trị.
        </p>
        <template v-else
          ><section class="health-panel">
            <h2>Ngưỡng và thời gian báo động</h2>
            <form @submit.prevent="saveRules">
              <div class="health-form-grid">
                <label v-for="[key, label] in ruleFields"
                  >{{ label
                  }}<input type="number" step="any" v-model.number="ruleDraft[key]" required
                /></label>
              </div>
              <button class="primary" :disabled="busy">Lưu cấu hình</button>
              <p>Phiên bản đang áp dụng: {{ data.rules.version }}</p>
            </form>
          </section>
          <section class="health-panel">
            <h2>Đổi giường cho thiết bị</h2>
            <form class="health-toolbar" @submit.prevent="swap">
              <select v-model="swapDevice" aria-label="Thiết bị cần đổi">
                <option value="" disabled>Chọn thiết bị</option>
                <option v-for="b in beds" :value="b.device_id">
                  {{ b.device_id }} · {{ b.bed_id }}
                </option></select
              ><select v-model="swapBed" aria-label="Giường đích">
                <option value="" disabled>Chọn giường đích</option>
                <option v-for="b in beds" :value="b.bed_id">{{ b.bed_id }}</option></select
              ><button :disabled="busy || !swapDevice || !swapBed">Xác nhận đổi giường</button>
            </form>
          </section>
          <section class="health-panel">
            <h2>Nhật ký kiểm toán</h2>
            <details v-for="a in audit">
              <summary>{{ stamp(a.at) }} · {{ a.actor }} · {{ a.action }}</summary>
              <pre>{{ pretty(a) }}</pre>
            </details>
          </section></template
        ></template
      >
    </template>
    <p v-else>Đang tải dữ liệu…</p>
    <div v-if="dialog" class="health-overlay" @click.self="closeDialog">
      <section role="dialog" aria-modal="true" :aria-label="dialog.title" class="health-dialog">
        <div class="health-row">
          <h2>{{ dialog.title }}</h2>
          <button @click="closeDialog" :disabled="busy" aria-label="Đóng">×</button>
        </div>
        <template v-if="dialog.kind === 'request'"
          ><p>
            {{ dialog.request.bed_id }} · {{ dialog.request.patient_id }} ·
            {{ ruleName(dialog.request.rule) }}
          </p>
          <p>Hiện tại: {{ stateName(dialog.request.state) }}</p>
          <ol>
            <li v-for="e in events">
              {{ stamp(e.at) }} · {{ e.actor }} · {{ stateName(e.action) }}
              <p>{{ e.note }}</p>
            </li>
          </ol>
          <label v-if="nextState(dialog.request.state)"
            >Ghi chú xử lý<textarea
              v-model="note"
              placeholder="Ghi nhận xử lý (ít nhất 5 ký tự khi hoàn tất)"
              rows="3"
            ></textarea></label
          ><button
            v-if="nextState(dialog.request.state)"
            class="primary"
            @click="transition"
            :disabled="busy"
          >
            {{ stateName(nextState(dialog.request.state)) }}
          </button></template
        ><template v-else
          ><p>{{ dialog.description }}</p>
          <pre>{{ dialog.preview }}</pre>
          <button class="primary" @click="submitConfirmation" :disabled="busy">
            Xác nhận gửi
          </button></template
        >
        <p v-if="dialogError" role="alert" class="health-alert">{{ dialogError }}</p>
      </section>
    </div>
  </main>
</template>
<script>
export default {
  data() {
    return {
      page: '__PAGE__',
      user: null,
      data: null,
      username: '',
      password: '',
      busy: false,
      starting: true,
      error: '',
      notice: '',
      connected: false,
      search: '',
      filter: 'all',
      selected: new URLSearchParams(location.search).get('patient') || '',
      hours: 1,
      history: [],
      historyLoading: false,
      patientTab: 'charts',
      care: [],
      records: [],
      audit: [],
      ruleDraft: {},
      swapDevice: '',
      swapBed: '',
      requestFilter: 'open',
      dialog: null,
      dialogError: '',
      events: [],
      note: '',
      vitals: [
        ['Mạch', 'pulse_rate', 'bpm'],
        ['SpO₂', 'spo2', '%'],
        ['Nhiệt độ', 'temperature', '°C'],
        ['Huyết áp', 'bp', 'mmHg'],
        ['Nhịp thở', 'respiratory_rate', 'l/ph'],
        ['Cân nặng', 'weight', 'kg'],
      ],
      ruleFields: [
        ['spo2Low', 'SpO₂ thấp (%)'],
        ['pulseLow', 'Mạch thấp (bpm)'],
        ['pulseHigh', 'Mạch cao (bpm)'],
        ['temperatureHigh', 'Nhiệt độ cao (°C)'],
        ['sustainSeconds', 'Duy trì bất thường (giây)'],
        ['recoverySeconds', 'Phục hồi (giây)'],
        ['offlineSeconds', 'Mất dữ liệu (giây)'],
        ['escalationSeconds', 'Nâng cấp báo động (giây)'],
        ['maxLiveAgeSeconds', 'Tuổi mẫu tối đa (giây)'],
      ],
      charts: [
        {
          title: 'Nhịp tim / mạch',
          series: [{ code: 'pulse_rate', label: 'Mạch', color: '#00897b' }],
          min: 30,
          max: 160,
          note: 'Xu hướng mạch theo mẫu đo, không phải sóng ECG.',
        },
        {
          title: 'Độ bão hòa oxy · SpO₂',
          series: [{ code: 'spo2', label: 'SpO₂', color: '#426be2' }],
          min: 70,
          max: 100,
          note: 'Mẫu không hợp lệ và khoảng mất dữ liệu được ngắt đường.',
        },
        {
          title: 'Mạch & nhiệt độ',
          series: [
            { code: 'pulse_rate', label: 'Mạch', color: '#426be2' },
            {
              code: 'temperature',
              label: 'Nhiệt độ',
              color: '#dc5260',
              transform: (v) => (v - 33) * 20,
            },
          ],
          min: 40,
          max: 160,
          dual: true,
          note: 'Mạch: xanh (trục trái) · Nhiệt độ: đỏ (trục phải).',
        },
        {
          title: 'Nhịp thở',
          series: [{ code: 'respiratory_rate', label: 'Nhịp thở', color: '#9770c6' }],
          min: 0,
          max: 40,
          note: 'Đơn vị: lần/phút.',
        },
      ],
    };
  },
  computed: {
    beds() {
      return (this.data?.beds || []).map((b) => ({
        ...b,
        receiving:
          b.receiving &&
          this.connected &&
          Date.now() - Date.parse(b.received_at) <= this.data.rules.offlineSeconds * 1000,
        online:
          b.online &&
          this.connected &&
          Date.now() - Date.parse(b.latest_at) <= this.data.rules.offlineSeconds * 1000,
      }));
    },
    patient() {
      return this.beds.find((b) => b.patient_id === this.selected);
    },
    filteredBeds() {
      const q = this.search.toLocaleLowerCase('vi');
      return this.beds.filter(
        (b) =>
          (b.name + ' ' + b.bed_id + ' ' + b.patient_id).toLocaleLowerCase('vi').includes(q) &&
          (this.filter === 'all' || (this.filter === 'alarm' ? b.alarms.length : !b.online))
      );
    },
    filteredRequests() {
      return this.data.requests.filter(
        (r) =>
          this.requestFilter === 'all' ||
          (this.requestFilter === 'open' ? r.state !== 'completed' : r.state === 'completed')
      );
    },
    sheetHtml() {
      return this.patient
        ? this.visuals().sheet(this.patient, this.history, this.data.rules.offlineSeconds)
        : '';
    },
  },
  methods: {
    visuals() {
      /*__VISUALS__*/
      return { chart, sheet, fmt };
    },
    time(v) {
      return this.visuals().fmt(v);
    },
    stamp(v) {
      return v ? new Date(v).toLocaleString('vi-VN') : '—';
    },
    pretty(v) {
      try {
        return JSON.stringify(typeof v === 'string' ? JSON.parse(v) : v, null, 2);
      } catch {
        return v;
      }
    },
    reading(b, c) {
      return (b.online ? b.latest : b.received_sample)?.readings?.find((r) => r.code === c);
    },
    vitalValue(b, c) {
      if (c === 'bp') return this.vitalValue(b, 'systolic') + '/' + this.vitalValue(b, 'diastolic');
      const r = this.reading(b, c);
      return (b.online || b.receiving) && r?.quality === 'valid' ? r.value : '—';
    },
    status(b) {
      return !b.online
        ? b.receiving
          ? 'Đang nhận · mẫu trễ'
          : 'Không nhận số đo mới'
        : b.alarms.length
          ? 'Có báo động'
          : b.quality !== 'valid'
            ? 'Kiểm tra chất lượng'
            : 'Ổn định';
    },
    stateName(s) {
      return (
        {
          assigned: 'Chờ tiếp nhận',
          accepted: 'Đã tiếp nhận',
          at_bed: 'Đã đến giường',
          in_progress: 'Đang xử lý',
          completed: 'Hoàn tất',
        }[s] || s
      );
    },
    ruleName(s) {
      return (
        {
          spo2_low: 'SpO₂ dưới ngưỡng',
          pulse_abnormal: 'Mạch ngoài ngưỡng',
          temperature_high: 'Nhiệt độ cao',
          nurse_call: 'Gọi điều dưỡng',
          offline: 'Mất dữ liệu',
        }[s] || s
      );
    },
    lampName(s) {
      return (
        {
          off: 'Tắt',
          red: 'Đỏ · đã nhận',
          red_blink: 'Đỏ nhấp nháy',
          blue: 'Xanh · gọi hỗ trợ',
          yellow: 'Vàng · kỹ thuật',
        }[s] || 'Chưa có lệnh'
      );
    },
    nextState(s) {
      return {
        assigned: 'accepted',
        accepted: 'at_bed',
        at_bed: 'in_progress',
        in_progress: 'completed',
      }[s];
    },
    plot(c) {
      return this.visuals().chart(this.history, c.series, c.min, c.max, {
        dual: c.dual,
        offlineSeconds: this.data.rules.offlineSeconds,
      });
    },
    printSheet() {
      window.print();
    },
    async api(path, method = 'GET', body) {
      const controller = new AbortController();
      this.controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const r = await fetch('/health-api' + path, {
          method,
          credentials: 'same-origin',
          cache: 'no-store',
          headers: body ? { 'Content-Type': 'application/json' } : {},
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        const p = await r.json();
        if (!r.ok) {
          if (r.status === 401 && path !== '/login') this.clearSession();
          throw Error(p.error || 'Không kết nối được backend');
        }
        return p;
      } finally {
        clearTimeout(timeout);
        this.controllers.delete(controller);
      }
    },
    clearSession() {
      this.user = null;
      this.data = null;
      this.history = [];
      this.care = [];
      this.records = [];
      this.audit = [];
      this.ruleDraft = {};
      this.dialog = null;
      this.connected = false;
      this.sessionVersion++;
    },
    async login() {
      this.busy = true;
      this.error = '';
      try {
        this.user = await this.api('/login', 'POST', {
          username: this.username,
          password: this.password,
        });
        this.password = '';
        await this.refresh();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },
    async logout() {
      try {
        await this.api('/logout', 'POST', {});
        this.clearSession();
      } catch (e) {
        this.error = e.message;
      }
    },
    async refresh() {
      if (this.refreshing || this.disposed) return;
      this.refreshing = true;
      const version = this.sessionVersion;
      try {
        if (!this.user) this.user = await this.api('/me');
        const d = await this.api('/state');
        if (this.disposed || version !== this.sessionVersion) return;
        this.data = d;
        this.connected = true;
        this.error = '';
        if (!Object.keys(this.ruleDraft).length) this.ruleDraft = { ...d.rules };
        if (!this.selected || !d.beds.some((b) => b.patient_id === this.selected))
          this.selected = d.beds[0]?.patient_id || '';
        if (this.page === 'patient') await this.loadHistory();
        if (this.page === 'emr') this.records = await this.api('/emr/records');
        if (this.page === 'settings' && this.user?.role === 'admin')
          this.audit = await this.api('/audit');
      } catch (e) {
        if (!this.disposed) {
          this.connected = false;
          if (this.user) this.error = e.message;
        }
      } finally {
        this.refreshing = false;
      }
    },
    async changePatient() {
      this.history = [];
      this.care = [];
      const u = new URL(location.href);
      u.searchParams.set('patient', this.selected);
      window.history.replaceState(null, '', u);
      await this.loadHistory();
    },
    async loadHistory() {
      const id = this.selected;
      if (!id) return;
      const ticket = ++this.historyTicket;
      this.historyLoading = true;
      try {
        const to = new Date(),
          from = new Date(to.getTime() - Number(this.hours) * 3600000);
        const [h, c] = await Promise.all([
          this.api(
            '/patients/' +
              encodeURIComponent(id) +
              '/history?limit=2000&from=' +
              from.toISOString() +
              '&to=' +
              to.toISOString()
          ),
          this.api('/patients/' + encodeURIComponent(id) + '/care'),
        ]);
        if (ticket === this.historyTicket && !this.disposed && this.user) {
          this.history = h;
          this.care = c;
        }
      } catch (e) {
        this.error = e.message;
      } finally {
        if (ticket === this.historyTicket) this.historyLoading = false;
      }
    },
    closeDialog() {
      if (!this.busy) {
        this.dialog = null;
        this.dialogError = '';
      }
    },
    async openRequest(r) {
      this.dialog = { kind: 'request', title: 'Xử lý yêu cầu chăm sóc', request: { ...r } };
      this.note = '';
      this.events = [];
      this.dialogError = '';
      try {
        const events = await this.api('/requests/' + r.id + '/events');
        if (this.dialog?.request?.id === r.id) this.events = events;
      } catch (e) {
        this.dialogError = e.message;
      }
    },
    async transition() {
      this.busy = true;
      this.dialogError = '';
      const r = this.dialog.request;
      try {
        await this.api('/requests/' + r.id + '/transition', 'POST', {
          state: this.nextState(r.state),
          note: this.note,
        });
        this.dialog = null;
        this.notice = 'Đã cập nhật yêu cầu chăm sóc.';
        await this.refresh();
      } catch (e) {
        this.dialogError = e.message;
      } finally {
        this.busy = false;
      }
    },
    confirmSample() {
      const p = this.patient.latest;
      if (!p) return;
      this.dialogError = '';
      this.dialog = {
        kind: 'confirm',
        title: 'Xác nhận mẫu đo gửi EMR',
        description: this.patient.name + ' · ' + p.patient_id + ' · ' + this.stamp(p.measured_at),
        preview: JSON.stringify(p.readings, null, 2),
        path: '/emr/confirm',
        body: { message_id: p.message_id },
      };
    },
    confirmCare(c) {
      this.dialogError = '';
      this.dialog = {
        kind: 'confirm',
        title: 'Xác nhận ghi nhận chăm sóc gửi EMR',
        description: this.patient.name + ' · ' + this.stamp(c.at),
        preview: c.note,
        path: '/emr/care',
        body: { care_id: c.id },
      };
    },
    async submitConfirmation() {
      this.busy = true;
      this.dialogError = '';
      try {
        await this.api(this.dialog.path, 'POST', this.dialog.body);
        this.dialog = null;
        this.notice = 'Đã ghi nhận xác nhận và đưa vào hàng đợi EMR.';
        await this.refresh();
      } catch (e) {
        this.dialogError = e.message;
      } finally {
        this.busy = false;
      }
    },
    async saveRules() {
      this.busy = true;
      try {
        await this.api(
          '/rules',
          'PUT',
          Object.fromEntries(this.ruleFields.map(([k]) => [k, Number(this.ruleDraft[k])]))
        );
        this.notice = 'Đã lưu ngưỡng báo động.';
        await this.refresh();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },
    async swap() {
      this.busy = true;
      try {
        await this.api('/assignments/swap', 'POST', {
          device_id: this.swapDevice,
          target_bed: this.swapBed,
        });
        this.notice = 'Đã cập nhật lần gán thiết bị.';
        await this.refresh();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
      }
    },
  },
  mounted() {
    this.controllers = new Set();
    this.disposed = false;
    this.sessionVersion = 0;
    this.historyTicket = 0;
    this.refresh().finally(() => {
      this.starting = false;
    });
    this.timer = setInterval(() => {
      if (this.user) this.refresh();
    }, 3000);
  },
  unmounted() {
    this.disposed = true;
    clearInterval(this.timer);
    for (const c of this.controllers) c.abort();
  },
};
</script>
<style>
/*__STYLES__*/
</style>
