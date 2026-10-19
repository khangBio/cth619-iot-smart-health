# Trả lời yêu cầu 5–13 — Dự án Smart Health

Ngày đối chiếu: 19/10/2026. Nguồn yêu cầu: trang 4–9 của `MoTaYeuCau-DuAnIoT-IS.pdf`. Phạm vi trả lời là cấu hình Docker với Wokwi, Mosquitto, Node-RED, backend Node.js, PostgreSQL và FlowFuse Dashboard. Bản demo local dùng Aedes/SQLite là chế độ khác, không được dùng để thay thế minh chứng Wokwi mà đề bài yêu cầu.

## 5. Yêu cầu về IoT Devices

### 5.1. Sử dụng Wokwi

Hệ thống sử dụng Wokwi mô phỏng sáu thiết bị ESP32 đặt tại sáu giường. Mỗi thiết bị có project riêng trong `firmware/dev-hp01` … `firmware/dev-hp06`, gồm sketch, cấu hình định danh, diagram mạch, cấu hình PlatformIO và Wokwi. Firmware được biên dịch trước, sau đó chạy bằng Wokwi Start Simulator.

| Thành phần mỗi thiết bị | Chức năng |
|---|---|
| ESP32 | Đọc cảm biến, tạo payload, kết nối mạng, nhận lệnh và điều khiển GPIO |
| DS18B20, GPIO 4 | Cảm biến nhiệt độ mô phỏng, có thể điều chỉnh nhiệt độ trong Wokwi |
| MPU6050, I²C GPIO 21/22 | Cảm biến gia tốc/chuyển động; ảnh hưởng chất lượng mạch và SpO₂ khi chuyển động mạnh |
| RGB LED, GPIO 25/26/27 | Actuator hiển thị trạng thái cảnh báo/gọi điều dưỡng |
| Nút nhấn, GPIO 13 | Phát sự kiện nurse_call |
| Biến trở, GPIO 34 | Điều khiển kịch bản sinh SpO₂ thấp và mạch cao |

### 5.2. Số lượng và định danh

PDF khuyến nghị ít nhất năm devices, ít nhất hai loại sensor và một loại actuator. Thiết kế sáu devices, mỗi device có cả DS18B20 và MPU6050, cùng RGB LED đáp ứng cấu hình đó và yêu cầu riêng của đề tài là tối thiểu sáu devices.

| Device | Giường cố định | Bệnh nhân ban đầu |
|---|---|---|
| dev-hp01 | HP-01 | BN-001 |
| dev-hp02 | HP-02 | BN-002 |
| dev-hp03 | HP-03 | BN-003 |
| dev-hp04 | HP-04 | BN-004 |
| dev-hp05 | HP-05 | BN-005 |
| dev-hp06 | HP-06 | BN-006 |

Bệnh nhân hiện tại được xác định bằng assignment, có thể khác bảng ban đầu sau hoán đổi. Phần cứng ở lại giường.

**Minh chứng:** mạch Wokwi từng thiết bị, device ID riêng, payload có hai sensor type, sáu giường nhận mẫu mới trong cùng khoảng quan sát. Đã có kết quả build sáu firmware; không dùng kết quả build hoặc sáu publisher Docker làm bằng chứng sáu Wokwi chạy đồng thời.

## 6. Yêu cầu về dữ liệu IoT

Dữ liệu được tổ chức dạng time-series: mỗi bản tin có thời điểm đo, mã thiết bị, định danh bệnh nhân và danh sách readings. Nhiều giá trị thay đổi theo thời gian hoặc theo thao tác trên mô phỏng.

| Mã chỉ số | Đơn vị payload | Nguồn hiện tại |
|---|---|---|
| pulse_rate | /min | Sinh giả lập trong firmware |
| spo2 | % | Sinh giả lập trong firmware |
| temperature | Cel | DS18B20 trong Wokwi |
| respiratory_rate | /min | Sinh giả lập trong firmware |
| systolic | mm[Hg] | Sinh giả lập trong firmware |
| diastolic | mm[Hg] | Sinh giả lập trong firmware |
| weight | kg | Giá trị giả lập hiện đặt 64 |
| motion | m/s2 | Độ lớn gia tốc tính từ MPU6050 trong Wokwi |

Mạch, SpO₂, nhịp thở và huyết áp có biến thiên; nhiệt độ/chuyển động thay đổi qua điều khiển cảm biến; biến trở tạo kịch bản bất thường. Cân nặng hiện giữ hằng số, nhưng hệ thống không chỉ gửi một giá trị cố định lặp lại. Không mô tả tám kênh như tám cảm biến vật lý độc lập.

