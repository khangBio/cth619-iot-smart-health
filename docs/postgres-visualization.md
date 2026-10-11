# Hướng dẫn truy vấn và trực quan hóa PostgreSQL

Áp dụng cho chế độ Docker của project. Database `smart_health`, user `health`, service `postgres`, cổng nội bộ `5432`. PostgreSQL chưa publish cổng ra Windows. FlowFuse Dashboard đã có biểu đồ nghiệp vụ; pgAdmin là công cụ bổ sung để tự viết SQL, xem bảng và vẽ đồ thị từ kết quả.

## 1. Mở psql ngay trong container

Chạy PowerShell tại thư mục project:

```powershell
Set-Location 'C:\VNPT_HIS_2024\SAU_DAI_HOC\HT-TT\HTTT-IOT\cth619-iot-smart-health'
docker compose exec postgres psql -U health -d smart_health
```

Trong psql:

```text
\dt
\d measurements
\d messages
\q
```

`\dt` xem danh sách bảng; `\d` xem cấu trúc; `\q` thoát. SQL cần kết thúc bằng dấu chấm phẩy. Để kiểm tra nhanh từ PowerShell:

```powershell
docker compose exec postgres psql -U health -d smart_health -c "SELECT count(*) AS total FROM messages;"
```

## 2. Khởi động pgAdmin tùy chọn

Đã có file bổ sung `compose.pgadmin.yaml`. Khởi động bằng:

```powershell
docker compose -f compose.yaml -f compose.pgadmin.yaml up -d pgadmin
docker compose -f compose.yaml -f compose.pgadmin.yaml stop pgadmin
```

Mở http://127.0.0.1:5050. Tài khoản mặc định của giao diện pgAdmin: `admin@example.com` / `pgadmin-demo`. Có thể đặt biến `PGADMIN_EMAIL`, `PGADMIN_PASSWORD`, `PGADMIN_PORT` trước khi khởi tạo; dữ liệu tài khoản đã tạo được giữ trong volume, đổi biến không tự đổi mật khẩu tài khoản cũ.

Trong pgAdmin: **Servers → Register → Server**. Tab General đặt Name `Smart Health`. Tab Connection:

| Trường | Giá trị |
|---|---|
| Host name/address | `postgres` |
| Port | `5432` |
| Maintenance database | `smart_health` |
| Username | `health` |
| Password | `POSTGRES_PASSWORD` trong `.env`; nếu không đặt thì mặc định Compose là `local-db-only` |

Đây là tài khoản PostgreSQL, khác tài khoản đăng nhập pgAdmin và Dashboard. Container pgAdmin kết nối qua Docker DNS `postgres`, không dùng `127.0.0.1` làm host database. Mật khẩu thực tế là mật khẩu đã dùng khi khởi tạo volume PostgreSQL; sửa `.env` sau đó không tự đổi mật khẩu trong DB.

Chọn **Databases → smart_health → Schemas → public → Tables** để xem bảng. Chuột phải database → **Query Tool** để chạy SQL. Tô chọn riêng câu SQL cần chạy rồi bấm Execute. Trong bản pgAdmin chạy bằng trình duyệt, copy SQL từ file trong project và dán vào Query Tool là cách đơn giản nhất.

