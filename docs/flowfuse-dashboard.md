# FlowFuse Dashboard — VitalCare

Giao diện chính của bộ Docker dùng **FlowFuse Dashboard 2.0**, package `@flowfuse/node-red-dashboard` phiên bản 1.33.0. Sáu `ui-page`, sáu `ui-group` và sáu `ui-template` Vue được tạo trong flow **VitalCare · FlowFuse Dashboard**. Đây là component thực của FlowFuse, không phải iframe trỏ về dashboard cũ.

## Khởi động và truy cập

```powershell
docker compose up --build -d
```

- Dashboard: http://127.0.0.1:1880/dashboard
- Editor: http://127.0.0.1:1880
- API: cổng `DOCKER_HTTP_PORT` trong `.env`, hiện tại 3001 trên máy này. Mở trang gốc API sẽ chuyển sang dashboard.
- Tài khoản mặc định: `nurse / nurse-demo`, `admin / admin-demo`. Giá trị `.env` đã thay sẽ được ưu tiên.
- Nếu đổi `DOCKER_NODE_RED_PORT`, cả cổng truy cập và đích chuyển hướng API được Compose cập nhật.

Build firmware chỉ tạo binary. Muốn có telemetry phải Start Simulator cho từng Wokwi, hoặc chạy simulator Docker:

```powershell
docker compose --profile simulator up --build -d simulator
# Dừng nguồn dữ liệu giả lập; dashboard và backend tiếp tục chạy:
docker compose --profile simulator stop simulator
# Dừng toàn bộ dịch vụ, giữ dữ liệu:
docker compose --profile simulator stop
```

Không chạy hai nguồn cho cùng device ID. Khi chưa có thiết bị phát dữ liệu, giao diện báo mất dữ liệu và không hiện giá trị cũ như giá trị trực tuyến. Lịch sử đã lưu vẫn truy vấn được. Lệnh `lamp/cmd` do backend phát không phải telemetry mới.

### Đồng bộ thời gian Wokwi

Khi mô phỏng chạy chậm hơn thời gian thực, đồng hồ ESP32 có thể trễ hàng phút dù MQTT vẫn gửi liên tục. Firmware mới gọi `GET /api/time` ngay trước mỗi lần lấy mẫu/gửi sự kiện để đồng bộ với đồng hồ backend. Endpoint chỉ trả `epoch_ms`, không cần đăng nhập, không chứa dữ liệu bệnh nhân và không cache. Không sửa timestamp của mẫu đã lưu và không tăng các ngưỡng kiểm tra độ mới.

`TIME_SYNC_URL` trong từng `config.h` phải trỏ tới **cổng API**, trên máy này là `http://host.wokwi.internal:3001/api/time` (không phải cổng MQTT 1885 hoặc FlowFuse 1880). Generator lấy cổng từ `WOKWI_HTTP_PORT`, nếu không có thì `DOCKER_HTTP_PORT`, mặc định 3000. Sau khi đổi cổng cần sửa config và build lại. Firmware in `TIME SYNC failed` và không phát mẫu mới nếu không lấy được giờ máy chủ.

Sau khi nâng cấp firmware, **Stop rồi Start Simulator** từng Wokwi để nạp binary mới. Dashboard phân biệt:

- **Ổn định / Có báo động:** có số đo còn mới; dùng cho luồng trực tuyến như trước.
- **Đang nhận · mẫu trễ:** vẫn nhận telemetry nhưng chưa có số đo còn mới. Hiển thị mẫu vừa nhận với cảnh báo rõ giờ đo, giờ nhận và độ trễ; không dùng mẫu trễ để đánh giá báo động hoặc làm mới chỉ số trực tuyến.
- **Không nhận số đo mới:** không có telemetry gần đây; hiển thị dấu gạch, lịch sử vẫn được giữ.

Ngưỡng mất số đo mới vẫn áp dụng. Nếu máy quá tải khiến khoảng cách bản tin vượt ngưỡng, cần giảm tải mô phỏng; đồng bộ giờ không làm Wokwi chạy nhanh hơn thời gian thực.

## Các màn hình

| Trang | Nội dung |
|---|---|
| Tổng quan | Giường/bệnh nhân, sáu chỉ số sinh tồn, trực tuyến, báo động, số yêu cầu, tìm kiếm và lọc |
| Theo dõi bệnh nhân | Khoảng lịch sử 1/6/24 giờ; mạch, SpO₂, nhịp thở, mạch–nhiệt độ; phiếu chức năng sống 12 cột, in và CSV; payload, cảm biến; chăm sóc và xác nhận EMR |
| Yêu cầu chăm sóc | Tiếp nhận → đến giường → đang xử lý → hoàn tất; ghi chú; timeline và trạng thái phục hồi |
| Thiết bị IoT | Định danh giường/bệnh nhân/device, cảm biến, chất lượng, lần nhận, chế độ đèn và ACK |
| Đồng bộ EMR | Hàng đợi, số lần gửi, lỗi và bản ghi FHIR đã đến sandbox |
| Quản trị | Ngưỡng, thời gian, đổi giường, audit; backend kiểm tra quyền admin |

