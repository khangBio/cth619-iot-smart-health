# Kịch bản demo Smart Health — Wokwi, FlowFuse và PostgreSQL

Chuẩn bị ngày 12/10/2026, đối chiếu firmware, backend, giao diện và cấu hình đang lưu trong PostgreSQL. Đây là kịch bản để thực hiện và ghi minh chứng, không phải biên bản khẳng định tất cả tình huống đã chạy thành công.

## 1. Mục tiêu, thời lượng và vai trò

- Chuẩn bị trước buổi trình bày: 10–15 phút, không tính thời gian tải image/build lần đầu.
- Demo chính: khoảng 15–20 phút tùy tốc độ Wokwi và thao tác.
- Demo mở rộng: thêm 5–10 phút nếu cần kiểm chứng MPU6050, escalation và đổi giường.
- Người A điều khiển Wokwi và trình bày kiến trúc; người B thao tác Dashboard vai trò nurse; người C trình bày Node-RED và SQL. Một người cũng có thể thực hiện tuần tự.

Thông điệp mở đầu: “Hệ thống theo dõi sáu giường. Mỗi giường có ESP32 với DS18B20 và MPU6050. Dữ liệu được định danh bệnh nhân, lưu PostgreSQL và kiểm tra quy tắc. Khi phát hiện tình huống cần hỗ trợ, hệ thống tạo công việc, điều khiển đèn và theo dõi quá trình điều dưỡng xử lý.”

## 2. Chuẩn bị trước demo

### Khởi động dịch vụ

Chạy PowerShell trong thư mục project:

```powershell
docker compose up -d
docker compose --profile simulator stop simulator
docker compose ps
```

Nếu vừa sửa code cần đóng gói lại image thì dùng `docker compose up --build -d`. Dừng simulator Docker để chỉ Wokwi phát cho các device ID này. Không chạy `npm run demo` hoặc simulator riêng song song cùng ID.

Mở các cửa sổ:

| Cửa sổ | Địa chỉ / nội dung |
|---|---|
| FlowFuse Dashboard | http://127.0.0.1:1880/dashboard |
| Node-RED editor | http://127.0.0.1:1880 |
| VS Code | Sáu workspace `firmware/dev-hp01` … `firmware/dev-hp06` |
| pgAdmin nếu dùng | http://127.0.0.1:5050 |

pgAdmin khởi động tùy chọn:

```powershell
docker compose -f compose.yaml -f compose.pgadmin.yaml up -d pgadmin
```

Dashboard đăng nhập mặc định `nurse / nurse-demo`; dùng `admin / admin-demo` cho phần quản trị. Nếu đã thay mật khẩu trong `.env`, dùng mật khẩu đã cấu hình. Đăng nhập admin trong cửa sổ riêng/ẩn danh nếu cần giữ phiên nurse.