**Sampling interval:** cấu hình firmware 1.000 ms theo millis(), payload khai báo sampling_interval_ms=1000. Khoảng nhận theo thời gian thực có thể dài hơn do tốc độ mô phỏng, đồng bộ HTTP và truyền mạng. Chu kỳ Dashboard đọc API là 3 giây, khác chu kỳ thiết bị.

**Timestamp:** measured_at theo ISO 8601 UTC; server thêm received_at. Firmware đồng bộ giờ qua GET /api/time trước khi thu thập/phát mẫu; không gửi mẫu mới nếu đồng bộ thất bại.

**Metadata:** schema_version, message_id, sequence, device_id, device_type, ward_id, bed_id, patient_id, encounter_id, assignment_id. Từng reading có sensor_id, sensor_type, code, value, unit, quality, source. Ward/bed và bảng beds cung cấp vị trí; không sử dụng GPS.

**Minh chứng:** hai payload khác thời điểm có giá trị thay đổi; lịch sử measurements; đồ thị; thao tác tăng nhiệt độ hoặc biến trở. Source simulated vẫn xuất hiện trong phiên Wokwi vì các kênh sinh lý đó được firmware sinh bằng phần mềm.

## 7. Yêu cầu về Communication

Hệ thống triển khai MQTT để truyền dữ liệu và điều khiển; HTTP/REST để tích hợp Node-RED–backend, đồng bộ giờ và phục vụ ứng dụng.

```text
ESP32 Wokwi
→ Wi-Fi / Private IoT Gateway
→ MQTT / Mosquitto
→ Node-RED integration
→ HTTP + ingestion token
→ Backend API
```

Mosquitto là broker trong Docker. Theo cấu hình đã kiểm chứng, thiết bị đi qua host.wokwi.internal:1885; trong Docker broker là mosquitto:1883. Cổng host có thể đổi theo môi trường; không thay cổng nội bộ bằng cổng host.

| Topic ví dụ | Publisher | Subscriber nghiệp vụ | QoS publish |
|---|---|---|---:|
| hospital/HP/devices/dev-hp01/telemetry | ESP32 | Node-RED | 0 |
| hospital/HP/devices/dev-hp01/event | ESP32 | Node-RED | 1 |
| hospital/HP/devices/dev-hp01/status | ESP32/LWT | Node-RED | 1 |
| hospital/HP/devices/dev-hp01/config | Backend | ESP32 | 1 |
| hospital/HP/beds/HP-01/lamp/cmd | Backend | ESP32 | 1 |
| hospital/HP/beds/HP-01/lamp/ack | ESP32 | Node-RED | 1 |

Node-RED đăng ký hospital/# nên có thể nhìn thấy cả cmd/config nhưng flow bỏ qua chúng khi định tuyến ingestion. Subscribe QoS 1 không nâng telemetry publish QoS 0 thành giao nhận QoS 1.

Payload là JSON. Broker yêu cầu tài khoản; ACL giới hạn topic của từng thiết bị. Config/status sử dụng retained; command không retained và có thời hạn riêng trong payload. Chưa triển khai TLS; cấu hình đang phục vụ demo trên máy cục bộ.

**Minh chứng:** Node-RED connected, telemetry đúng topic/device, cấu hình ACL và cặp command/ACK khớp nhau. MQTT chuyển bản tin không tự chứng minh DB đã lưu thành công.

## 8. Yêu cầu về IoT Platform

Node-RED là **IoT Integration Layer**. Nó tiếp nhận MQTT, lọc topic, parse JSON, gắn token và chuyển tới API tương ứng. Node-RED đồng thời phục vụ FlowFuse Dashboard và proxy API của giao diện.

| Dữ liệu nhận | Endpoint backend |
|---|---|
| telemetry, event | POST /api/ingest |
| status | POST /api/device-status |
| lamp/ack | POST /api/ack |

Backend Node.js bổ sung quản lý devices/assignments, kiểm tra định danh, lưu PostgreSQL, rule processing, workflow và điều khiển. Trong Compose, INGEST_VIA_NODE_RED=true tắt đường subscribe nhận trực tiếp của backend để tránh hai đường ingestion; backend vẫn publish cấu hình và command.

Lý do phân chia: Node-RED thuận tiện cho tích hợp và quan sát flow; backend tập trung transaction, kiểm soát thứ tự thay đổi và kiểm thử nghiệp vụ. Đề bài cho phép IoT Platform hoặc Integration Layer và không bắt buộc mọi rule nằm trong Function node.

