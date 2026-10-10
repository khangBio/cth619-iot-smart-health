# VitalCare — IoT Smart Health / CTH619

Hệ thống chạy xuyên suốt: **6+ thiết bị → MQTT → tiếp nhận/kiểm tra → lưu dữ liệu → rule → dashboard & RGB LED → điều dưỡng xử lý → EMR sandbox**. Giao diện tiếng Việt, bệnh nhân giả lập, mở rộng cấu hình tới 20 giường/khoa.

## Chạy nhanh trên máy cá nhân

Yêu cầu Node.js **22.13+**, khuyến nghị Node 24. Không cần Docker cho bản demo.

```powershell
npm ci
Copy-Item .env.example .env
npm run demo
```

Nếu `node --version` của máy còn là Node 20 nhưng máy có Codex runtime, dùng script tự chọn Node phù hợp:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-demo.ps1
```

Mở **http://127.0.0.1:3000**. Điều dưỡng: `nurse / nurse-demo`. Quản trị: `admin / admin-demo`. Bản demo tạo 6 MQTT client độc lập, broker Aedes và SQLite tại `data/health.db`. Dữ liệu bắt đầu xuất hiện sau khoảng 1–3 giây, không điền sẵn lịch sử đo giả.

Nếu cổng MQTT 1883 đã được dùng, thêm vào `.env`:

```dotenv
MQTT_PORT=1884
MQTT_URL=mqtt://127.0.0.1:1884
```

Trong phiên triển khai này dashboard chạy ở cổng 3000 và broker demo ở **1884** để không chiếm broker có sẵn tại 1883. Không dừng dịch vụ khác để giải phóng cổng.

## Thành phần có sẵn

- **6 bộ ESP32 Wokwi độc lập** trong `firmware/dev-hp01` … `dev-hp06`, mỗi bộ có **DS18B20 + MPU6050**, RGB LED, nút gọi và biến trở tạo kịch bản bất thường.
- 8 kênh dữ liệu/device: mạch, SpO₂, nhiệt độ, nhịp thở, HA tâm thu/tâm trương, cân nặng, gia tốc; phân biệt source, quality, sensor_id và sensor_type.
- Dashboard tổng quan, chi tiết bệnh nhân, đồ thị mạch/SpO₂/nhịp thở, đồ thị hai trục mạch–nhiệt độ, phiếu chức năng sống và in/CSV.
- Cảnh báo có thời gian duy trì/phục hồi; mất dữ liệu; nút gọi; phân công/chuyển cấp; các bước tiếp nhận–đến giường–xử lý–hoàn tất.
- Command có TTL + assignment, xác nhận ACK đúng thiết bị, retry và trạng thái đèn trên UI.
- Đổi giường theo thời gian, lưu đúng mẫu đến trễ, chống trùng message_id, bảo vệ dữ liệu người bệnh.
- Gửi kết quả/ghi nhận chăm sóc đã xác nhận sang FHIR sandbox, retry độc lập, không trùng.
- Phân quyền nurse/admin, session HttpOnly, audit, MQTT credential và ACL theo device.

## Kịch bản demo 8–12 phút

1. Đăng nhập, xem sáu giường với đủ chỉ số và thời điểm đo.
2. Chọn HP-01 → **Payload & cảm biến**, kiểm tra device/patient/encounter/assignment và nguồn từng số đo.
3. Tại **Bàn thử nghiệm**, chọn **SpO₂ thấp**. Đợi ít nhất 5 giây + chu kỳ cập nhật 3 giây.
4. Quan sát cảnh báo SpO₂/mạch, đèn đỏ nhấp nháy ở **Thiết bị IoT**, ACK và các yêu cầu mới.
5. Vào **Điều phối chăm sóc** → Xử lý → tiếp nhận → đến giường → đang xử lý. Kiểm tra đèn chuyển đỏ liên tục.
6. Đổi kịch bản về **Bình thường**. Sau thời gian phục hồi, cảnh báo kết thúc nhưng công việc vẫn mở. Nhập ghi nhận và hoàn tất.
7. Xem biểu đồ trước/trong/sau bất thường, **Phiếu chức năng sống**, in hoặc tải CSV.
8. **Xác nhận mẫu mới nhất → EMR**, kiểm tra từng giá trị rồi gửi. Vào **Đồng bộ HIS/EMR** xem “Đã tiếp nhận” và bản ghi sandbox.
9. Thử nút gọi điều dưỡng, nhiễu và mất dữ liệu. Đăng nhập admin để đổi ngưỡng hoặc hoán đổi bệnh nhân giữa hai giường.

## Chạy bộ tích hợp Docker: PostgreSQL + Mosquitto + Node-RED

Khởi động Docker Desktop (Linux containers) trước. Không chạy demo Aedes trên cùng cổng khi chạy Compose.

```powershell
docker compose up --build -d
# Hoặc thêm bộ simulator phần mềm thay cho Wokwi:
docker compose --profile simulator up --build -d
# Stop run giả lập
docker compose --profile simulator stop simulator
docker compose logs -f api node-red mosquitto
# Build lại server .js
docker compose up -d --build --no-deps api
#Dừng các dịch vụ Docker
docker compose --profile simulator stop
```

- Dashboard: http://127.0.0.1:3000
- Node-RED editor: http://127.0.0.1:1880 (chỉ publish cổng localhost)
- MQTT: `127.0.0.1:1883`, bắt buộc credential, ACL riêng từng thiết bị
- PostgreSQL chỉ truy cập trong Docker network, lưu named volume.
- Flow Node-RED nằm trong `infra/node-red/flows.json`. API đặt `INGEST_VIA_NODE_RED=true` để không nhận bản tin hai lần.

Nếu Docker báo `ports are not available` / `Only one usage of each socket address`, cổng host đã được dịch vụ khác sử dụng. Cấu hình cổng Docker riêng trong `.env`, ví dụ chạy song song với demo local:

```dotenv
DOCKER_MQTT_PORT=1885
DOCKER_HTTP_PORT=3001
DOCKER_NODE_RED_PORT=1880
```

Chạy lại `docker compose up --build -d`. Khi đó dashboard Docker là http://127.0.0.1:3001, Node-RED là http://127.0.0.1:1880 và MQTT từ máy host/gateway là `127.0.0.1:1885`. Bản demo local vẫn dùng cổng riêng 3000/1884. Các địa chỉ **bên trong Docker** vẫn là `mosquitto:1883` và `api:3000`; không đổi MQTT_URL của container hoặc địa chỉ HTTP trong flow Node-RED sang cổng host.

`MQTT_PORT`/`MQTT_URL` trong `.env` cấu hình demo local, còn `DOCKER_MQTT_PORT` cấu hình cổng publish của Compose. Firmware dùng `MQTT_PORT` trong `config.h`; lệnh `npm run wokwi:generate` lấy giá trị từ `WOKWI_MQTT_PORT` nếu có, nếu không lấy `DOCKER_MQTT_PORT`, mặc định 1883. Sau khi đổi cổng hãy cập nhật/sinh lại config và biên dịch firmware. Lệnh sinh lại sẽ ghi đè các file project được sinh; lưu riêng chỉnh sửa mạch/sketch tùy biến trước khi chạy.

Các flow cấu hình và credential được nạp vào `/data` khi Node-RED khởi động. Không sửa flow trực tiếp rồi kỳ vọng tự ghi ngược về repo; export về `infra/node-red/flows.json` nếu cần lưu thay đổi. Credential Node-RED trong volume demo ở dạng rõ (file 0600), chưa dùng kho bí mật sản xuất.

### Node-RED tham gia ở đâu?

| Chế độ chạy | Luồng nhận dữ liệu | Node-RED |
|---|---|---|
| `npm run demo` hoặc `scripts/start-demo.ps1` | Simulator → Aedes → `server/mqtt.js` → `HealthService` → SQLite | Không khởi động, không tham gia |
| `docker compose up --build -d` (Wokwi phát dữ liệu) hoặc thêm `--profile simulator` | Thiết bị → Mosquitto → Node-RED → HTTP API → `HealthService` → PostgreSQL | Tham gia đường nhận số đo, sự kiện gọi, trạng thái thiết bị và ACK |

Trong Compose, `INGEST_VIA_NODE_RED=true` tắt phần **subscribe nhận dữ liệu** trực tiếp của backend. Backend vẫn kết nối MQTT để phát config và lệnh đèn. Nếu Node-RED ngừng hoạt động ở chế độ này, backend không tự chuyển sang nhận trực tiếp; dữ liệu mới và ACK sẽ không đi vào nghiệp vụ qua flow.

Thư mục `infra/node-red` gồm:

| File | Chức năng |
|---|---|
| `flows.json` | Flow subscribe `hospital/#`, lọc topic đầu vào, đọc JSON, gắn Bearer `INGEST_TOKEN`, gọi API và ghi lỗi tích hợp |
| `settings.js` | Cấu hình runtime/editor cổng 1880, logging và cách lưu credential |
| `prepare.cjs` | Chạy trước Node-RED trong container: chép flow từ `/config` sang `/data`, tạo `flows_cred.json` với tài khoản MQTT lấy từ biến môi trường |

