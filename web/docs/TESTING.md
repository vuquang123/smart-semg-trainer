# Kết quả kiểm thử và giới hạn bản 1.2.0

Ngày kiểm tra: 18/10/2026. Runtime: Node.js 24.19.0. Frontend: React, TypeScript, Vite; kiểm thử logic: Vitest + fake-indexeddb. Không sử dụng ESP32, OLED hay iPhone thật.

## Kết quả tự động

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Engine + giao thức | 16/16 đạt | `tests/engine.test.ts` |
| IndexedDB + outbox + export | 8/8 đạt | `tests/storage.test.ts` |
| Controller + MockTransport | 8/8 đạt | `tests/controller.test.ts` |
| Zoom/cuộn, âm báo và đồng hồ | 12/12 đạt | `tests/review-audio.test.ts` |
| WebSocket thực với Node virtual ESP32 | 13/13 kiểm tra đạt | `npm run test:ws` |
| TypeScript | Đạt | `npm run check` |
| Build production + PWA | Đạt; 10 tài nguyên shell được tạo | `npm run build` |

Tổng: **44 test Vitest đạt**, và **13 kiểm tra tích hợp WebSocket đạt**. WebSocket ở đây là socket thực giữa Node client và server mô phỏng, không phải kết nối bo hoặc kiểm thử browser.

Các tình huống được kiểm tra:

1. Hiệu chuẩn → tập → đủ 5 lượt đạt, có lượt chưa đủ thời gian.
2. Không cộng lượt ngay lúc vượt ngưỡng; chỉ xác nhận ở cạnh thả.
3. Dừng trong hiệu chuẩn, không tự vào tập.
4. Dừng khi đang tập, giữ lượt đã xác nhận và không tăng sau dừng.
5. Từ chối START trước khi sẵn sàng và RESET khi đang hoạt động.
6. Command ID lặp không tạo thêm thao tác; lệnh phiên cũ bị từ chối.
7. Packet cũ/lặp hoặc session đã nghỉ không quay lại trạng thái hiện tại.
8. Mất kết nối không được coi là đã dừng; reconnect giữ session và sổ lượt.
9. Khoảng thiếu RMS được để trống, không tạo mẫu bổ sung.
10. STOP có thể được gửi khi lệnh thường đang chờ; lệnh thường lặp bị chặn.
11. Thiếu ACK: kết thúc chờ với thông báo rõ, không cập nhật trạng thái lạc quan từ nút bấm.
12. Reset không xóa lịch sử cũ; mở lại IndexedDB giữ dữ liệu.
13. Outbox lặp không tạo thêm phiên; thử lại giãn cách; job tài khoản A không gửi bởi B.
14. ACK job cũ không làm revision mới bị đánh dấu đã đồng bộ.
15. Xóa một phiên chỉ ảnh hưởng phiên đó và tạo yêu cầu xóa cloud phù hợp.
16. CSV giữ đúng mốc nhận và điểm null; không nội suy mẫu.
17. HTTPS → WS bị chặn, LAN HTTP → WS/WSS hợp lệ được phép.
18. Recalibration giữ thời gian phiên tăng đơn điệu.
19. Khôi phục mock sau tải lại giữ ID, lượt và toàn bộ RMS đã nhận; dừng mô phỏng và không giả lập phần chạy nền bị mất.
20. Cảm biến thật muốn dùng µV phải có metadata quy đổi; dữ liệu ADC không bị giả định là µV.

## Cập nhật bố cục điện thoại

Đã tách màn hình tập ở độ rộng ≤760 px: hướng dẫn và biểu đồ chuyển qua tab, thiết lập mở bằng modal kiểu bảng từ dưới. Chỉ một vùng Bắt đầu/Dừng ở cuối màn hình tập; dock Dừng chung vẫn dùng khi chuyển sang các trang khác trong lúc đang tập. Sử dụng chung controller và thành phần thiết lập, không thay nhận diện hoặc lưu dữ liệu.

Sau thay đổi chạy lại TypeScript, 44 test hiện có và build production. Chưa kiểm chứng trực quan kích thước viewport hoặc cảm ứng bằng browser automation; checklist dưới đây vẫn cần chạy trên trình duyệt thật.

## Xem lại, âm thanh và timing v1.2.0

- Zoom quanh điểm chọn, giới hạn một giây/độ dài dữ liệu; cuộn không vượt phạm vi; không thêm mẫu hoặc lấp khoảng trống.
- Cues chỉ theo gói trạng thái xác nhận, không lặp mỗi 100 ms; packet cũ không đổi baseline; mất/nối lại không phát lại chuỗi cũ.
- Đếm ngược 3–2–1 hoàn tất mới cho phép tiếp tục; cancel/tắt âm không cho phép START sau đó; khi âm tắt không thêm thời gian chuẩn bị.
- ClockSync kiểm tra dấu thời gian không hợp lệ, tính RTT/offset/tuổi mẫu/bất định, hết hạn và reset mapping.
- WebSocket có timing: nhận ping/pong và metadata; gọi connect đồng thời dùng cùng một handshake. Không có capability timing: không gửi ping, vẫn nhận frame và để RTT chưa biết.
- Render server của các trạng thái tập, bước chuẩn bị và minh họa hai nhóm cơ đã chạy; đây không phải kiểm tra layout hoặc âm thanh.