**Minh chứng:** flow Smart Health · IoT integration, flows.json, các endpoint và dữ liệu được ghi qua đường này. Nếu Node-RED dừng thì cấu hình Docker hiện không tự chuyển sang ingest MQTT trực tiếp tại backend.

## 9. Yêu cầu về Data Infrastructure

### Công nghệ, dữ liệu và cấu trúc

Chế độ Docker dùng PostgreSQL 17, database smart_health, service postgres. Dữ liệu lưu trong named volume postgres-data gắn tại /var/lib/postgresql/data. Chưa cài TimescaleDB; bản demo local riêng dùng SQLite WAL.

| Nhóm dữ liệu | Bảng |
|---|---|
| Bệnh nhân, lượt điều trị, giường, thiết bị | patients, encounters, beds, devices, assignments |
| Payload gốc và từng phép đo | messages, measurements |
| Cấu hình và trạng thái tính toán | settings, rule_state |
| Cảnh báo và chăm sóc | alarms, requests, request_events, care_records |
| Lệnh và xác nhận actuator | commands |
| Hồ sơ tích hợp | emr_outbox, emr_records |
| Truy vết | audit_logs |

Một telemetry có một messages và tám measurements. Event gọi có messages nhưng không có measurements. message_id liên kết phép đo với payload; assignment liên kết dữ liệu với bệnh nhân tại thời điểm phát sinh. Các chỉ mục hỗ trợ truy vấn patient/time, message và assignment. Thời gian/JSON hiện lưu dạng TEXT để dùng chung adapter SQLite/PostgreSQL; SQL phân tích PostgreSQL ép kiểu khi cần.

### Truy vấn và trực quan hóa

```text
IoT data → Node-RED/API ingestion → PostgreSQL
→ API query / SQL pgAdmin → FlowFuse / biểu đồ SQL
```

Ví dụ lịch sử theo bệnh nhân:

```sql
SELECT measured_at::timestamptz AS measured_at,
       code, value, unit, quality, source
FROM measurements
WHERE patient_id='BN-001'
ORDER BY measured_at DESC
LIMIT 100;
```

API lịch sử lấy mẫu từ messages, kiểm tra có measurements, giới hạn tối đa 2.000 mẫu và khoảng truy vấn tối đa 31 ngày. Đây là giới hạn truy vấn, không phải thời gian dữ liệu được lưu.

### Thời gian lưu và khả năng mở rộng

- Hiện tại không có job tự xóa theo tuổi dữ liệu; dữ liệu giữ trong volume cho đến khi được quản trị xóa/khôi phục.
- Định hướng lưu chi tiết 30 ngày mới được ghi trong tài liệu; chưa triển khai retention tự động. Khi áp dụng thực tế cần thống nhất lưu trữ, backup và kiểm tra phục hồi.
- Có thể cấu hình/sinh thêm devices; mục tiêu bài toán là mở rộng tới 20 giường. DB và nghiệp vụ hiện xử lý tuần tự, PostgreSQL pool max=1; cần cải tiến đồng thời hóa theo device/assignment khi tải lớn.
- Đã có thử tải ngắn local 6/10/20/40 publisher phần mềm, 10 giây mỗi mức, với MQTT và SQLite. Không dùng kết quả này làm chứng nhận tải PostgreSQL hay sáu Wokwi đồng thời. Chưa có bằng chứng chạy tải dài toàn tuyến Docker/PostgreSQL.

**Minh chứng:** schema, dữ liệu truy vấn, restart service vẫn còn lịch sử, đồ thị dữ liệu cũ; phân biệt chính sách dự kiến với cơ chế đã cài đặt.

## 10. Yêu cầu về Data Processing và Analytics

Project có nhiều cơ chế đáp ứng yêu cầu tối thiểu một cơ chế:

| Cơ chế | Triển khai |
|---|---|
| Filtering | Kiểm tra schema, topic/identity, sensor/unit/range, chống trùng; phân biệt live/stale; lọc quality trước đánh giá rule |
| Transformation | Parse JSON; tách readings thành bảng quan hệ; chuyển kết quả được xác nhận thành FHIR |
| Rule-based processing | Ngưỡng + sustain/recovery, offline, escalation; trạng thái bền vững trong DB |
| Anomaly detection | Bất thường vượt ngưỡng và mất dữ liệu dựa trên quy tắc |
| Stream processing | Xử lý từng bản tin và duy trì trạng thái theo assignment/rule ở ứng dụng |
| Aggregation | Dashboard đếm giường/alarm/công việc; SQL GROUP BY phút/thiết bị/trạng thái |
| Statistical analysis | SQL AVG, MIN, MAX, COUNT để phân tích mô tả |