Flow định tuyến như sau:

| Topic kết thúc bằng | HTTP endpoint |
|---|---|
| `/telemetry`, `/event` | `POST /api/ingest` |
| `/status` | `POST /api/device-status` |
| `/ack` | `POST /api/ack` |
| `/config`, `/cmd` | Bỏ qua, tránh chuyển lệnh đầu ra ngược vào ingestion |

Node-RED làm cầu nối MQTT → HTTP. Kiểm tra định danh, ghi DB, đánh giá ngưỡng, tạo yêu cầu chăm sóc và xây dựng lệnh đèn nằm trong `server/service.js`. Dashboard được phục vụ từ `public/`, không phải dashboard của Node-RED. Chiều điều khiển là backend → MQTT → actuator; ACK trở lại qua Node-RED.

Sau khi chạy Compose, mở http://127.0.0.1:1880, chọn flow **Smart Health · IoT integration** và kiểm tra MQTT node hiển thị connected. Mở dashboard ở cổng 3000 để xem số đo, thử kịch bản bất thường và kiểm tra ACK. Xem lỗi bằng sidebar Debug và `docker compose logs -f node-red api`. Flow được nạp tự động, không cần import thủ công. Địa chỉ `mosquitto` và `api` trong flow là tên dịch vụ trong Docker network; nếu import vào Node-RED chạy ngoài Docker phải đổi địa chỉ và cấu hình credential tương ứng.