Cần kiểm tra trực tiếp mới: nghe tiếng bíp/giọng Việt trên từng trình duyệt; gesture kéo/chụm; khả năng đọc legend từ một cánh tay; hủy đếm khi ẩn trang và âm lượng thực; đối chiếu OLED bằng log/camera. Các mục đó chưa được coi là đạt trong 44 test Node.

## Checklist kiểm tra trực tiếp

Chưa có browser-control skill trong môi trường bàn giao, nên chưa chạy browser QA, screenshot, đo layout, tooltip, thao tác cảm ứng hoặc PWA cài đặt. Các mục dưới là **chưa kiểm chứng trên trình duyệt thật**, không được coi là đã đạt chỉ vì build thành công.

### Desktop và điện thoại

- [ ] Mở màn hình 320, 375, 390, 768, 1440 px: không cuộn ngang, chữ/nút đọc được.
- [ ] Mở lần đầu, chọn thử mô phỏng, không bị yêu cầu đăng nhập.
- [ ] Hoàn thành 5 lượt, mở kết quả, kiểm tra 5 lượt đạt / 7 lượt thử ở cấu hình mặc định.
- [ ] Nút Dừng cố định luôn thao tác được cả khi cuộn và đổi tab.
- [ ] Dừng trong hiệu chuẩn và lúc giữ cơ; trạng thái chờ/đã dừng đúng.
- [ ] Chạm tooltip, xem 30/60 giây, toàn màn hình và đóng bằng nút/Escape.
- [ ] Thay cơ/mục tiêu/thời gian trước tập, xác nhận bị khóa khi tập.
- [ ] Trong Cá nhân → Khu vực phát triển: thử lệnh chậm, bỏ ACK, mất kết nối, nối lại.
- [ ] Mở lại trang sau khi đang mô phỏng: có cảnh báo khôi phục/dừng, không tạo lượt nền giả.
- [ ] CSV/JSON tải được trên Safari và mở được trong trình xem phù hợp.
- [ ] Xóa phải có xác nhận; tạo buổi mới không mất kết quả cũ.
- [ ] Reduced motion và tăng cỡ chữ hệ thống, VoiceOver, focus modal và contrast.

### PWA HTTPS / iPhone

- [ ] Service worker cài đủ shell; tắt Internet và tải lại được app.
- [ ] Thêm vào màn hình chính có icon, mở standalone, safe area đúng.
- [ ] Kiểm tra thêm lớp đăng nhập của host riêng tư khi cài/mở/offline.
- [ ] Khóa màn hình, mở lại; không giả định web vẫn chạy nền.
- [ ] Kết nối WSS thật, chứng chỉ hợp lệ, quyền mạng nội bộ và Safari thực tế.

### Supabase

- [ ] Chạy migration trên dự án thử nghiệm mới, kiểm tra SQL/RLS thực.
- [ ] Đăng nhập Email Auth và redirect đúng về origin.
- [ ] Tài khoản A không đọc/ghi được profile, phiên, repetitions và Storage của B.
- [ ] Offline → có queue → online → sync không tạo trùng ID.
- [ ] Đăng xuất/đổi tài khoản không gửi nhầm queue.
- [ ] Hai máy: lịch sử tải lại khớp; xác nhận giới hạn 100 phiên được kéo.
- [ ] Xóa offline rồi online, tombstone không làm phiên cũ xuất hiện lại.
- [ ] Kiểm tra dung lượng, quota Free, email limit/SMTP và dự án bị pause trước demo.

### Phần cứng

- [ ] Kiểm tra v1 hoặc viết bộ ánh xạ từ firmware hiện tại; hiện chưa có mã firmware đầu vào.
- [ ] Đồng bộ OLED/app qua cùng state; đo chênh lệch thời gian bằng log sequence.
- [ ] Stop trong mọi pha, restart, Wi-Fi mất, ESP32 reboot, packet drop/out-of-order.
- [ ] Đảm bảo sổ lượt giữ đủ trong firmware; nếu không còn dữ liệu phải báo thiếu.
- [ ] Kiểm chứng hệ số ADC/gain, đơn vị và độ chính xác trước khi bật nhãn µV.
- [ ] Profile CPU/heap/flash WROOM-32; không giả định frontend React vừa bộ nhớ bo.

## Giới hạn có chủ ý

- Chưa triển khai firmware, TLS/gateway, ghép thiết bị vật lý hoặc phân quyền điều khiển nhiều người.
- WebSocket là lớp tích hợp đã chạy với Node simulator; chưa chứng minh chạy trên Safari hoặc ESP32 thật.
- Supabase chưa cấu hình trong bản host, chỉ có lưu cục bộ. Schema/Auth/RLS chưa được thử với một dự án thật.
- Mock là chương trình trong trình duyệt, không phải cảm biến hoạt động độc lập khi web bị tạm ngưng. Khi tải lại, khôi phục dữ liệu đã lưu và dừng, không tạo bù tín hiệu.
- App có thể mất tối đa khoảng 1 giây dữ liệu vừa nhận nếu tiến trình bị đóng đột ngột trước autosave. Phiên ngừng/hoàn thành được yêu cầu lưu ngay; lỗi lưu được hiển thị.
- Sổ lượt đầy đủ trong snapshot phù hợp cho đồ án phiên ngắn; phiên dài cần giao thức phân trang/ACK sự kiện. RMS history không giới hạn retention tự động; cần xuất/xóa/kiểm tra dung lượng khi dùng lâu.
- Không có dữ liệu mẫu lịch sử dựng sẵn. Mọi lịch sử hiển thị đều do phiên người dùng chạy hoặc dữ liệu cloud tải về.