Build nếu firmware đã thay đổi hoặc chưa có binary:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-firmware.ps1
```

Start Simulator trong từng workspace Wokwi, dùng Private IoT Gateway như cấu hình project. Build không tự chạy mô phỏng. Nếu vừa build lại thì Stop/Start để nạp binary mới.

### Xác nhận điều kiện đầu vào

1. Sáu phiên Wokwi chạy với sáu ID khác nhau; kiểm tra cả sáu giường có telemetry mới. Sáu thư mục firmware hoặc sáu dòng DB không thay thế minh chứng sáu thiết bị đang chạy.
2. Để biến trở tất cả thiết bị về thấp/0; DS18B20 ở 36,8°C; MPU6050 ở trạng thái ban đầu.
3. Chờ mỗi thiết bị có mẫu mới; xử lý các công việc tồn đọng qua Dashboard nếu cần một lượt trình bày sạch. Không xóa dữ liệu cũ. Ghi thời điểm bắt đầu demo để phân biệt lịch sử.
4. Xác nhận assignment hiện tại. Các ví dụ HP-01/BN-001, HP-02/BN-002 chỉ đúng khi chưa hoán đổi bệnh nhân; ưu tiên mã đang hiển thị trên Dashboard.
5. Node-RED MQTT báo connected; kiểm tra topic `/telemetry`, không nhầm `/lamp/cmd` là dữ liệu cảm biến.
6. Đèn mục tiêu ban đầu tắt khi không còn cảnh báo active ưu tiên khác. Nếu không, xem danh sách alarms và trạng thái ACK trước khi tiếp tục.

### Tham số đã kiểm tra trong DB

| Tham số | Giá trị tại lúc soạn |
|---|---:|
| spo2Low | 92 |
| pulseLow / pulseHigh | 50 / 120 |
| temperatureHigh | 38,5°C |
| sustainSeconds / recoverySeconds | 5 / 5 giây |
| offlineSeconds / maxLiveAgeSeconds | 60 / 60 giây |
| escalationSeconds | 60 giây |
| rules version | 3 |

Đọc lại trước buổi demo vì có thể thay đổi qua Quản trị:

```sql
SELECT value::jsonb FROM settings WHERE id = 'rules';
```

Thời gian 5 giây được đánh giá từ các mẫu hợp lệ; không cam kết giao diện đổi chính xác sau 5 giây thực. Chờ thêm chu kỳ lấy mẫu, worker và polling Dashboard. Kiểm tra kết quả trên UI/DB để chuyển bước.

## 3. Demo chính

### D1 — Chứng minh sáu thiết bị và dữ liệu định danh (2 phút)

**Thao tác:** Mở Tổng quan, chỉ sáu giường có dữ liệu mới; chọn HP-01 vào Theo dõi bệnh nhân. Hiển thị mạch, SpO₂, nhiệt độ, huyết áp, nhịp thở, cân nặng; mở biểu đồ và phiếu chức năng sống. Mở payload/cảm biến, chỉ `device_id`, `bed_id`, `patient_id`, `encounter_id`, `assignment_id`, `measured_at`, `sensor_id`, `sensor_type`, `quality`, `source`.

**Kết quả:** Mẫu đo và biểu đồ cập nhật; DS18B20/MPU6050 có source `wokwi`; các kênh sinh lý tạo bởi firmware có source `simulated`. Một telemetry có tám readings, tương ứng tám dòng measurements.

**Bảng chứng minh:** patients, encounters, beds, devices, assignments, messages, measurements. Dùng câu 01–04 và 12 trong `docs/sql/postgres-exploration.sql`.

**Lời trình bày:** “Giường không được dùng làm mã bệnh nhân. Mỗi mẫu chứa đầy đủ định danh; backend đối chiếu với assignment có hiệu lực trước khi chấp nhận.”

**Minh chứng:** Ảnh Tổng quan đủ sáu giường có dữ liệu mới, một payload định danh và một phiếu chức năng sống. SQL count chỉ hỗ trợ, không tự chứng minh thiết bị còn online.

### D2 — Gọi điều dưỡng và hoàn tất chăm sóc (2–3 phút)

**Thiết bị:** HP-02, đang bình thường, không có cảnh báo ưu tiên khác.

**Thao tác:**

1. Nhấn rồi thả nút “Gọi điều dưỡng” trên Wokwi HP-02.
2. Mở Yêu cầu chăm sóc, tìm đúng bệnh nhân/giường và loại gọi điều dưỡng.
3. Bấm “Xem / xử lý”, chọn “Đã tiếp nhận”. Hộp thoại đóng sau mỗi bước; mở lại để chọn “Đã đến giường”, rồi “Đang xử lý”.
4. Nhập ghi chú `Demo: đã đến giường, hỗ trợ yêu cầu và xác nhận hoàn tất.`; bấm “Hoàn tất”.

**Kết quả:** Có sự kiện nurse_call, công việc Chờ tiếp nhận và đèn xanh dương. Khi hoàn tất, công việc completed, có care record và đèn tắt nếu không còn cảnh báo khác. Đèn xanh không tự chuyển sang đỏ khi tiếp nhận một nurse_call.

**Bảng chứng minh:** messages lưu event nhưng không tạo measurements; alarms, requests, request_events, commands, care_records, audit_logs. Dùng SQL 08 và 10, cùng timeline trên UI.

**Lời trình bày:** “Hệ thống quản lý cả tình trạng cần hỗ trợ và trách nhiệm xử lý. Lịch sử ghi người thực hiện và thời điểm từng bước.”

### D3 — SpO₂ thấp, mạch cao và vòng điều khiển đèn (3–4 phút)

**Thiết bị:** HP-01, ban đầu bình thường; MPU6050 không bị đặt chuyển động mạnh.

**Thao tác:**

1. Vặn biến trở Wokwi lên tối đa để chắc chắn vượt điều kiện ADC > 2800 trong firmware.
2. Giữ trạng thái và chờ nhận đủ mẫu hợp lệ qua thời gian sustain.
3. Quan sát SpO₂ khoảng 86–88%, mạch khoảng 126–132 lần/phút, hai cảnh báo và đèn đỏ nhấp nháy.
4. Mở hai yêu cầu `SpO₂ dưới ngưỡng` và `Mạch bất thường`; tiếp nhận cả hai.
5. Quan sát đèn chuyển đỏ liên tục khi không còn yêu cầu sinh tồn active ở bước assigned.
6. Mở Thiết bị IoT, xem mode/ACK; trong Node-RED đối chiếu `/lamp/cmd` với `/lamp/ack` bằng command_id.

**Kết quả:** Hai yêu cầu có thể xuất hiện ở các mẫu khác nhau nhưng cuối cùng đều được tạo nếu chất lượng valid và điều kiện duy trì. Một yêu cầu sinh tồn chưa tiếp nhận vẫn giữ đèn nhấp nháy.

**Bảng chứng minh:** settings, rule_state, alarms, requests, request_events, commands. Câu SQL 08/10 chứng minh cảnh báo, công việc và ACK.

**Lời trình bày:** “Biến trở điều khiển kịch bản, không phải cảm biến SpO₂. Quy tắc chạy ở backend; lệnh trở lại đúng giường và firmware gửi ACK sau khi áp GPIO.”

### D4 — Hồi phục và kiểm soát hoàn tất công việc (2 phút)

**Thao tác:**

1. Với hai yêu cầu ở HP-01, lần lượt chuyển tiếp sang “Đã đến giường” và “Đang xử lý”.
2. Có thể thử “Hoàn tất” với ghi chú hợp lệ khi biến trở vẫn cao: hệ thống phải báo điều kiện cảnh báo còn tồn tại. Đây là bước kiểm chứng tùy chọn.
3. Vặn biến trở về 0; chờ mẫu mạch/SpO₂ trở lại bình thường và đủ thời gian recovery.
4. Quan sát cảnh báo chuyển “Đã phục hồi”; công việc vẫn “Đang xử lý”. Đèn có thể tắt ngay khi không còn cảnh báo active, dù chưa hoàn tất công việc.
5. Hoàn tất từng công việc với ghi chú `Demo: đã kiểm tra tình huống mô phỏng, chỉ số trở về bình thường, hoàn tất theo dõi.`

**Kết quả:** alarms.active = 0, cleared_at có giá trị; requests chỉ completed sau thao tác người dùng; có care_records và request_events. Không bỏ bước và không hoàn tất bằng ghi chú dưới 5 ký tự.

**Lời trình bày:** “Kết thúc điều kiện cảnh báo và kết thúc chăm sóc là hai việc độc lập. Hệ thống lưu cả quá trình và kết quả xử lý.”

### D5 — Cảm biến nhiệt độ DS18B20 (2 phút)

**Thiết bị:** HP-03.

**Thao tác:** Trong khi Wokwi chạy, chọn DS18B20, điều chỉnh nhiệt độ lên 39,5°C. Chờ nhiệt độ trên Dashboard thay đổi và xuất hiện cảnh báo sau sustain. Tiếp nhận yêu cầu; đưa cảm biến về 36,8°C, chờ hồi phục rồi thực hiện đủ bước và hoàn tất.

**Kết quả:** Reading temperature có sensor_type DS18B20 và source wokwi; rule temperature_high được tạo; đèn đỏ nhấp nháy trước tiếp nhận, đỏ liên tục sau tiếp nhận khi không có xung đột ưu tiên.

**Bảng chứng minh:** messages, measurements, rule_state, alarms, requests, commands.

Wokwi hỗ trợ thay đổi nhiệt độ DS18B20 khi mô phỏng chạy: [tài liệu DS18B20](https://docs.wokwi.com/parts/wokwi-ds18b20).

### D6 — Mất dữ liệu và kết nối lại (2–3 phút)

**Thiết bị:** HP-06; dùng cuối phần dữ liệu trực tiếp để không ảnh hưởng ảnh đủ sáu thiết bị.

**Thao tác:**

1. Stop Simulator của riêng dev-hp06, để năm thiết bị còn lại tiếp tục.
2. Chờ tuổi mẫu vượt offlineSeconds hiện tại là 60 giây, cộng chu kỳ worker/polling. Có thể cần khoảng 60–75 giây từ mẫu cuối đã được chấp nhận.
3. Quan sát giường HP-06 mất dữ liệu, cảnh báo kỹ thuật và yêu cầu kiểm tra; các giường còn lại tiếp tục cập nhật.
4. Start Simulator lại HP-06, chờ mẫu mới đúng thời gian/assignment và cảnh báo offline kết thúc.
5. Đi hết các bước xử lý công việc offline còn mở; ghi chú `Demo: đã khởi động lại mô phỏng, xác nhận dữ liệu mới và hoàn tất kiểm tra.`

**Kết quả:** Không biến giá trị cũ thành mẫu mới. Lịch sử vẫn truy vấn được. devices.latest_at dừng tiến khi mất dữ liệu, tiếp tục sau phục hồi; alarms/requests lưu sự cố.

**Điểm phải nói đúng:** Khi đã Stop Wokwi, ESP32 không chạy nên không thể nhận lệnh hoặc bật đèn vàng. Backend có thể phát lệnh yellow nhưng chưa có ACK; đây là trạng thái dự kiến, không phải lỗi demo. Khi reconnect, firmware nhận lại trạng thái đèn phù hợp.

### D7 — Xác nhận gửi EMR và xem bản ghi lưu trữ (2 phút)

**Thao tác:**

1. Chọn bệnh nhân đang có mẫu mới, quality valid. Ở trang Theo dõi bệnh nhân, bấm “Xác nhận mẫu mới nhất → EMR”.
2. Xem bản xem trước, bấm “Xác nhận gửi”.
3. Chọn một ghi nhận chăm sóc vừa hoàn tất, bấm “Xác nhận → EMR”, kiểm tra nội dung và xác nhận gửi.
4. Mở Đồng bộ EMR, xem hàng đợi và bản ghi đến sandbox.

**Kết quả:** emr_outbox có bản ghi; worker chuyển sang sent khi sandbox nhận; emr_records có nội dung FHIR. Worker có thể xử lý nhanh nên giao diện có thể hiển thị sent mà chưa kịp thấy pending.

**Bảng chứng minh:** messages/care_records → emr_outbox → emr_records; audit_logs ghi xác nhận.

**Lời trình bày:** “Dữ liệu đo chưa tự trở thành hồ sơ đã xác nhận. Người dùng xem và xác nhận; hệ thống gửi qua outbox. Đích hiện tại là sandbox cùng backend, chưa phải HIS thật.”

## 4. Demo mở rộng

### E1 — MPU6050 và chất lượng dữ liệu (2–3 phút)

Chọn HP-04 bình thường. Điều chỉnh gia tốc MPU6050 sao cho payload motion vượt 15 m/s²; chẳng hạn gia tốc Z khoảng 2 g khi các trục khác bằng 0. Kiểm tra giá trị thực tế trong payload. Firmware đặt chất lượng mạch/SpO₂ thành suspect. Quan sát Dashboard báo chất lượng; mẫu không được dùng như giá trị hợp lệ để xác nhận bất thường/hồi phục. Có thể tăng biến trở khi motion vẫn cao để chứng minh giá trị thấp chưa đủ tạo alarm nếu quality suspect; bảo đảm giường này chưa có alarm sinh tồn trước đó.

Khôi phục biến trở về 0 và MPU6050 về cấu hình ban đầu. Đừng kỳ vọng dữ liệu suspect sẽ tự xóa một alarm đã có. Minh chứng: measurements.quality, sensor_id và payload nguồn wokwi của motion. Tài liệu: [MPU6050](https://docs.wokwi.com/parts/wokwi-mpu6050).

### E2 — Chuyển cấp khi chậm xử lý (2 phút)

Nhấn gọi ở HP-05 và chưa tiếp nhận. Chờ quá escalationSeconds 60 giây cộng lịch worker. Dashboard hiển thị nâng cấp; requests.escalated = 1, assignee chuyển Điều dưỡng trưởng; request_events có action escalated. Sau khi minh chứng, thực hiện đủ các bước và hoàn tất. Không diễn giải trường assignee như email/SMS đã gửi: project chưa có luồng gửi thông báo bên ngoài ở bước này.

### E3 — Hoán đổi bệnh nhân giữa giường (2–3 phút, làm cuối)

Đăng nhập admin, vào Quản trị và ghi lại cặp bệnh nhân/giường trước thao tác. Dùng chức năng đổi giường để hoán đổi bệnh nhân HP-01/HP-02. Phần cứng vẫn ở giường; hai assignment cũ kết thúc, hai assignment mới xuất hiện. Chờ firmware nhận config retained; kiểm tra patient_id/assignment_id trong payload mới và dữ liệu trên Dashboard. Truy vấn lịch sử bệnh nhân vẫn giữ dữ liệu của assignment cũ.

Nhãn giao diện hiện có “Đổi giường cho thiết bị”, nhưng nghiệp vụ backend là giữ phần cứng tại giường và hoán đổi bệnh nhân/lượt điều trị. Dùng API/UI, không sửa trực tiếp các bảng để đổi giường. Sau demo có thể hoán đổi lại qua UI và ghi nhận lịch sử; không cần xóa DB.

## 5. Chốt minh chứng trong PostgreSQL

Dùng bộ câu đã chuẩn bị trong [postgres-exploration.sql](sql/postgres-exploration.sql):

| Câu | Minh chứng |
|---|---|
| 01 | Assignment đang hiệu lực |
| 02 | Mẫu nhận gần nhất, tuổi mẫu, độ trễ cho từng thiết bị |
| 03 / 04 | Phép đo và phiếu sinh tồn |
| 05 | Xu hướng theo phút; lịch sử một giờ kết thúc ở mẫu cuối |
| 08 | Cảnh báo active hoặc công việc còn mở |
| 09 | Phân bố trạng thái công việc |
| 10 | Lệnh đèn và ACK |
| 11 | Trạng thái gửi EMR |
| 12 | Payload gốc |

Lưu ý câu 08 không trả các công việc đã completed có alarm đã cleared. Muốn xem toàn bộ quá trình vừa demo, chạy các truy vấn riêng dưới đây (thay khoảng 30 phút nếu cần):

```sql
SET TIME ZONE 'Asia/Ho_Chi_Minh';