SQL tổng hợp theo phút hiện chạy thủ công bằng pgAdmin/psql; biểu đồ FlowFuse không tự tính trung bình phút. History downsampling là chọn mẫu có giới hạn, không phải trung bình và chưa bảo đảm giữ mọi cực trị ngắn. Không có ML/AI; đề bài nói rõ AI không bắt buộc.

Kết quả kiểm chứng 19/10/2026: 28/28 tests đạt; đã chạy tổng hợp PostgreSQL trên dữ liệu đang lưu. Test tự động sử dụng SQLite cô lập và bài MQTT với Aedes/publisher phần mềm; không diễn giải thành đã thử mọi tình huống Wokwi toàn tuyến. Chi tiết: docs/data-processing-verification.md và docs/data-processing-test.log.

## 11. Yêu cầu về Rule và Decision

Đề bài yêu cầu ít nhất hai scenario. Hệ thống có nhiều scenario với Condition → Decision → Action. Bảng sau dùng cấu hình DB được kiểm chứng ngày 19/10/2026: sustain/recovery=5 giây, offline/maxLiveAge=60 giây, escalation=60 giây; tham số có thể thay đổi qua Quản trị.

| Rule | Condition | Decision | Action |
|---|---|---|---|
| spo2_low | SpO₂ <92%, mẫu đủ mới/valid, duy trì ≥5 giây | Cảnh báo critical | Tạo alarm/request; đỏ nhấp nháy trước tiếp nhận |
| pulse_abnormal | Mạch <50 hoặc >120, đủ điều kiện và duy trì ≥5 giây | Cảnh báo critical | Tạo công việc và điều khiển đèn |
| temperature_high | Nhiệt độ >38,5°C, đủ điều kiện và duy trì ≥5 giây | Cảnh báo warning | Tạo công việc và điều khiển đèn |
| nurse_call | Nhận sự kiện gọi hợp lệ, đủ mới | Yêu cầu hỗ trợ | Phân công; xanh dương nếu không có cảnh báo ưu tiên cao hơn |
| offline | Tuổi mẫu live cuối/assignment vượt ngưỡng 60 giây | Cảnh báo technical | Tạo công việc kiểm tra; lệnh vàng nếu không có cảnh báo sinh tồn ưu tiên |
| escalation | Công việc assigned/accepted quá hạn 60 giây | Chuyển cấp xử lý | Chuyển assignee sang điều dưỡng trưởng, ghi request_events |
| recovery | Mẫu valid trở lại bình thường liên tục đủ 5 giây | Kết thúc điều kiện sinh lý | Clear alarm; cập nhật đèn; vẫn giữ công việc đến khi người dùng hoàn tất |

Các ngưỡng dùng cho mô phỏng, chưa được thẩm định lâm sàng. Rule_state giữ bộ đếm thời gian; alarms lưu evidence/cấu hình rule. Không tạo nhiều đợt active trùng cùng assignment/rule. Suspect/invalid không được dùng để khẳng định hồi phục.

**Minh chứng:** tối thiểu demo biến trở gây SpO₂ thấp và DS18B20 gây nhiệt độ cao, quan sát cả condition, alarm/request và actuator. Biến trở còn làm mạch cao nên có thể có hai yêu cầu cùng lúc.

## 12. Yêu cầu về Action / Actuator

Actuator chính là RGB LED trên mỗi ESP32. Backend chọn mode, lưu command rồi publish MQTT tới topic giường; ESP32 kiểm tra lệnh, áp GPIO và trả ACK. Backend kiểm tra ACK và cập nhật commands.ack_at.

```text
Rule/Decision → commands → MQTT lamp/cmd
→ ESP32 → RGB LED → MQTT lamp/ack
→ Node-RED → API → commands.ack_at → Dashboard
```

| Trạng thái ưu tiên | Mode |
|---|---|
| Có cảnh báo sinh tồn active chưa tiếp nhận | red_blink |
| Có cảnh báo sinh tồn active đã tiếp nhận, không còn yêu cầu sinh tồn assigned ưu tiên hơn | red |
| Offline, không có cảnh báo sinh tồn active ưu tiên | yellow |
| Nurse call, không có hai nhóm trên | blue |
| Không còn điều kiện bật đèn | off |

Lệnh gồm command_id, device_id, bed_id, assignment_id, mode, issued_at, expires_at; có theo dõi attempts và ACK. Không giữ retained command cũ. Hệ thống có cả action ứng dụng: tạo cảnh báo/công việc, chuyển người xử lý; gửi EMR sau xác nhận là hành động bán tự động.

