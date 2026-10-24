# VitalCare: IoT Smart Health / CTH619

Hệ thống mô phỏng giám sát chỉ số sinh tồn tại giường, cảnh báo, điều phối chăm sóc và gửi dữ liệu sang EMR sandbox. Hướng dẫn này dành cho người mới tải repository, chạy trên Windows với Docker Desktop và sáu thiết bị ESP32 trong Wokwi for VS Code.

Luồng chạy chính là **Wokwi → Mosquitto → Node-RED → API → PostgreSQL → FlowFuse Dashboard**. Chiều điều khiển là API → MQTT → RGB LED, sau đó thiết bị gửi ACK trở lại qua Node-RED.

> Đây là nguyên mẫu học tập, chỉ dùng bệnh nhân và số đo giả lập. DS18B20/MPU6050 không đo mạch hoặc SpO₂; các chỉ số sinh lý tương ứng được tạo trong firmware và biểu đồ mạch không phải ECG.

## Mục lục

1. [Cài đặt môi trường](#cài-đặt-môi-trường)
2. [Khởi động các service](#khởi-động-các-service)
3. [Khởi động Wokwi devices](#khởi-động-wokwi-devices)
4. [Kiểm tra dữ liệu](#kiểm-tra-dữ-liệu)
5. [Mở dashboard](#mở-dashboard)
6. [Tổng hợp các lệnh CMD](#tổng-hợp-các-lệnh-cmd)

Các khối lệnh `cmd` dưới đây dùng **Windows Command Prompt (CMD)**, chạy tại thư mục gốc `cth619-iot-smart-health` trừ khi có ghi chú khác. Chạy từng lệnh, kiểm tra thành công rồi mới chuyển bước; không dán nguyên khối chứa cả lệnh khởi động và dừng.

## Cài đặt môi trường

### Công cụ cần có

| Công cụ                   | Yêu cầu / mục đích                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Git                       | Clone và cập nhật repository                                                                            |
| Node.js + npm             | Node.js **22.13 trở lên**, khuyến nghị Node.js 24; cài dependency, sinh cấu hình Wokwi và chạy kiểm thử |
| Docker Desktop            | Khởi động Docker Engine và dùng **Linux containers**; có Docker Compose V2 (`docker compose`)           |
| Visual Studio Code        | Mở từng project thiết bị trong cửa sổ riêng                                                             |
| PlatformIO IDE extension  | Cài trong VS Code, chờ hoàn tất khởi tạo PlatformIO Core; dùng để build ESP32                           |
| Wokwi Simulator extension | Cài trong VS Code, kích hoạt quyền sử dụng theo yêu cầu của extension/tài khoản                         |

Kiểm tra công cụ trong một cửa sổ CMD mới sau khi cài đặt. `docker info` phải kết nối được Docker Engine, không chỉ hiển thị thông tin Docker CLI.

```cmd
git --version
node --version
npm --version
docker --version
docker compose version
docker info
code --version
```

Không cần cài PostgreSQL, Mosquitto hoặc Node-RED trực tiếp trên Windows vì các thành phần này chạy trong container. Nếu chưa dùng được lệnh `code`, có thể mở các thư mục bằng **File → Open Folder** trong VS Code.

### Tải mã nguồn và tạo cấu hình

```cmd
git clone https://github.com/khangBio/cth619-iot-smart-health.git
cd cth619-iot-smart-health
npm ci
if not exist .env copy .env.example .env
notepad .env
```

Nếu đã clone repository, chỉ cần mở CMD tại thư mục đó và chạy từ `npm ci`. Không chép đè `.env` đã tùy chỉnh; `.env` được loại khỏi Git để tránh đưa cấu hình riêng lên repository.

Giữ các cổng mặc định sau cho lần chạy đầu. Những dòng khác trong `.env.example` vẫn giữ nguyên, đồng thời có thể bổ sung các biến PostgreSQL/pgAdmin nếu muốn cấu hình rõ ràng:

```dotenv
DEVICE_COUNT=6
DOCKER_MQTT_PORT=1883
DOCKER_HTTP_PORT=3000
DOCKER_NODE_RED_PORT=1880
MQTT_PASSWORD=local-demo-only
INGEST_TOKEN=local-ingest-only
NURSE_PASSWORD=nurse-demo
ADMIN_PASSWORD=admin-demo
POSTGRES_PASSWORD=local-db-only
PGADMIN_EMAIL=admin@example.com
PGADMIN_PASSWORD=pgadmin-demo
PGADMIN_PORT=5050
```

`POSTGRES_PASSWORD` và các biến `PGADMIN_*` chưa có sẵn trong `.env.example`; nếu không bổ sung thì Compose dùng các giá trị mặc định ở trên. `DATABASE_URL=` trong `.env` dành cho chế độ local; Compose tự truyền URL PostgreSQL cho API nên không cần điền URL database trên Windows.

Các mật khẩu mặc định chỉ dành cho demo cá nhân. Trước khi chia sẻ triển khai, thay mật khẩu, `SESSION_SECRET`, `INGEST_TOKEN`, `EMR_TOKEN`; không commit `.env` hoặc firmware chứa credential riêng, và không công khai Node-RED editor khi chưa bổ sung xác thực/TLS.

### Chọn cổng và đồng bộ firmware

| Thành phần          | Từ Windows / trình duyệt | Bên trong Docker |
| ------------------- | ------------------------ | ---------------- |
| MQTT                | `127.0.0.1:1883`         | `mosquitto:1883` |
| HTTP API            | `127.0.0.1:3000`         | `api:3000`       |
| Node-RED / FlowFuse | `127.0.0.1:1880`         | `node-red:1880`  |
| PostgreSQL          | Không publish ra Windows | `postgres:5432`  |
| pgAdmin, tùy chọn   | `127.0.0.1:5050`         | `pgadmin:80`     |

Nếu cổng đã bị chiếm, đổi `DOCKER_MQTT_PORT=1885` và `DOCKER_HTTP_PORT=3001` trong `.env`, rồi dùng cổng mới trong các lệnh kiểm tra/truy cập bên dưới. Không đổi địa chỉ nội bộ `mosquitto:1883` hoặc `api:3000` trong Compose/flow sang cổng host.

**Firmware lưu trong repository có thể đang dùng cổng `1885/3001`, khác mặc định `1883/3000` của `.env.example`.** Sau khi chốt `.env`, phải đồng bộ cấu hình rồi build trước khi chạy Wokwi; bước sinh cấu hình nằm ở phần khởi động Wokwi bên dưới.

## Khởi động các service

### Chạy bộ Docker chính

Mở Docker Desktop và chờ Engine sẵn sàng, sau đó chạy các lệnh dưới đây tại thư mục gốc repository. Chưa chạy `npm run demo` hoặc simulator phần mềm nếu định dùng sáu thiết bị Wokwi.

```cmd
docker compose config --quiet
docker compose up --build -d
docker compose ps -a
docker compose logs --tail 100 api node-red mosquitto
```

| Service       | Vai trò                                                      | Trạng thái mong đợi                                 |
| ------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| `postgres`    | Lưu dữ liệu trong volume `postgres-data`                     | Running / healthy                                   |
| `broker-init` | Sinh tài khoản và ACL MQTT trong volume `mqtt-config`        | **Exited (0)** là bình thường, vì chỉ chạy khởi tạo |
| `mosquitto`   | MQTT broker, bắt buộc credential và ACL theo thiết bị        | Running                                             |
| `api`         | Kiểm tra bản tin, lưu DB, rule, workflow, EMR, phát lệnh đèn | Running / healthy                                   |
| `node-red`    | Nhận MQTT, gọi API và phục vụ FlowFuse Dashboard             | Running                                             |

API tự khởi tạo schema và dữ liệu định danh khi khởi động; không cần import `server/schema.sql` thủ công. Chỉ chạy service chưa tạo ra số đo mới: phải khởi động Wokwi hoặc chọn simulator thay thế.

Trong chế độ Docker, `INGEST_VIA_NODE_RED=true` nên API không subscribe dữ liệu đầu vào trực tiếp. Nếu Node-RED dừng, telemetry và ACK không tự chuyển sang đường nhận khác.

### Simulator phần mềm thay thế Wokwi

Chỉ dùng lựa chọn này khi muốn thử nhanh hệ thống mà chưa chạy Wokwi. Simulator dùng cùng các device ID, vì vậy **không chạy đồng thời hai nguồn cho cùng thiết bị**.

```cmd
docker compose --profile simulator up --build -d simulator
```

Trước khi chuyển sang Wokwi, dừng riêng simulator bằng lệnh sau. Các service API, Node-RED, Mosquitto và PostgreSQL vẫn hoạt động.

```cmd
docker compose --profile simulator stop simulator
```

## Khởi động Wokwi devices

### Sinh cấu hình theo `.env`

Repository có sáu project độc lập từ `firmware/dev-hp01` đến `firmware/dev-hp06`, mỗi project có `config.h`, `platformio.ini`, `wokwi.toml`, `diagram.json` và `sketch.ino`. Sinh lại cấu hình tại thư mục gốc để đồng bộ cổng và mật khẩu với Docker:

> `wokwi:generate` ghi đè `config.h`, `diagram.json`, `sketch.ino`, `libraries.txt`, `platformio.ini` và `wokwi.toml` trong các project được sinh. Sao lưu chỉnh sửa mạch/sketch riêng trước khi chạy; với bản clone mới có thể dùng trực tiếp.

```cmd
npm run wokwi:generate
type firmware\dev-hp01\config.h
```

Đối chiếu các trường sau trước khi build. Mỗi thiết bị phải giữ `DEVICE_ID`, assignment và credential riêng; không sao chép `config.h` hoặc binary giữa các giường.

| Trường          | Giá trị mong đợi khi dùng cổng mặc định                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DEVICE_ID`     | `dev-hp01` đến `dev-hp06`, tương ứng thư mục                                                                                |
| `MQTT_HOST`     | `host.wokwi.internal`                                                                                                       |
| `MQTT_PORT`     | `1883`, lấy từ `WOKWI_MQTT_PORT`, nếu không có thì `DOCKER_MQTT_PORT`                                                       |
| `TIME_SYNC_URL` | `http://host.wokwi.internal:3000/api/time`, cổng lấy từ `WOKWI_HTTP_PORT`, nếu không có thì `DOCKER_HTTP_PORT`              |
| `MQTT_PASSWORD` | Credential thiết bị do generator tính từ `MQTT_PASSWORD` trong `.env`; không phải chép nguyên mật khẩu tài khoản `platform` |

Wokwi for VS Code dùng gateway để truy cập dịch vụ trên máy host qua `host.wokwi.internal`; `127.0.0.1` trong ESP32 không phải máy Windows. Xem [cấu hình IoT Gateway của Wokwi](https://docs.wokwi.com/vscode/project-config#iot-gateway-esp32-wifi) nếu kết nối bị chặn; Wokwi Web cần thiết lập gateway riêng và không phải luồng chạy chính của hướng dẫn này.

### Build firmware

Build thử `dev-hp01` trước, sau đó build cả sáu thiết bị. Script PowerShell dưới đây gọi được từ CMD, tự tìm PlatformIO tại `%USERPROFILE%\.platformio\penv\Scripts\pio.exe` hoặc lệnh `pio` trong PATH.

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-firmware.ps1 -Devices dev-hp01
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-firmware.ps1
```

Chỉ tiếp tục khi script báo build thành công. Mỗi thư mục device phải có hai artifact mà `wokwi.toml` đang trỏ tới:

```text
firmware/dev-hp01/.pio/build/esp32dev/firmware.bin
firmware/dev-hp01/.pio/build/esp32dev/firmware.elf
```

Lần đầu PlatformIO cần tải platform, toolchain và thư viện, nên chờ một lượt build hoàn tất trước khi build từ cửa sổ khác. Không sửa đường dẫn `wokwi.toml` để né lỗi thiếu binary; phải sửa lỗi build trước.

### Mở và chạy từng thiết bị

Mở `dev-hp01` trong một cửa sổ VS Code riêng bằng lệnh sau, hoặc dùng **File → Open Folder**. Workspace phải là thư mục device để Wokwi tìm đúng `wokwi.toml` và binary tương ứng.

```cmd
code -n firmware\dev-hp01
```

1. Nhấn **F1** hoặc **Ctrl+Shift+P**, chọn **Wokwi: Start Simulator**.
2. Không chọn **Start Simulator and Wait for Debugger** nếu không dùng debugger.
3. Mở Serial Monitor, kiểm tra có JSON telemetry; nếu thấy `TIME SYNC failed`, kiểm tra cổng HTTP API và gateway.
4. Kiểm tra dữ liệu của `dev-hp01` theo phần tiếp theo, rồi mở năm cửa sổ còn lại:

```cmd
code -n firmware\dev-hp02
code -n firmware\dev-hp03
code -n firmware\dev-hp04
code -n firmware\dev-hp05
code -n firmware\dev-hp06
```

Tại mỗi cửa sổ, thực hiện lại **Wokwi: Start Simulator** và giữ mô phỏng hoạt động. **Build firmware và mở VS Code không tự khởi động Wokwi, không tự phát MQTT**; sau khi build lại phải Stop rồi Start Simulator để nạp binary mới.

## Kiểm tra dữ liệu

### Kiểm tra API và đồng bộ thời gian

Chạy hai lệnh sau từ CMD; thay `3000` bằng `DOCKER_HTTP_PORT` nếu đã đổi cổng. Kết quả `/api/health` mong đợi sau khi kết nối hoàn tất như ví dụ bên dưới, còn `/api/time` phải trả về `epoch_ms`.

```cmd
curl.exe http://127.0.0.1:3000/api/health
curl.exe http://127.0.0.1:3000/api/time
```

```json
{ "ok": true, "database": "PostgreSQL", "mqtt": true, "demo": false }
```

Health check thành công chỉ xác nhận tình trạng cơ bản của API; `mqtt:true` không chứng minh telemetry đã đi qua Node-RED và được ghi DB. Tiếp tục kiểm tra flow và số bản tin thực tế.

### Kiểm tra MQTT và Node-RED

Mở [Node-RED editor](http://127.0.0.1:1880), chọn flow **Smart Health · IoT integration** và kiểm tra MQTT node báo connected. Flow được nạp tự động, không cần import thủ công; dùng sidebar Debug để xem lỗi tích hợp và lệnh sau để theo dõi log:

```cmd
docker compose logs -f --tail 100 mosquitto node-red api
```

Nhấn **Ctrl+C** để dừng theo dõi log, không phải dừng container. Topic của giường HP-01 có dạng:

| Topic                                    | Nội dung                                 |
| ---------------------------------------- | ---------------------------------------- |
| `hospital/HP/devices/dev-hp01/telemetry` | Số đo từ ESP32                           |
| `hospital/HP/devices/dev-hp01/event`     | Sự kiện nút gọi điều dưỡng               |
| `hospital/HP/devices/dev-hp01/status`    | Trạng thái thiết bị                      |
| `hospital/HP/devices/dev-hp01/config`    | Cấu hình assignment từ backend, retained |
| `hospital/HP/beds/HP-01/lamp/cmd`        | Lệnh RGB LED từ backend                  |
| `hospital/HP/beds/HP-01/lamp/ack`        | Xác nhận lệnh từ thiết bị                |

Node-RED chuyển `/telemetry` và `/event` đến `POST /api/ingest`, `/status` đến `POST /api/device-status`, `/ack` đến `POST /api/ack`. Flow bỏ qua `/config` và `/cmd` để không nhận ngược lệnh đầu ra thành telemetry.

### Kiểm tra PostgreSQL bằng CMD

Không cần cài `psql` trên Windows hoặc mở cổng PostgreSQL ra host. Dùng `psql` có sẵn trong container để kiểm tra bảng và dữ liệu:

```cmd
docker compose exec postgres pg_isready -U health -d smart_health
docker compose exec postgres psql -U health -d smart_health -c "\dt"
docker compose exec postgres psql -U health -d smart_health -c "SELECT count(*) AS total_messages FROM messages;"
docker compose exec postgres psql -U health -d smart_health -c "SELECT count(*) AS total_measurements FROM measurements;"
docker compose exec postgres psql -U health -d smart_health -c "SELECT device_id, count(*) AS total, max(received_at) AS latest_received_at FROM messages GROUP BY device_id ORDER BY device_id;"
docker compose exec postgres psql -U health -d smart_health -c "SELECT measured_at, code, value, unit, quality, source FROM measurements WHERE patient_id='BN-001' ORDER BY measured_at DESC LIMIT 16;"
```

Chạy lại các câu đếm sau vài giây khi Wokwi đang phát dữ liệu; tổng bản tin/phép đo phải tăng và thời điểm nhận phải cập nhật cho các thiết bị đang chạy. Một telemetry hợp lệ có tám chỉ số, nhưng `messages` còn chứa event nên không kỳ vọng tổng `measurements` luôn bằng tám lần tổng `messages`.

Nếu database có dữ liệu cũ, số lượng lớn hơn 0 chưa đủ chứng minh hệ thống đang nhận dữ liệu mới. Đối chiếu `latest_received_at`, thời gian đo, thời gian hiện tại và đúng device ID; các cột thời gian trong schema dùng TEXT, cần ép `::timestamptz` khi tính độ trễ trong SQL.

### Mở pgAdmin để xem dữ liệu trực quan

pgAdmin là giao diện quản trị SQL tùy chọn, không phải PostgreSQL service hoặc dashboard bệnh nhân. Khởi động bằng cả hai file Compose:

```cmd
docker compose -f compose.yaml -f compose.pgadmin.yaml up -d pgadmin
```

Mở [pgAdmin](http://127.0.0.1:5050), đăng nhập `admin@example.com / pgadmin-demo` nếu chưa thay `PGADMIN_EMAIL`/`PGADMIN_PASSWORD`. Chọn **Servers → Register → Server**, đặt tên `Smart Health`, rồi nhập:

| Trường Connection    | Giá trị                                                           |
| -------------------- | ----------------------------------------------------------------- |
| Host name/address    | `postgres`, không dùng `127.0.0.1`                                |
| Port                 | `5432`                                                            |
| Maintenance database | `smart_health`                                                    |
| Username             | `health`                                                          |
| Password             | `POSTGRES_PASSWORD` lúc khởi tạo volume, mặc định `local-db-only` |

Chọn **Databases → smart_health → Schemas → public → Tables** để xem bảng hoặc mở **Query Tool** để chạy SQL. Tài khoản pgAdmin, PostgreSQL và dashboard là ba loại riêng biệt; sửa biến mật khẩu trong `.env` không tự đổi mật khẩu đã lưu trong volume PostgreSQL/pgAdmin.

Bộ truy vấn có sẵn tại [docs/sql/postgres-exploration.sql](docs/sql/postgres-exploration.sql), bao gồm số đo, độ trễ, cảnh báo, ACK và EMR. Hướng dẫn vẽ biểu đồ từ kết quả SQL nằm trong [docs/postgres-visualization.md](docs/postgres-visualization.md).

## Mở dashboard

### Truy cập và đăng nhập

Mở [FlowFuse Dashboard](http://127.0.0.1:1880/dashboard), giao diện chính của bộ Docker. Nếu đã đổi `DOCKER_NODE_RED_PORT`, thay `1880` bằng cổng đã chọn; mở trang gốc API cũng sẽ chuyển hướng đến dashboard.

| Vai trò    | Tài khoản | Mật khẩu demo                                           |
| ---------- | --------- | ------------------------------------------------------- |
| Điều dưỡng | `nurse`   | `nurse-demo` hoặc giá trị `NURSE_PASSWORD` trong `.env` |
| Quản trị   | `admin`   | `admin-demo` hoặc giá trị `ADMIN_PASSWORD` trong `.env` |

Sau đăng nhập, mở **Tổng quan**, kiểm tra sáu giường và thời điểm số đo mới nhất. Vào **Theo dõi bệnh nhân** để xem biểu đồ, phiếu chức năng sống, payload, chất lượng/nguồn cảm biến và xuất CSV; vào **Thiết bị IoT** để đối chiếu device ID, đèn và ACK.

### Kiểm tra một vòng cảnh báo

1. Trong Wokwi của `dev-hp01`, xoay biến trở GPIO34 lên trên khoảng 68% để tạo SpO₂ thấp, hoặc tăng nhiệt độ DS18B20 để tạo kịch bản sốt.
2. Chờ đủ thời gian duy trì của rule và chu kỳ làm mới dashboard; với kịch bản SpO₂ demo, chờ ít nhất khoảng 5 giây cộng chu kỳ UI 3 giây.
3. Kiểm tra cảnh báo, yêu cầu chăm sóc, đèn đúng giường và `ACTUATOR ACK` trên Serial Monitor khi thiết bị xác nhận lệnh.
4. Vào **Yêu cầu chăm sóc**, thực hiện tiếp nhận → đến giường → đang xử lý.
5. Đưa cảm biến/biến trở về bình thường, chờ rule phục hồi; nhập ghi nhận và hoàn tất công việc. Cảnh báo hết không tự hoàn tất yêu cầu chăm sóc.
6. Thử nút GPIO13 để gọi điều dưỡng; nếu cần, xác nhận số đo/ghi nhận chăm sóc rồi xem kết quả tại **Đồng bộ EMR**.

Nếu dashboard báo không có số đo mới, kiểm tra Wokwi đã Start, simulator không bị tạm dừng, đồng bộ thời gian thành công và số dòng DB đang tăng. Lịch sử còn trong DB không có nghĩa thiết bị đang online; xem thêm [hướng dẫn FlowFuse Dashboard](docs/flowfuse-dashboard.md) và [kịch bản demo](docs/demo-scenario.md).

## Tổng hợp các lệnh CMD

### Build và mở Wokwi

| Mục đích                                   | Lệnh chạy tại thư mục gốc                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Cài dependency theo lockfile               | `npm ci`                                                                                           |
| Sinh lại project/config theo `.env`        | `npm run wokwi:generate`                                                                           |
| Build sáu thiết bị tuần tự                 | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-firmware.ps1`                   |
| Build riêng HP-01                          | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-firmware.ps1 -Devices dev-hp01` |
| Build trực tiếp nếu `pio` đã có trong PATH | `pio run --project-dir firmware/dev-hp01 --environment esp32dev`                                   |
| Mở HP-01                                   | `code -n firmware\dev-hp01`                                                                        |

Generator có ghi đè file, cần sao lưu tùy chỉnh trước khi dùng. Sau khi build/mở project, vẫn phải nhấn **F1 → Wokwi: Start Simulator** trong từng cửa sổ; bảng này không có lệnh CMD tự khởi động sáu mô phỏng.

### Docker Compose: service và vận hành

| Mục đích                                                     | Lệnh                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| Kiểm tra cấu hình, không in giá trị secret                   | `docker compose config --quiet`                              |
| Build và khởi động bộ chính                                  | `docker compose up --build -d`                               |
| Chạy lại bộ chính, không yêu cầu rebuild                     | `docker compose up -d`                                       |
| Xem cả container đang chạy và đã thoát                       | `docker compose ps -a`                                       |
| Theo dõi log                                                 | `docker compose logs -f --tail 100 api node-red mosquitto`   |
| Build lại backend sau khi sửa JS                             | `docker compose up -d --build --no-deps api`                 |
| Build lại image Node-RED khi đổi dependency/Dockerfile       | `docker compose up -d --build --no-deps node-red`            |
| Cập nhật bản export dashboard sau khi sửa Vue/CSS/SVG        | `npm run flowfuse:build`                                     |
| Nạp lại flow/dashboard từ mã nguồn                           | `docker compose restart node-red`                            |
| Chạy simulator thay Wokwi                                    | `docker compose --profile simulator up --build -d simulator` |
| Dừng riêng simulator                                         | `docker compose --profile simulator stop simulator`          |
| Dừng bộ chính và simulator, giữ container/volume             | `docker compose --profile simulator stop`                    |
| Gỡ container/network bộ chính và simulator, giữ named volume | `docker compose --profile simulator down`                    |

`restart` không áp dụng lại biến môi trường đã thay trong `.env`; dùng `docker compose up -d` để Compose tạo lại service có cấu hình thay đổi. Nếu đổi `MQTT_PASSWORD` hoặc `DEVICE_COUNT`, cần tái tạo broker config và các service liên quan bằng lệnh dưới đây, sau đó sinh/build lại firmware tương ứng:

```cmd
docker compose up -d --build --force-recreate broker-init mosquitto api node-red
```

Nếu tăng số thiết bị, generator đọc `DEVICE_COUNT` nhưng script build mặc định vẫn chỉ build sáu thiết bị ban đầu. Build thêm từng device bằng tham số `-Devices` trước khi mở Wokwi.

### Docker Compose: PostgreSQL và pgAdmin

| Mục đích                                       | Lệnh                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Chỉ khởi động PostgreSQL                       | `docker compose up -d postgres`                                                                   |
| Xem trạng thái database                        | `docker compose ps postgres`                                                                      |
| Kiểm tra PostgreSQL sẵn sàng                   | `docker compose exec postgres pg_isready -U health -d smart_health`                               |
| Theo dõi log PostgreSQL                        | `docker compose logs -f --tail 100 postgres`                                                      |
| Mở phiên SQL tương tác                         | `docker compose exec postgres psql -U health -d smart_health`                                     |
| Đếm bản tin                                    | `docker compose exec postgres psql -U health -d smart_health -c "SELECT count(*) FROM messages;"` |
| Sao lưu DB ra file trên Windows, dùng CMD      | `docker compose exec -T postgres pg_dump -U health -d smart_health > smart_health_backup.sql`     |
| Dừng riêng PostgreSQL                          | `docker compose stop postgres`                                                                    |
| Khởi động pgAdmin và dependency PostgreSQL     | `docker compose -f compose.yaml -f compose.pgadmin.yaml up -d pgadmin`                            |
| Xem trạng thái pgAdmin                         | `docker compose -f compose.yaml -f compose.pgadmin.yaml ps pgadmin`                               |
| Xem log pgAdmin                                | `docker compose -f compose.yaml -f compose.pgadmin.yaml logs --tail 100 pgadmin`                  |
| Dừng riêng pgAdmin, giữ bộ chính chạy          | `docker compose -f compose.yaml -f compose.pgadmin.yaml stop pgadmin`                             |
| Dừng toàn bộ, gồm pgAdmin và simulator         | `docker compose -f compose.yaml -f compose.pgadmin.yaml --profile simulator stop`                 |
| Gỡ toàn bộ container/network, giữ named volume | `docker compose -f compose.yaml -f compose.pgadmin.yaml --profile simulator down`                 |

Trong phiên `psql`, dùng `\dt` để xem bảng, `\d measurements` để xem cấu trúc và `\q` để thoát; SQL kết thúc bằng dấu chấm phẩy. Chỉ khởi động PostgreSQL chưa tạo schema nghiệp vụ nếu API chưa chạy lần nào, và dừng PostgreSQL khi API đang dùng sẽ làm gián đoạn hệ thống.

Các lệnh `stop`/`down` ở trên giữ dữ liệu trong named volume. **Không thêm `-v` vào `docker compose down` nếu cần giữ dữ liệu** vì tùy chọn này xóa các named volume thuộc cấu hình, gồm database và dữ liệu Node-RED/pgAdmin tương ứng; file backup SQL cũng có thể chứa dữ liệu nhạy cảm nên không commit hoặc chia sẻ tùy tiện.

## Xử lý lỗi thường gặp

| Hiện tượng                                     | Kiểm tra / cách xử lý                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker không kết nối Engine                    | Mở Docker Desktop, dùng Linux containers, chờ Engine sẵn sàng rồi chạy `docker info`                                                         |
| `ports are not available` / cổng bị chiếm      | Đổi `DOCKER_*_PORT` trong `.env`, chạy lại Compose; nếu đổi MQTT/API thì sinh config và build lại Wokwi                                      |
| Không tìm thấy `pio`                           | Mở PlatformIO IDE trong VS Code, chờ cài Core; ưu tiên `scripts/build-firmware.ps1` vì script tự tìm `pio.exe`                               |
| PlatformIO báo `UnknownPlatform`               | Kiểm tra/cài lại platform đúng phiên bản `espressif32@6.9.0` trong `platformio.ini`; không build nhiều lượt cùng lúc khi đang tải dependency |
| Wokwi báo `firmware binary ... not found`      | Build đúng device đến khi SUCCESS, kiểm tra `.bin`/`.elf`, mở đúng thư mục device                                                            |
| MQTT không kết nối / lỗi xác thực              | Kiểm tra gateway, cổng `MQTT_PORT`, service Mosquitto và credential; nếu đổi secret, tái tạo broker config, sinh và build firmware lại       |
| `TIME SYNC failed`                             | `TIME_SYNC_URL` phải trỏ tới cổng HTTP API, không phải MQTT hoặc dashboard; kiểm tra `/api/time` và gateway                                  |
| API healthy nhưng không có số đo               | Start Wokwi, kiểm tra Node-RED connected, lỗi ingestion/token trong log, rồi truy vấn số bản tin mới                                         |
| Thiết bị liên tục reconnect                    | Kiểm tra simulator phần mềm và Wokwi có chạy trùng device ID hay không                                                                       |
| pgAdmin không kết nối database                 | Host là `postgres`, port `5432`; dùng mật khẩu PostgreSQL lúc khởi tạo volume, không dùng mật khẩu giao diện pgAdmin                         |
| `relation ... does not exist` khi chạy SQL     | Khởi động API để tạo schema; xác nhận đang kết nối database `smart_health` của đúng bộ Compose                                               |
| Dashboard có lịch sử nhưng không có số đo live | Kiểm tra tuổi mẫu, đồng bộ thời gian và trạng thái mô phỏng; không dùng dữ liệu cũ để kết luận thiết bị online                               |

Flow Node-RED hiện chưa có hàng đợi bền vững để gửi lại telemetry khi HTTP API bị gián đoạn. Không sửa trực tiếp các node do hệ thống quản lý trong editor nếu muốn giữ thay đổi qua restart; chỉnh file nguồn trong `infra/node-red` theo [hướng dẫn vận hành dashboard](docs/flowfuse-dashboard.md).

## Kiểm thử, chế độ local và tài liệu

### Kiểm thử ứng dụng

Các lệnh dưới đây dùng Node.js 22.13 trở lên, khuyến nghị Node.js 24. `load-test` ghi kết quả vào `docs/load-results.json`; đây là phép thử tải ngắn cho nguyên mẫu, không chứng nhận khả năng vận hành bệnh viện.

```cmd
npm test
npm run format:check
npm run load-test
```

GitHub Actions tại [`.github/workflows/ci.yml`](.github/workflows/ci.yml) cấu hình kiểm thử ứng dụng, định dạng, Compose và build ma trận sáu firmware. Kết quả thực tế cần xem ở từng lần chạy CI, không suy ra từ việc README có liệt kê lệnh.

### Demo local cũ, không dùng Docker

Chế độ này chỉ để thử giao diện HTML cũ trong `public/`, dùng broker Aedes, SQLite và simulator phần mềm; không chạy FlowFuse hoặc Node-RED. Không chạy cùng bộ Docker trên các cổng trùng nhau; nếu cần chạy song song, đổi cổng local trong `.env` trước:

```dotenv
PORT=3002
MQTT_PORT=1884
MQTT_URL=mqtt://127.0.0.1:1884
```

```cmd
npm run demo
```

Với cấu hình local ở trên, mở [dashboard HTML local](http://127.0.0.1:3002); nếu giữ `PORT=3000` thì dùng cổng 3000 khi không trùng Docker. Dữ liệu local nằm tại `data/health.db`, không nằm trong PostgreSQL của Compose.

### Cấu trúc repository và tài liệu bổ sung

```text
compose.yaml                 PostgreSQL, broker-init, Mosquitto, API, Node-RED, simulator
compose.pgadmin.yaml         pgAdmin tùy chọn
.env.example                 Mẫu cấu hình môi trường
server/                      API, schema, MQTT, rule, workflow và EMR
firmware/                    Template và sáu project ESP32/Wokwi
infra/node-red/              Flow tích hợp, FlowFuse Dashboard, proxy và runtime
scripts/                     Build firmware, sinh Wokwi, broker config, thử tải
simulator/                   Thiết bị MQTT mô phỏng bằng Node.js
public/                      Giao diện HTML cho demo local cũ
tests/                       Kiểm thử nghiệp vụ, MQTT và FlowFuse
docs/                        Kiến trúc, kịch bản, SQL và kết quả kiểm chứng
```

- **Kiến trúc:** [docs/architecture.md](docs/architecture.md), [docs/iiaf-project-flow.md](docs/iiaf-project-flow.md).
- **Dashboard:** [docs/flowfuse-dashboard.md](docs/flowfuse-dashboard.md), hướng dẫn chỉnh sửa, vận hành và bảo toàn flow.
- **Database:** [docs/postgres-visualization.md](docs/postgres-visualization.md), [docs/sql/postgres-exploration.sql](docs/sql/postgres-exploration.sql).
- **Payload và kiểm chứng:** [docs/payload.example.json](docs/payload.example.json), [docs/verification.md](docs/verification.md), [docs/data-processing-verification.md](docs/data-processing-verification.md).
- **Demo và yêu cầu bài tập:** [docs/demo-scenario.md](docs/demo-scenario.md), [docs/answers-requirements-5-13.md](docs/answers-requirements-5-13.md).