Trạng thái kiểm chứng (10/10/2026): đã chạy Docker với Mosquitto, Node-RED và PostgreSQL; kiểm thử sáu simulator tạm đã xác nhận số đo → cảnh báo → lệnh đèn → ACK, phục hồi và truy vấn lịch sử. Các simulator kiểm thử đã dừng; để phát dữ liệu liên tục dùng Wokwi hoặc `docker compose --profile simulator up --build -d`. Không chạy cả hai nguồn cho cùng device ID. Flow hiện chưa có hàng đợi bền vững để gửi lại telemetry khi HTTP API bị gián đoạn; xem `docs/verification.md` và `docs/architecture.md`.

Để mở rộng: đặt `DEVICE_COUNT=20` trong `.env`, khởi động lại, chạy `npm run wokwi:generate` để sinh thêm project và credential tương ứng. Với broker Docker đã chạy cần `docker compose up --build --force-recreate broker-init mosquitto api node-red` để tái tạo cấu hình tài khoản.

## Chạy ESP32 trong Wokwi

1. Mỗi thư mục `firmware/dev-hp0N` là một dự án độc lập; giữ đúng `config.h` của từng giường.
2. Dùng VS Code + PlatformIO + Wokwi. Tại thư mục device chạy `pio run`, sau đó **Wokwi: Start Simulator**. Có `wokwi.toml`, `platformio.ini`, `diagram.json` và `libraries.txt`.
3. **Wokwi for VS Code có sẵn Private IoT Gateway** trong extension; firmware kết nối `host.wokwi.internal` tại cổng `MQTT_PORT` trong `config.h` (mặc định 1883; cấu hình chạy song song nêu trên dùng 1885). Nếu dùng Wokwi Web thì cần cấu hình Private Gateway riêng để truy cập localhost/LAN. Cần quyền dùng Wokwi phù hợp tài khoản. Xem [cấu hình gateway trong VS Code](https://docs.wokwi.com/vscode/project-config#iot-gateway-esp32-wifi).
4. Có thể tạo sáu project trên Wokwi Web rồi chép `sketch.ino`, `config.h`, `diagram.json`, `libraries.txt` vào từng project; dùng gateway phù hợp. Chưa upload project lên tài khoản bên ngoài trong repo này.
5. Chỉnh nhiệt độ DS18B20 để kiểm thử sốt. Đổi MPU6050 để tạo gia tốc >15 m/s², đánh dấu mạch/SpO₂ nghi ngờ. Xoay biến trở GPIO34 >~68% để thử SpO₂ thấp. Nhấn nút GPIO13 để gọi điều dưỡng.
6. Mở Serial Monitor: xem payload và `ACTUATOR ACK`. Quan sát màu đèn đúng giường đồng thời với dashboard.

Trên Windows có thể build tuần tự cả sáu thiết bị từ thư mục gốc project bằng PlatformIO của VS Code:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-firmware.ps1
# Hoặc chỉ build một thiết bị:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-firmware.ps1 -Devices dev-hp01
```

Mỗi lần build thành công phải có `.pio/build/esp32dev/firmware.bin` và `firmware.elf` trong **chính thư mục device**. Mở từng `firmware/dev-hp01` … `dev-hp06` bằng **File → Open Folder** trong các cửa sổ VS Code riêng; chỉ khởi động Wokwi sau khi build báo SUCCESS. Đường dẫn trong `wokwi.toml` tương đối với thư mục workspace đó. Không chép binary của thiết bị này sang thiết bị khác vì mã thiết bị và credential được biên dịch từ `config.h` riêng.

**Build không khởi động thiết bị và không phát MQTT.** Sau khi build, tại từng cửa sổ VS Code nhấn F1 → **Wokwi: Start Simulator**. Kiểm tra một thiết bị trước: khi Wi-Fi/MQTT kết nối và thời gian NTP đồng bộ, Serial Monitor sẽ in JSON và Node-RED sẽ nhận `hospital/HP/devices/dev-hp01/telemetry`. Sau đó khởi động năm thiết bị còn lại. Giữ tab simulator hiển thị để tránh mô phỏng bị tạm dừng. Dùng **Start Simulator** thông thường; chế độ **Start Simulator and Wait for Debugger** chờ debugger trước khi chạy chương trình.

Nếu gặp `UnknownPlatform` thì xử lý cài đặt PlatformIO trước, không sửa đường dẫn Wokwi để né lỗi. Trường hợp kiểm tra ngày 10/10/2026: package `C:\Users\khang\.platformio\platforms\espressif32@6.9.0` có metadata `.piopm` nhưng thiếu `platform.json`; đã giữ gói thiếu file trong `.platformio/recovery` và cài lại đúng `platformio/espressif32@6.9.0`. Lỗi Wokwi `firmware binary ... not found` là hậu quả của việc chưa tạo được binary. Nên để một lượt cài dependency/build hoàn tất trước khi build ở cửa sổ tiếp theo.

Nối dây: DS18B20 DQ→GPIO4 + điện trở kéo lên 4.7kΩ; MPU6050 SDA→21/SCL→22; RGB common cathode qua 3 điện trở 220Ω→25/26/27; nút gọi→13/GND; biến trở→34; nguồn 3.3V và GND. Firmware dùng MQTT QoS0 cho telemetry, QoS1 cho event/ACK; server command QoS1, không retain. Config assignment được retain để thiết bị nhận lại khi reconnect.

## Payload và API

Payload mẫu đầy đủ trong `docs/payload.example.json`. `schema_version=1`; server bắt buộc đủ 8 chỉ số cho telemetry. Event nurse_call không chứa readings. Đây là lựa chọn contract nguyên mẫu, không có nghĩa cảm biến thực tế luôn đo cùng tần suất.

| Topic | Publisher → Subscriber |
|---|---|
| `hospital/HP/devices/dev-hp01/telemetry` | ESP32 → Platform / Node-RED |
| `hospital/HP/devices/dev-hp01/event` | Nút gọi → Platform / Node-RED |
| `hospital/HP/devices/dev-hp01/config` | Platform → ESP32, retained |
| `hospital/HP/beds/HP-01/lamp/cmd` | Rule/workflow → RGB LED |
| `hospital/HP/beds/HP-01/lamp/ack` | ESP32 → Platform / Node-RED |

REST: `GET /api/health`, `POST /api/login`, `GET /api/state`, `GET /api/patients/:id/history?from=...&to=...&limit=...`, `POST /api/requests/:id/transition`, `PUT /api/rules` (admin), `POST /api/assignments/swap` (admin), `POST /api/emr/confirm`, `POST /api/emr/care`. Ingestion và ACK HTTP yêu cầu Bearer `INGEST_TOKEN`; truy cập giao diện/API nghiệp vụ yêu cầu session.

## Kiểm thử và đánh giá

```powershell
npm test
npm run load-test
```

Trên máy có Node20, thay `npm test` bằng Node24 bundled chạy `--test --test-concurrency=1 tests/*.test.js`, hoặc cài Node24 theo yêu cầu.

`tests/system.test.js`: định danh, rule, lịch sử, workflow, chuyển giường, đến trễ, offline, EMR lỗi/retry, phục hồi DB, chống trùng, nhiễu, ACK, auth/role. `tests/mqtt.test.js`: broker + 6 MQTT client thật + ingestion + lamp ACK. Thử tải 6→10→20→40 nguồn 1 mẫu/giây ghi kết quả thật vào `docs/load-results.json`; đây là smoke test ngắn, không tuyên bố khả năng vận hành bệnh viện.

Đợt rà soát đạt **24/24 kiểm thử**. Workflow GitHub Actions tại `.github/workflows/ci.yml` chạy kiểm thử ứng dụng, định dạng, kiểm tra Compose và biên dịch ma trận sáu firmware khi đẩy mã lên GitHub. Workflow này chưa được chạy trên GitHub trong phiên triển khai.

Chi tiết kiến trúc, giới hạn, nguồn tham chiếu: [docs/architecture.md](docs/architecture.md). Kết quả kiểm chứng và phần chưa thực hiện: [docs/verification.md](docs/verification.md).

## Cấu trúc mã nguồn

```text
server/       API, MQTT, schema SQLite/PostgreSQL, rule và workflow
public/       Dashboard HTML/CSS/JS và SVG charts, không cần build frontend
simulator/    Nhiều thiết bị MQTT độc lập, nhận config + lệnh và trả ACK
firmware/     Template và sáu project ESP32/Wokwi
infra/
  node-red/
    flows.json   MQTT → HTTP ingestion, ACK, trạng thái thiết bị
    settings.js  Cấu hình runtime/editor Node-RED
    prepare.cjs  Nạp flow và MQTT credential khi container khởi động
scripts/      Khởi động Windows, sinh Wokwi, ACL, thử tải
tests/        Domain, HTTP, persistence và MQTT integration
docs/         Kiến trúc IIAF, payload, kết quả kiểm thử
```

Nguyên mẫu phục vụ học tập. Tất cả số đo/bệnh nhân đang demo là giả lập; DS18B20/MPU6050 không đo mạch/SpO₂, biểu đồ mạch không phải ECG. Thay credential demo, bật TLS và bổ sung thẩm định/kiểm soát vận hành trước khi kết nối dữ liệu bệnh viện thật.
