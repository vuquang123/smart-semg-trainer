# SMART sEMG TRAINER v1.2.0

## Mã nguồn tải về

File `SMART_sEMG_TRAINER_v1.2.0.zip` là toàn bộ mã nguồn web React + TypeScript, kèm lockfile, `.env.example`, schema/RLS Supabase, giả lập WebSocket, kiểm thử và tài liệu firmware. Đã bao gồm cập nhật bố cục điện thoại trước đó; không cần chép đè từng file từ các bản cũ.

Giải nén, mở terminal tại thư mục có `package.json`:

```bash
npm ci
npm run dev
```

Mở `http://localhost:4173`. Không cần tài khoản Supabase để chạy mô phỏng. Chi tiết trong README.

## Thay đổi giao diện

- Thay robot bằng minh họa SVG cẳng tay/bắp tay trong tab Hướng dẫn và các vị trí giới thiệu. Đổi vị trí tô màu theo nhóm cơ đã chọn. Co/giữ sáng lên nhẹ; yêu cầu thả/hiệu chuẩn nhạt màu. Mất dữ liệu thì ngưng nhấn mạnh. Đây là minh họa vị trí, không phải phép đo giải phẫu hoặc lực cơ.
- Câu hướng dẫn gọn 15–16 px trên điện thoại, trạng thái ngắn trong chế độ biểu đồ; nhường diện tích cho tín hiệu.
- Chú thích RMS, Ngưỡng co, Ngưỡng thả lên 13 px trên điện thoại, 14 px ở desktop; tự xuống dòng nếu thiếu chiều ngang. Trục 12 px, tooltip 13 px. Chưa thực hiện phép đánh giá đọc ở khoảng cách một cánh tay trên thiết bị thật.
- Chế độ Biểu đồ rút gọn dòng thiết lập; vẫn mở chỉnh/xem khi chạm vào.

## Âm báo

Nhấn biểu tượng loa ở đầu trang Tập luyện hoặc vào Cá nhân → Âm báo luyện tập. Có Tắt, Bíp, Giọng nói tiếng Việt, âm lượng và Thử âm thanh. Mặc định tắt; cần thao tác người dùng để mở âm thanh theo chính sách trình duyệt.

Bíp/giọng nói theo trạng thái phiên đã được thiết bị xác nhận, không từ bộ đếm RMS riêng. Giọng Việt tùy giọng được cài trên hệ điều hành; thiếu giọng thì dùng bíp. Không xếp hàng phát lại mọi chỉ dẫn cũ. Tắt âm hoặc ẩn trang sẽ hủy âm/đếm ngược. Trong lúc đang đo/tập, tuổi mẫu ước tính lớn hơn 500 ms thì âm theo nhịp tạm ngưng để tránh chỉ dẫn quá muộn; đây là giá trị kỹ thuật ban đầu, cần điều chỉnh khi đo trên phần cứng.

Nếu bật **Đếm ngược 3–2–1**, sau hiệu chuẩn app giữ thiết bị ở `ready`, đếm ngược rồi mới gửi START. Nhấn Dừng sẽ hủy đếm và gửi STOP; không có START tự chạy sau khi đã hủy. Trạng thái chuẩn bị được hiển thị riêng, không giả định ESP32 đã vào training.

## Xem lại RMS

Mở Lịch sử → buổi tập → biểu đồ:

1. Nút kính lúp +/− để phóng to/thu nhỏ, Toàn phiên để đặt lại.
2. Sau khi zoom, kéo thanh thời gian để cuộn qua lại.
3. Bật **Kéo / chụm**: kéo một ngón/chuột để cuộn, chụm hai ngón để zoom. Chuyển về **Chạm xem** để mở tooltip.
4. Chọn một lượt trong danh sách để phóng to quanh đoạn giữ–thả tương ứng.
5. Mở toàn màn hình khi cần thêm diện tích.

Tất cả thao tác dùng mẫu đã nhận, thang Y giữ nguyên, điểm thiếu vẫn trống; không tạo thêm điểm đo để giả mượt. RMS biểu diễn mức hoạt động cơ đã xử lý, chưa tự quy đổi thành lực cơ hoặc chỉ số phục hồi.

## Đồng bộ và độ trễ

Trong Cá nhân → Khu vực phát triển → Theo dõi đồng bộ có RTT, tuổi mẫu ước tính, bất định, thời gian phản hồi lệnh, khoảng nhận gói và chênh sequence OLED nếu firmware có gửi. Xuất nhật ký 300 gói gần nhất để so với log firmware.

Các số đo chưa có nguồn phù hợp sẽ hiện **Chưa đo được**. MockTransport trong trình duyệt không có RTT Wi-Fi hay OLED thật. Node virtual ESP32 có hỗ trợ timing để kiểm tra giao thức. Chi tiết, các trường cần thêm và cách đo thực tế xem `LATENCY.md`.

## File chính đã cập nhật

| File | Vai trò |
|---|---|
| `src/components/MuscleIllustration.tsx` | Minh họa nhóm cơ theo pha |
| `src/components/SignalChart.tsx`, `src/core/chartWindow.ts` | Zoom, cuộn, chạm, kéo/chụm, chọn khoảng |
| `src/core/audio.ts`, `src/hooks/useAudioFeedback.ts`, `src/components/AudioControls.tsx` | Âm báo, tùy chọn và đếm ngược có hủy |
| `src/core/clockSync.ts`, `src/transports/websocket.ts`, `src/core/controller.ts` | Timing, handshake và nhật ký nhận |
| `src/components/LatencyPanel.tsx`, `src/review.css` | Giao diện cấu hình, cỡ chữ và kiểm tra độ trễ |
| `tests/review-audio.test.ts` | Kiểm thử cửa sổ thời gian, cue và clock |

## Giới hạn kiểm chứng

Đã kiểm tra logic bằng Node/Vitest và kết nối WebSocket với Node virtual ESP32. Không có browser-control skill trong môi trường bàn giao, nên chưa xác nhận trực quan, âm thanh, giọng Việt, pinch, cài PWA hoặc cảm ứng trên Safari/iPhone thật. Chưa đo độ trễ vật lý giữa OLED và web; cũng chưa có firmware hiện tại để sửa trực tiếp. Phiên bản này không đưa ra cam kết hai màn hình đồng thời tuyệt đối.