-- Cảnh báo và công việc phát sinh gần đây, kể cả đã hoàn tất.
SELECT a.patient_id, a.bed_id, a.rule, a.active,
       a.opened_at::timestamptz, a.cleared_at::timestamptz,
       r.id AS request_id, r.state, r.assignee
FROM alarms a LEFT JOIN requests r ON r.alarm_id = a.id
WHERE a.opened_at::timestamptz >= now() - interval '30 minutes'
ORDER BY a.opened_at DESC;

-- Timeline thao tác phát sinh gần đây.
SELECT r.patient_id, r.bed_id, e.request_id,
       e.action, e.actor, e.at::timestamptz, e.note
FROM request_events e JOIN requests r ON r.id = e.request_id
WHERE e.at::timestamptz >= now() - interval '30 minutes'
ORDER BY e.at, e.id;

-- Ghi nhận chăm sóc vừa hoàn tất.
SELECT patient_id, request_id, actor, at::timestamptz, note
FROM care_records
WHERE at::timestamptz >= now() - interval '30 minutes'
ORDER BY at DESC;
```

Các truy vấn này có thể trả rỗng trước khi thực hiện demo; đó không phải lỗi SQL. Không coi dữ liệu cũ của lần chạy khác là minh chứng lượt demo mới.

## 6. Tiêu chí đạt và ảnh cần lưu

| Tiêu chí | Bằng chứng cần thấy |
|---|---|
| Sáu thiết bị riêng | Sáu ID và sáu assignment có mẫu mới tại cùng thời điểm kiểm tra |
| Hai loại cảm biến mỗi thiết bị | DS18B20 và MPU6050 trong mạch/payload; D5 và E1 chứng minh tác động |
| Định danh đúng bệnh nhân | payload khớp assignment và DB |
| Dashboard đủ nội dung | Chỉ số, biểu đồ, phiếu, cảnh báo, workflow |
| Quy tắc hoạt động | Vượt ngưỡng hợp lệ có sustain tạo alarms/requests |
| Actuator hai chiều | RGB đổi trạng thái, command_id đối chiếu ACK |
| Workflow có kiểm soát | Không bỏ bước; phục hồi khác hoàn tất; có care record |
| Mất dữ liệu | Chỉ giường đã dừng báo mất dữ liệu; nhận lại sau reconnect |
| Tích hợp hồ sơ | Có xác nhận, outbox sent và bản ghi sandbox |

Lưu tối thiểu: Tổng quan sáu thiết bị, payload, biểu đồ/phiếu, hai cảnh báo HP-01, đèn và ACK, timeline completed, sự cố offline, EMR sent. Chỉ đánh dấu “đạt” sau khi quan sát đúng kết quả; trường hợp chưa có minh chứng ghi “chưa kiểm chứng”.

## 7. Xử lý nhanh nếu demo không như dự kiến

| Hiện tượng | Kiểm tra |
|---|---|
| Debug có MQTT nhưng Dashboard không có mẫu mới | Đúng topic telemetry? HTTP ingest có lỗi? measured_at và received_at chênh bao nhiêu? assignment có đúng không? |
| Serial báo TIME SYNC failed | Private IoT Gateway, API đang chạy, TIME_SYNC_URL đúng cổng API 3001 theo cấu hình thiết bị |
| Không phát sinh cảnh báo | Chưa đủ sustain, quality suspect/invalid, mẫu trễ hoặc thresholds đã thay đổi |
| Đèn vẫn nhấp nháy sau tiếp nhận | Còn yêu cầu sinh tồn assigned khác trên cùng assignment; kịch bản biến trở gây hai cảnh báo |
| Đèn khác màu mong đợi | Còn cảnh báo ưu tiên hơn: sinh tồn đỏ > offline vàng > nurse_call xanh; kiểm tra command mới và ACK |
| Không hoàn tất được | Chưa đúng thứ tự, ghi chú quá ngắn hoặc cảnh báo sinh tồn chưa phục hồi |
| Stop Wokwi nhưng chưa báo offline | Cấu hình hiện là 60 giây, tính từ mẫu live cuối, cộng lịch worker |
| Chạy sáu mô phỏng khiến mẫu trễ | Giảm ứng dụng nền, luyện trước; nếu chỉ chạy được hai thiết bị thì nêu đúng giới hạn, không khẳng định đã chứng minh sáu thiết bị đồng thời |

Khi kết thúc, đưa các điều khiển mô phỏng về trạng thái bình thường, hoàn tất công việc demo qua UI và giữ lịch sử. Nếu cần dừng trình diễn: Stop các Wokwi; `docker compose --profile simulator stop` dừng bộ chính; `docker compose -f compose.yaml -f compose.pgadmin.yaml stop pgadmin` dừng riêng pgAdmin. Không dùng `down -v` để chuẩn bị lượt demo vì sẽ xóa volume dữ liệu.