Biểu đồ mạch là xu hướng mẫu đo, không phải ECG. Khoảng mất dữ liệu hoặc chất lượng không hợp lệ ngắt đường biểu đồ. Giới hạn truy vấn lịch sử là 2.000 mẫu; backend chọn mẫu trải theo khoảng thời gian. Phiếu dùng 12 mẫu cuối của kết quả đã lấy, không phải phiếu đã ký. CSV lấy tối đa 2.000 mẫu trong 24 giờ.

## Đường đi dữ liệu và phân quyền

```text
ESP32 / simulator → Mosquitto → Node-RED flow tích hợp → API → PostgreSQL
                                                     ↓
                                           rule / workflow / EMR
                                                     ↓
                                              MQTT → RGB LED

Trình duyệt FlowFuse → /health-api/* → API nghiệp vụ → PostgreSQL
```

`api-proxy.cjs` được gắn vào `httpAdminMiddleware` tại root Node-RED (cùng origin với dashboard). Chỉ chuyển các API giao diện có trong danh sách cho phép; không công bố ingestion token hoặc API nhận telemetry. Cookie `ff_health_session` HttpOnly được giới hạn `Path=/health-api`; proxy đổi tên thành `health_session` khi gọi backend, tách phiên FlowFuse khỏi cookie của dashboard HTML cũ. Backend giữ nguyên xác thực, quyền và audit theo người dùng. Request thay đổi dữ liệu được kiểm tra Origin.

Mỗi component gọi API bằng phiên của trình duyệt, làm mới mỗi 3 giây và hủy request khi rời trang. Không đưa payload bệnh nhân vào `msg`, global context hoặc socket broadcast của FlowFuse. Sáu trang có thể nhìn thấy trên thanh điều hướng trước đăng nhập, nhưng dữ liệu bệnh nhân và hành động yêu cầu xác thực. Editor vẫn chỉ publish localhost như cấu hình ban đầu.

## Sửa giao diện và nạp lại

- `infra/node-red/dashboard/component.vue`: component Vue, xử lý trang và API.
- `infra/node-red/dashboard/styles.css`: CSS responsive và bản in.
- `infra/node-red/dashboard/visuals.js`: hàm thuần tạo SVG và phiếu; được nhúng trong method `visuals()` vì parser `ui-template` yêu cầu một `export default` duy nhất.
- `infra/node-red/build-dashboard.cjs`: tạo node `ui-base`, theme, page, group, template.
- `infra/node-red/dashboard-flow.json`: bản export có thể xem/import trong editor.

Sau khi sửa Vue/CSS/SVG:

```powershell
npm run flowfuse:build
docker compose restart node-red
```

Runtime sinh flow trực tiếp từ các file nguồn lúc restart; lệnh build cập nhật bản export trong repo. Chỉnh template trực tiếp trong editor chỉ có hiệu lực đến lần restart tiếp theo. Nếu muốn giữ chỉnh sửa, đưa về file nguồn. Không cần build API khi chỉ sửa giao diện.

Sau khi sửa dependency hoặc Dockerfile:

```powershell
docker compose up --build -d --no-deps node-red
```

Sau khi sửa backend:

```powershell
docker compose up --build -d --no-deps api
```

## Bảo toàn flow đang có

Trước lần chuyển đổi đầu, `prepare.cjs` sao lưu flow và credential trong volume thành `/data/flows.before-flowfuse.json` và `/data/flows_cred.before-flowfuse.json`. File có quyền 0600. Không xóa volume để nâng cấp.

Mỗi lần khởi động, script cập nhật node thuộc `flows.json` và các node ID bắt đầu `ff-health-`. Các node khác và nhánh dây debug thêm vào node tích hợp được giữ. Bản sao trước chuyển đổi không bị ghi đè. Export toàn bộ flow sau những chỉnh sửa quan trọng để có thêm bản sao độc lập.

`public/` được giữ để lệnh `npm run demo` cũ còn chạy độc lập bằng Aedes/SQLite; lệnh này không khởi động FlowFuse. Bộ Docker là cách chạy dashboard mới được hỗ trợ trong project.

## Kiểm tra

```powershell
npm test
docker compose logs --tail 50 node-red api
```

Log Node-RED phải có `Node-RED Dashboard 2.0 (v1.33.0) started at /dashboard` và MQTT `Connected`. Bộ test bổ sung kiểm tra phiên riêng, chặn ghi dữ liệu không đúng quyền, Origin, xuất CSV và các node dashboard không giữ payload dùng chung. Kiểm tra trực quan: đăng nhập, chọn bệnh nhân, mở biểu đồ/phiếu/payload, xem yêu cầu và trạng thái đèn.