Nguồn: [pgAdmin container deployment](https://www.pgadmin.org/docs/pgadmin4/9.17/container_deployment.html), [Query Tool](https://www.pgadmin.org/docs/pgadmin4/9.17/query_tool.html).

## 3. Các bảng cần đọc

| Nhóm | Bảng | Ý nghĩa |
|---|---|---|
| Định danh | patients, encounters, beds, devices, assignments | Bệnh nhân, lượt điều trị, giường, thiết bị và quan hệ gán theo thời gian |
| Thu thập | messages | Một bản tin, payload gốc và thời điểm đo/nhận |
| Phép đo | measurements | Một dòng cho mỗi chỉ số trong bản tin; một telemetry thường có 8 dòng |
| Cảnh báo | alarms | Điều kiện cảnh báo, mức độ, active/cleared |
| Công việc | requests, request_events, care_records | Trạng thái tiếp nhận, lịch sử thao tác, ghi chú chăm sóc |
| Actuator | commands | Lệnh đèn, thời hạn, số lần gửi, thời điểm ACK |
| Tích hợp | emr_outbox, emr_records | Hàng đợi gửi EMR và hồ sơ sandbox nhận |
| Truy vết | audit_logs | Ai đã thực hiện thao tác nào |

`measurements.message_id = messages.id`; `messages.assignment_id = assignments.id`. Dùng assignment để xác định giường tại thời điểm phát sinh, không gán tất cả lịch sử bệnh nhân vào giường hiện tại. Không join bảng measurements vào thống kê số bản tin rồi `count(*)`: điều đó có thể đếm một telemetry thành 8 bản tin.

## 4. Bộ SQL thực hành

Mở [sql/postgres-exploration.sql](sql/postgres-exploration.sql). Các câu được đánh số 01–12, dùng bệnh nhân `BN-001`; thay mã để xem bệnh nhân khác. Chạy câu `SET TIME ZONE 'Asia/Ho_Chi_Minh';` một lần cho phiên SQL.

| Câu | Nội dung | Cách xem |
|---|---|---|
| 01 | Bệnh nhân–giường–thiết bị đang gán | Bảng |
| 02 | Telemetry nhận gần nhất theo assignment hiện tại; độ trễ và tuổi mẫu | Bảng, đối chiếu luồng dữ liệu |
| 03 | Từng phép đo, đơn vị, chất lượng, nguồn | Bảng |
| 04 | 20 mẫu gần nhất dạng phiếu sinh tồn | Bảng rộng |
| 05 | Xu hướng theo phút trong một giờ kết thúc tại mẫu cuối đã lưu | Line chart |
| 06 | Số telemetry nhận trong 24 giờ thực gần nhất theo thiết bị | Bar chart |
| 07 | Thống kê nguồn và chất lượng | Bảng |
| 08 | Cảnh báo còn active hoặc công việc chưa hoàn tất | Bảng |
| 09 | Phân bố trạng thái công việc của toàn bộ lịch sử | Pie/bar chart |
| 10 | Lệnh đèn và trạng thái ACK | Bảng |
| 11 | Trạng thái gửi EMR | Bảng |
| 12 | Payload telemetry gốc | JSON |

## 5. Vẽ biểu đồ bằng Graph Visualiser

Chạy riêng câu 05 → mở **Graph Visualiser** → chọn **Line Chart** → X-axis `minute` → Y-axis `pulse_bpm` → **Generate**. Lặp lại với `spo2_pct` hoặc `temperature_c` để có biểu đồ riêng theo đơn vị. Chạy câu 06 với **Bar Chart**, X `device_id`, Y `telemetry_count`. Chạy câu 09 với **Pie Chart**, nhãn `state`, giá trị `request_count`.

Các đồ thị thể hiện kết quả truy vấn lúc chạy; chạy lại SQL để cập nhật khi Wokwi sinh thêm dữ liệu. Dùng nút lưu kết quả trong Data Output để xuất CSV. Xem [Graph Visualiser](https://www.pgadmin.org/docs/pgadmin4/9.17/query_tool.html#graph-visualiser-panel).

Query 05 chủ ý dùng cửa sổ một giờ kết thúc tại mẫu cuối trong DB để vẫn xem được lịch sử khi Wokwi đã dừng. Đây không phải chỉ báo thiết bị đang online. Muốn xem đúng một giờ tính đến hiện tại, thay điều kiện thời gian bằng:

```sql
AND m.measured_at::timestamptz BETWEEN now() - interval '1 hour' AND now()
```

Giá trị trong query 05 là trung bình theo phút; cực trị ngắn có thể bị làm mờ. Cột `spo2_min` hỗ trợ xem SpO₂ thấp nhất trong phút. Muốn phân tích chi tiết, dùng dữ liệu từng mẫu ở câu 03/04. Các phút mất dữ liệu không được tự bổ sung; đường nối trên chart không chứng minh có mẫu đo liên tục giữa hai điểm.

## 6. Cách diễn giải kết quả

- Schema hiện dùng TEXT cho thời gian/JSON để dùng chung PostgreSQL và SQLite. Dùng `::timestamptz`, `::jsonb` khi tính toán/đọc JSON. Không đổi schema trực tiếp chỉ để chạy ví dụ.
- `received_at - measured_at` là độ trễ lúc tiếp nhận. `now() - measured_at` là tuổi mẫu hiện tại; hai số này khác nhau.
- Bản tin đã lưu có thể quá cũ để backend dùng làm chỉ số live. SQL lịch sử và dashboard live vì vậy có thể cho cách hiển thị khác nhau.
- `quality='valid'` là lọc chất lượng; không đồng nghĩa mẫu còn mới hoặc rule đã phát cảnh báo. Rule còn kiểm tra assignment, độ mới, sustain/recovery.
- Dữ liệu DS18B20/MPU6050 từ Wokwi mang source `wokwi`. Các chỉ số sinh lý tạo trong firmware vẫn mang source `simulated`. Không lọc toàn bộ `source='simulated'` nếu muốn xem mạch/SpO₂ từ phiên Wokwi.
- Truy vấn có thể trả rỗng nếu chưa phát sinh dữ liệu thuộc cửa sổ thời gian hoặc chưa có nghiệp vụ EMR.
- Các câu có ép kiểu cột thời gian phù hợp khảo sát dữ liệu demo. Với lịch sử lớn, cần xem EXPLAIN và tối ưu chỉ mục hoặc chuẩn hóa kiểu thời gian trước khi dùng cho báo cáo thường xuyên.

## 7. Dừng riêng pgAdmin

```powershell
docker compose -f compose.yaml -f compose.pgadmin.yaml stop pgadmin
```

Backend, PostgreSQL và FlowFuse tiếp tục hoạt động. File bổ sung không tự được nạp bởi lệnh `docker compose up -d` thông thường; khi muốn quản lý pgAdmin, dùng cả hai đối số `-f` như trên.
