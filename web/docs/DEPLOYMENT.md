# Triển khai và kiểm tra riêng từng môi trường

## Bản đã bàn giao

Build tĩnh Vite, mặc định không có cấu hình Supabase. Toàn bộ mô phỏng và dữ liệu lịch sử chạy trên thiết bị người dùng. Site được phát hành ở chế độ riêng tư; URL HTTPS không tự động có nghĩa là đã chia sẻ công khai. Chủ sở hữu có thể yêu cầu thay đổi quyền xem trước khi chia sẻ cho người khác.

Code giữ trong kho nguồn của Site. Gói ZIP tải xuống chứa mã nguồn, lockfile, biến môi trường mẫu, schema và tài liệu; không chứa credential, `.env.local`, dữ liệu cá nhân hay metadata triển khai của Site.

## Production HTTPS

```bash
npm ci
npm run bundle:source
npm run build
```

Phục vụ thư mục `dist` ở root origin. Đặt MIME chuẩn cho `.webmanifest` và `.js`; `sw.js` và HTML nên có `Cache-Control: no-cache`, file assets có hash có thể cache dài. Nếu dùng subpath, cần đổi `base`, manifest scope/start URL và các path service worker trước khi build.

Các biến `VITE_SUPABASE_*` được nhúng lúc build: điền `.env.local` rồi build lại, không chỉ đặt biến runtime trên máy chủ tĩnh. Chỉ dùng URL và anon/publishable key. RLS phải bật trước khi bật Auth và đồng bộ. Không đẩy service_role/secret key vào frontend, firmware hoặc kho Git.

Đã chuẩn bị Storage `signals` private và bảng metadata. V1 không ghi mẫu EMG thô. Không có realtime cloud trung gian cho tín hiệu trực tiếp: Supabase là chỗ lưu kết quả/lịch sử, không dùng để chuyển từng mẫu EMG.

## Web nội bộ

Bản frontend có thể chạy từ máy chủ nội bộ, cùng mạng ESP32, qua HTTP. Dữ liệu trực tiếp dùng WS cùng mạng. Tài nguyên cần sẵn có trước khi tắt Internet. HTTP ở địa chỉ IP LAN thường không phải secure context: không hứa service worker/PWA đầy đủ. `localhost` có ngoại lệ cho phát triển, không đồng nghĩa `192.168.x.x` có cùng quyền.

Lệnh thử bằng Node virtual ESP32, không phải bo thật:

```bash
npm run build
npm run emulator
```

Mở `http://localhost:8787`, chọn Thiết bị, nhập `ws://localhost:8787/ws`. Công cụ này phục vụ cả `dist` và WebSocket. Dữ liệu vẫn là mô phỏng. Muốn truy cập từ điện thoại cùng mạng tin cậy cần đặt host `0.0.0.0` và dùng IP máy tính; xem README. Không mở cổng giả lập ra Internet.

## Public HTTPS với cảm biến thật

Không dùng `ws://192.168…` từ trang HTTPS. Adapter chặn cấu hình này. Các phương án cần tích hợp và thử riêng:

1. Gateway trong mạng nhận WS từ ESP32 và phục vụ WSS có chứng chỉ hợp lệ cho app.
2. ESP32/gateway chủ động kết nối một broker/backend bảo mật; app kết nối cùng backend qua WSS. Cần giới hạn quyền, ghép thiết bị và kiểm chứng độ trễ.
3. Phục vụ web nội bộ trực tiếp từ cùng môi trường thiết bị; không gọi đây là kết nối public HTTPS đã hỗ trợ.

Tự ký chứng chỉ hoặc cấp quyền mạng nội bộ không được giả định là đủ trên mọi Safari. V1 không triển khai broker, TLS trên firmware, cấp chứng chỉ, NAT traversal hoặc Web Bluetooth trên iPhone.

## iPhone và ngoại tuyến

Mở URL HTTPS trong Safari → Chia sẻ → Thêm vào MH chính. Chạy online ít nhất một lần để service worker cài tài nguyên app. Chưa kiểm chứng khả năng cài/offline ở host riêng tư hoặc iPhone thật.

Cache không chứa lịch sử hay token: dữ liệu người dùng trong IndexedDB, Auth do Supabase quản lý. Service worker bỏ qua API/Auth và mọi request khác origin. iOS có thể thu hồi dung lượng website; xuất JSON/CSV hoặc đồng bộ để có bản sao. Khi khóa màn hình, web có thể dừng; trên thiết bị thật snapshot khi mở lại là nguồn xác nhận. Không cam kết Background Sync, WebSocket nền hay thời gian cập nhật trên Safari.

## Cấu hình tài khoản và quyền thiết bị

`devices` là registry theo owner, chưa phải một cơ chế ghép phần cứng có xác thực. V1 chưa cho quản trị viên chia sẻ quyền điều khiển thiết bị giữa tài khoản. Phải bổ sung claim/challenge vật lý, xác thực WSS và chính sách điều khiển trước khi nhiều người sử dụng cảm biến thật. Không dùng MAC/device ID làm mật khẩu.

## Nguồn tham chiếu đã đọc (18/10/2026)

- https://supabase.com/pricing — hạn mức Free; kiểm tra lại trước triển khai.
- https://supabase.com/docs/reference/javascript/upsert — upsert bằng khóa ổn định.
- https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications — lifecycle, lỗi và secure WebSocket.
- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers — secure context, cài cache và ngoại tuyến.

Các giới hạn nền tảng cần được kiểm tra trên phiên bản hệ điều hành và trình duyệt thực tế được dùng trong buổi demo.
