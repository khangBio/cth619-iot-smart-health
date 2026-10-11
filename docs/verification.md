# Kết quả kiểm chứng — 08/10/2026

## Sửa thời gian Wokwi và dữ liệu trên FlowFuse — 10/10/2026

- Nguyên nhân xác minh bằng MQTT và PostgreSQL: `dev-hp01/dev-hp02` phát telemetry đều nhưng `measured_at` trễ 191–215 giây so với `received_at`; API lưu lịch sử và loại khỏi luồng trực tuyến theo `maxLiveAgeSeconds=15`. Không có lỗi mất bản tin giữa Node-RED và DB.
- Bổ sung API `/api/time` không cache; firmware đồng bộ giờ máy chủ trước mỗi lần đo và sự kiện. Giữ nguyên kiểm tra độ mới, định danh, alarm và timestamp lịch sử. Cập nhật template, sáu sketch/config và generator; giữ nguyên credential và diagram.
- Snapshot bổ sung mẫu telemetry vừa nhận theo **assignment hiện tại**, thời gian nhận, độ trễ và trạng thái `live/stale/offline`. Sự kiện gọi không thay mẫu đo. Dashboard hiển thị mẫu trễ có cảnh báo, phân biệt với mất kết nối.
- **28/28 tests PASS**, gồm kiểm tra mẫu trễ không cập nhật live/không tạo báo động sinh lý, chuyển sang offline khi ngừng nhận, phục hồi khi có mẫu mới và API thời gian không lộ dữ liệu/cache.
- **6/6 firmware build SUCCESS** bằng script PowerShell; RAM 47.456 byte, flash 880.509 byte mỗi bộ. Cần Stop/Start Wokwi để nạp binary mới.
- Sau khi người dùng khởi động lại dev-hp01, xác minh runtime thực: API báo cả dev-hp01 và dev-hp02 `online=true`, có mẫu DS18B20/MPU6050 nguồn `wokwi`, độ trễ đo nhận khoảng 6–8 giây trong lượt quan sát. Chrome hiển thị BN-001 “Ổn định”, đủ sáu chỉ số và không có lỗi component. [Ảnh kiểm tra](screenshots/wokwi-time-sync.png). Không khởi động simulator Docker để thay dữ liệu của Wokwi.
- Giới hạn: chưa chạy đồng thời cả sáu Wokwi bằng firmware mới; tốc độ và độ trễ phụ thuộc tải máy. Không khẳng định cập nhật 1 Hz theo thời gian thực khi mô phỏng chạy chậm.

## Chuyển sang FlowFuse Dashboard — 10/10/2026

- Sửa lỗi editor kẹt `Loading Nodes 37/66`: cấu hình `nodesDir` ban đầu quét toàn bộ dependency, nhận nhầm `tslib.html` / `tslib.es6.html` thành định nghĩa node và yêu cầu `/tslib.es6.js` trả 404. Giới hạn `nodesDir` vào đúng package `@flowfuse/node-red-dashboard`. Sau restart, API `/nodes` có 64 bộ node (27 của FlowFuse), không còn hai mục tslib; Chrome tải đầy đủ palette, hai flow và node debug người dùng, không phát sinh lỗi HTTP/JavaScript. Đã kiểm tra lại đăng nhập dashboard, biểu đồ bệnh nhân và xuất bản in.