Đèn xanh cho nurse_call giữ đến khi hoàn tất công việc; đến giường chưa làm tắt. Với cảnh báo sinh lý, hồi phục có thể làm tắt đèn trước khi công việc được hoàn tất. Nếu Stop Wokwi thì thiết bị không thể nhận lệnh vàng/ACK; chỉ có quyết định ở backend và trạng thái chờ thực thi. ACK xác nhận firmware áp GPIO, chưa phải cảm biến độc lập chứng minh đèn vật lý sáng.

**Minh chứng:** quan sát RGB đổi màu đồng thời command_id/mode/ACK đúng giường; đây là liên kết từ tầng xử lý đến tầng device mà đề bài yêu cầu.

## 13. Yêu cầu về Dashboard / Application

Giao diện chính sử dụng FlowFuse Dashboard 2.0 trong Node-RED, địa chỉ http://127.0.0.1:1880/dashboard theo cấu hình hiện tại. Sáu trang: Tổng quan, Theo dõi bệnh nhân, Yêu cầu chăm sóc, Thiết bị IoT, Đồng bộ EMR, Quản trị.

| Nội dung bắt buộc | Cách đáp ứng |
|---|---|
| Current sensor values | Các thẻ mạch, SpO₂, nhiệt độ, huyết áp, nhịp thở, cân nặng; bảng cảm biến có motion, source và quality |
| Historical data | Lịch sử 1/6/24 giờ, biểu đồ, phiếu chức năng sống, CSV |
| Device status | Định danh, dữ liệu live/stale/offline, chất lượng, thời điểm nhận, lệnh đèn và ACK |
| System status | Trạng thái đồng bộ API, MQTT và loại DB; thông báo lỗi khi gọi API thất bại; chưa phải dashboard CPU/RAM đầy đủ |
| Cảnh báo | Loại, mức độ, active/phục hồi, công việc và người phụ trách |
| Time-series chart | Đồ thị mạch, SpO₂, nhịp thở, biểu đồ mạch–nhiệt độ theo thời gian |

Dashboard cho phép quan sát và tương tác: tiếp nhận/đến giường/xử lý/hoàn tất, ghi chăm sóc, xác nhận EMR; admin thay đổi threshold/thời gian và hoán đổi bệnh nhân. Điều khiển đèn hiện chủ yếu theo rule và workflow, chưa có nút override thủ công tùy ý mọi mode trên Dashboard.

Giao diện Vue trong ui-template gọi /health-api; proxy Node-RED chuyển sang backend /api. Backend đọc PostgreSQL và trả JSON; chu kỳ làm mới trạng thái khoảng 3 giây. Dashboard không đọc trực tiếp bảng DB hoặc bản tin Debug MQTT. Biểu đồ mạch là xu hướng pulse_rate, không phải ECG.

**Minh chứng:** một trang có chỉ số mới, một biểu đồ lịch sử, một tình huống mất dữ liệu, timeline xử lý, thay ngưỡng với admin và từ chối thao tác quản trị với nurse. Việc cài FlowFuse đơn thuần chưa đủ; cần trình diễn dữ liệu thật từ đường ingestion đã được backend chấp nhận.

## Đánh giá mức đáp ứng và minh chứng còn cần bổ sung

Project đã có thành phần và logic tương ứng toàn bộ mục 5–13. Mục 5 cần bổ sung/giữ minh chứng chạy sáu Wokwi đồng thời để phân biệt với build và simulator; mục 9 cần nói rõ retention thực tế chưa tự động và chưa có thử tải PostgreSQL dài hạn; mục 10 cần phân biệt SQL phân tích thủ công với xử lý tự động. Các giới hạn này không được che bằng kết quả kiểm thử ở chế độ khác.

## Nguồn mã và minh chứng để đối chiếu

- `firmware/dev-hp01/sketch.ino`, `diagram.json` và năm project còn lại: mạch, payload, QoS, actuator.
- `compose.yaml`: service, network và volume.
- `infra/node-red/flows.json`: integration/routing.
- `server/schema.sql`, `server/db.js`: cấu trúc, chỉ mục và transaction.
- `server/service.js`, `server/index.js`: validation, rules, workflow, API, command/ACK, EMR.
- `infra/node-red/dashboard/component.vue`, `visuals.js`: màn hình, truy vấn API và biểu đồ.
- `docs/data-processing-verification.md`, `docs/data-processing-test.log`: kiểm chứng 19/10/2026.
- `docs/load-results.json`: thử tải local 08/10/2026 và phạm vi phép đo.
- `docs/verification.md`: phân biệt build, test tự động, simulator và runtime Wokwi đã được ghi nhận.