- Docker đã build và chạy FlowFuse Dashboard 2.0 **1.33.0**, sáu trang tại `http://127.0.0.1:1880/dashboard`. API trên cổng 3001 chuyển hướng trang gốc về dashboard. Node-RED vẫn nhận MQTT và chuyển HTTP vào PostgreSQL.
- **26/26 automated tests PASS** trên Node 24: bổ sung proxy session theo người dùng, chặn truy cập không đăng nhập, quyền admin, Origin, cookie Path/HttpOnly, CSV và cấu trúc sáu trang không lưu payload bệnh nhân dùng chung.
- Chrome headless trên runtime Docker: đăng nhập nurse, sáu thiết bị online và sáu đèn có ACK; bốn đồ thị SVG có đường số đo; phiếu 12 cột, tạo PDF khi in; tải CSV; bảng tám kênh cảm biến; dialog xác nhận EMR; dialog timeline và nút tiếp nhận yêu cầu.
- Kiểm tra role trên giao diện: nurse bị chặn trang quản trị; admin xem đủ chín trường cấu hình/audit. Một browser context riêng chưa đăng nhập không thấy các thẻ bệnh nhân. Không ghi nhận lỗi runtime/component trong các thao tác này.
- Kiểm tra màn hình 390px không tràn ngang trang. Ảnh minh chứng: [Tổng quan](screenshots/flowfuse-overview.png), [Bệnh nhân](screenshots/flowfuse-patient.png), [Phiếu sinh tồn](screenshots/flowfuse-sheet.png), [Điện thoại](screenshots/flowfuse-mobile.png).
- Bản in đã được render và kiểm tra lại sau khi tách CSS khỏi bố cục FlowFuse: **một trang A4 ngang**, đủ 12 cột thời gian và sáu hàng chỉ số, không cắt mép. [Ảnh bản in](screenshots/flowfuse-print.png).
- Đã xác nhận tồn tại bản sao flow và credential trước chuyển đổi trong volume `/data`. Simulator Docker dùng cho kiểm tra đã dừng sau kiểm thử; dashboard, API, broker và PostgreSQL tiếp tục chạy. Sáu phiên Wokwi không được khởi động trong đợt chuyển giao diện này.
- Giới hạn: đợt kiểm tra UI mới mở dialog xử lý/xác nhận, không sửa các yêu cầu chăm sóc sẵn có hoặc gửi mẫu vào EMR; chuyển trạng thái và EMR được kiểm thử bằng bộ test nghiệp vụ. Bản demo local `npm run demo` vẫn dùng giao diện HTML cũ.

## Cập nhật build sáu firmware bằng PlatformIO của VS Code — 10/10/2026

- Khắc phục `UnknownPlatform`: bộ `espressif32@6.9.0` tại `C:\Users\khang\.platformio\platforms` bị thiếu `platform.json`; đã chuyển bộ thiếu file vào thư mục `recovery` và cài lại đúng phiên bản.
- Chạy `scripts/build-firmware.ps1` bằng PlatformIO Core 6.2.0 / Python 3.11.7 của VS Code, core directory `C:\Users\khang\.platformio`. Cả **6/6 project dev-hp01 … dev-hp06 build SUCCESS**.
- Mỗi project có `.pio/build/esp32dev/firmware.bin` và `firmware.elf`, khớp cấu hình `wokwi.toml`. RAM 47.196 byte, flash 849.949 byte cho mỗi bộ trong lượt build này. Cảnh báo OneWire không làm build thất bại.
- Kiểm tra header ESP32 binary, header ELF, chuỗi device ID riêng và SHA-256 khác nhau cho sáu binary. Chi tiết ở [firmware-build-results.json](firmware-build-results.json).
- Chưa chạy sáu phiên Wokwi/gateway trong bước xác minh này. Build thành công chỉ xác nhận firmware được tạo, không thay thế kiểm thử kết nối và sensor trong simulator.

## Cập nhật Docker — 10/10/2026

- Sửa trùng cổng bằng biến `DOCKER_MQTT_PORT`, `DOCKER_HTTP_PORT`, `DOCKER_NODE_RED_PORT`. Trên máy này Docker dùng MQTT 1885, dashboard 3001, Node-RED 1880; giữ bản demo local 3000/1884 và broker có sẵn 1883.
- Sửa entrypoint Node-RED để thực thi `prepare.cjs` trước khi chạy runtime với `/config/settings.js`. Chuẩn bị flow bằng ghi file tạm rồi rename để thay được file mặc định thuộc root trong volume mà vẫn chạy dưới user node-red.
- Đã khởi động thực: API, PostgreSQL, Node-RED healthy; Mosquitto chạy; Node-RED báo Connected to broker. Editor trả HTTP 200 và nạp đủ 8 node của project.
- Kiểm thử sáu MQTT simulator tạm trên Docker: cả 6 giường online; dữ liệu qua Node-RED và PostgreSQL; SpO₂ thấp tạo cảnh báo, lệnh `red_blink` có ACK; trở về bình thường thì cảnh báo phục hồi. Truy vấn lịch sử PostgreSQL trả đúng 10 mẫu theo giới hạn. Phát 90 bản tin telemetry, không có lỗi publish.
- Đã dừng sáu simulator tạm sau kiểm thử. Docker tiếp tục chạy; cần Wokwi hoặc profile simulator để nhận dữ liệu mới liên tục. Đây là smoke test runtime, chưa phải thử tải dài hoặc xác nhận mọi tình huống lỗi qua Node-RED.
- Biên dịch lại `firmware/dev-hp01` với cổng cấu hình 1885: SUCCESS; RAM 47.196 byte, flash 849.861 byte. Sáu config/sketch đều dùng `MQTT_PORT`; chưa biên dịch độc lập năm bộ còn lại.

Các kết quả kiểm thử ứng dụng và thử tải dưới đây được thực hiện ngày 08/10/2026.

## Đã thực hiện

| Hạng mục | Kết quả và giới hạn |
|---|---|
| Node.js | v24.19.0 trên Windows; Node hệ thống v20 không đáp ứng `node:sqlite` |
| Automated tests | **24/24 PASS**, `node --test --test-concurrency=1 tests/*.test.js` |
| MQTT end-to-end | 6 publisher độc lập có xác thực → ingestion → SQLite → rule → command → ACK từ actuator phần mềm |
| API/workflow | Định danh, payload sai cấu trúc, chống trùng theo JSON chuẩn hóa, lịch sử có giới hạn, sustain/recovery, chuyển giường/đến trễ, offline, tái escalation, các bước chăm sóc, khôi phục DB, quyền truy cập |
| Tính nhất quán và lỗi kết nối | Reader không thấy dữ liệu chưa commit; rollback không lộ thay đổi; chất lượng tín hiệu được phân biệt; publish ACK có timeout để worker không treo |
| EMR | Xác nhận idempotent; thử đích lỗi → pending/retry → gửi thành công tới sandbox; huyết áp có hai FHIR component |
| Firmware | `firmware/dev-hp01` biên dịch **SUCCESS**, ESP32 / espressif32 6.9.0; RAM 47.196 / 327.680 byte, flash 849.861 / 1.310.720 byte |
| Các project firmware khác | Ngày 08/10 mới build dev-hp01; ngày 10/10 đã build độc lập cả sáu bộ bằng PlatformIO của VS Code, xem phần cập nhật đầu tài liệu |
| Dashboard | Đăng nhập, sáu giường cập nhật, mở bệnh nhân, thay kịch bản SpO₂ thấp, cảnh báo, đèn đỏ nhấp nháy và ACK, trở về bình thường; mở phiếu có đường biểu diễn khớp cột. Sau rà soát đã thao tác tiếp nhận → đến giường → xử lý → ghi nhận → hoàn tất yêu cầu mất dữ liệu HP-06 trên trình duyệt |
| Docker Compose | Ngày 08/10 kiểm tra cấu hình; đã bổ sung smoke test runtime ngày 10/10 ở phần cập nhật phía trên |
| Dependency | `npm audit`: 0 vulnerabilities tại thời điểm cài và cập nhật dependency |

Thư viện OneWire có hai compiler warning `extra tokens at end of #undef directive`; firmware vẫn build thành công. Trên Windows đường dẫn repo dài làm toolchain báo `CreateProcess: No such file or directory`; dùng đường dẫn core PlatformIO ngắn trong thư mục tạm đã khắc phục. Với máy khác nên dùng `PLATFORMIO_CORE_DIR` ở đường dẫn ngắn.

Ảnh kiểm tra giao diện sau rà soát: [Biểu đồ bệnh nhân](screenshots/patient-charts.png), [Phiếu chức năng sống](screenshots/patient-sheet.png). Khoảng trống trên biểu đồ phản ánh lúc demo ngừng phát dữ liệu, không được nối bằng số đo giả.

Kết quả thử tải thật nằm trong `load-results.json` (timestamp UTC trong file). Mỗi mức chạy khoảng 10 giây, 1 mẫu/device/giây, database SQLite trên ổ đĩa. Đây là phép thử smoke trên máy đang chạy demo, không phải chứng nhận năng lực hoặc benchmark PostgreSQL:

| Thiết bị | Đã phát / đã nhận | Thiếu | p95 đo → bắt đầu nhận | Truy vấn lịch sử |
|---|---|---|---|---|
| 6 | 60 / 60 | 0 | 315 ms | 1,65 ms |
| 10 | 100 / 100 | 0 | 64 ms | 1,03 ms |
| 20 | 200 / 200 | 0 | 192 ms | 1,23 ms |
| 40 | 400 / 400 | 0 | 201 ms | 1,33 ms |

Không cộng thời gian duy trì rule vào số đo trên. Dashboard polling 3 giây nên số này **không** phải latency cập nhật UI hoặc quyết định→ACK. File cũng ghi CPU, RSS và kích thước DB. Thử tải được chạy lại sau đợt rà soát cùng bộ 24 kiểm thử.

## Chưa thực hiện, cần kiểm chứng tại môi trường demo đầy đủ

1. **Docker kiểm thử mở rộng:** smoke test Node-RED/PostgreSQL đã đạt ngày 10/10. Chưa chạy toàn bộ tình huống nghiệp vụ, mất mạng, restart và thử tải dài qua bộ Docker; bộ 24 kiểm thử tự động ban đầu dùng SQLite.
2. **Sáu phiên Wokwi đồng thời:** đã có đầy đủ sketch, config, diagram, libs, PlatformIO và wokwi.toml; chưa mở tài khoản Wokwi/gateway và quan sát LED trên sáu simulator. Firmware đã compile không đồng nghĩa sơ đồ/gateway đã được chạy xác nhận.
3. **HIS/EMR thật:** chỉ sandbox local; chưa tích hợp API bệnh viện, bệnh nhân thật, nhập/xuất khoa hai chiều hoặc ký hồ sơ.
4. **Thử tải dài:** chưa stress test nhiều giờ, đo độ trễ render UI, mất gói có chủ ý hoặc kiểm định y tế.
5. **Sản phẩm học phần ngoài code:** chưa quay video, viết báo cáo PDF 15–25 trang hoặc làm slide; README có kịch bản demo và tài liệu IIAF để nhóm tiếp tục chuẩn bị.

## Checklist chạy Wokwi/Docker tiếp

- Tắt riêng demo đang chạy nếu dùng cùng cổng; không dừng broker/dịch vụ khác của máy.
- Bật Docker Desktop Linux containers, chọn cổng host còn trống, chạy Compose.
- Trong Node-RED kiểm tra MQTT node connected, HTTP ingestion không có lỗi; thử ngắt API để quan sát giới hạn forwarding đã công bố trong architecture.md.
- Mở từng Wokwi project với Private Gateway, kiểm tra patient/assignment trong Serial payload.
- Đổi sensor/biến trở, quan sát LED thật trên Wokwi, command_id và ACK đúng device/giường.
- Chuyển giường và phát mẫu đến trễ; kiểm tra DB và phiếu không nhầm bệnh nhân.
- Restart API/Node-RED và ESP32, kiểm tra trạng thái mở được phục hồi và đèn nhận lệnh mới.
- Chụp/ghi hình từng kết quả để đưa vào báo cáo; không đánh dấu PASS những bước chưa chạy.
