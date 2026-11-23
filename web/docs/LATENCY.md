# Đối chiếu OLED, trạng thái phiên và biểu đồ

## Điều app thực hiện được

- Controller nhận một snapshot đã xác thực rồi cập nhật cùng lúc trạng thái, pha, lượt và mẫu RMS theo cùng `session_id/sequence/t_ms`.
- Không đếm lại lượt bằng RMS trên web; không dùng timer độc lập để chuyển co–thả hoặc kéo lại cả backlog chỉ dẫn khi nối lại.
- Biểu đồ không có animation tween giữa hai packet. Việc vẽ đường giữa mẫu có thật không tạo điểm đo mới.
- Khi mở lại sau bị tạm ngưng, kết nối mới lấy trạng thái hiện tại. Adapter đóng socket cũ trước khi mở lại để không có hai luồng cùng phát.
- Command STOP tách khỏi dữ liệu đồ thị; snapshot chứa sổ lượt đầy đủ giữ kết quả khi packet hiển thị bị bỏ.

Những việc này đảm bảo tính nhất quán logic trong web. Không thể chứng minh hoặc bảo đảm độ trễ vật lý bằng 0 giữa Wi-Fi, browser và SSD1306 nếu chưa đo.

## Phần firmware cần bổ sung

Các trường dưới là mở rộng **tùy chọn** của snapshot v1. Chỉ quảng bá capability khi triển khai thực sự:

```json
{
  "capabilities":["timing_v1"],
  "device_clock_ms":123456.0,
  "sampled_at_device_ms":123447.0,
  "oled_sequence":72
}
```

- `device_clock_ms`: clock đơn điệu trên ESP32 ở thời điểm tạo snapshot, cùng cơ sở với ping/pong. Có thể dùng `esp_timer_get_time()/1000.0`.
- `sampled_at_device_ms`: thời điểm của **giá trị RMS** đang gửi, không gán thời gian gửi thay cho lúc tính RMS. Với cửa sổ RMS, nhóm cần thống nhất đánh dấu ở cuối hay giữa cửa sổ và ghi rõ.
- `oled_sequence`: sequence snapshot đã thực sự gửi/vẽ lên OLED. Cần chốt ở sau bước cập nhật màn hình, không chỉ lúc đưa vào queue. Đây vẫn là chỉ dấu phần mềm, chưa phải phép đo ánh sáng vật lý.
- `boot_id` thay khi reboot để app xóa mapping clock cũ. Không dùng epoch UTC lẫn clock đơn điệu.

App chỉ gửi ping khi thấy `timing_v1`. Firmware v1 chưa hỗ trợ capability vẫn dùng bình thường, các số đo timing để trống.

```json
{"type":"ping","protocol":1,"ping_id":"b14bfae5-0ac6-46d4-948d-8df07c1b1547"}
```

Firmware phản hồi:

```json
{"type":"pong","protocol":1,"ping_id":"b14bfae5-0ac6-46d4-948d-8df07c1b1547","device_rx_ms":123500.0,"device_tx_ms":123500.8}
```

Không cần RTC của MCU khớp giờ máy tính. Client dùng `performance.now()`, giữ ping ID và t0 khi gửi; t3 khi nhận. Firmware trả t1 khi nhận, t2 khi gửi.

## Ước tính

Với t0, t3 thuộc client; t1, t2 thuộc device:

```text
network_rtt = (t3 - t0) - (t2 - t1)
offset_device_minus_client = ((t1 - t0) + (t2 - t3)) / 2
estimated_sample_age = client_received - (sampled_at_device - offset)
```

App dùng mẫu RTT thấp để ánh xạ clock trong khoảng 30 giây, hiển thị RTT hợp lệ gần nhất; loại dấu thời gian vô lý, xóa khi reconnect/reboot và hết hạn mapping sau 60 giây. Bất định do truyền hai chiều khoảng ±RTT/2 được hiển thị để tránh coi ước tính là số đo một chiều chính xác. Bất đối xứng mạng, drift clock, cửa sổ RMS, xử lý, render browser và I²C OLED đều cần xét khi kiểm chứng.

Tuổi mẫu không có timestamp/mapping được để **Chưa đo được**. Thời gian phản hồi lệnh bao gồm gửi, xử lý và ACK, không được gọi là riêng độ trễ Wi-Fi.

## Cách kiểm tra với bo thật

1. Dùng chung snapshot cho OLED và WebSocket; log `boot_id, session_id, sequence, t_ms, state, valid_count` và lúc bắt đầu/kết thúc cập nhật OLED.
2. Đặt phát snapshot thử 100–200 ms/lần. Acquisition/DSP tiếp tục ở nhịp riêng; không gửi raw 2.048 Hz vào UI.
3. Ở vòng mạng chỉ giữ bản hiển thị mới nhất; giữ sổ lượt/sự kiện riêng. Không để STOP đợi sau một hàng dài dữ liệu màn hình.
4. Bật timing_v1, đo RTT/tuổi mẫu bằng nhật ký app. Đối chiếu cùng session/sequence với log firmware.
5. Để đo chênh lệch vật lý, quay OLED và web cùng khung hình bằng camera có tốc độ biết trước, hoặc dùng trigger/GPIO + logic analyzer cho đường xử lý và OLED. Không dùng việc bấm hai đồng hồ độc lập để kết luận đồng bộ.
6. Chạy nhiều pha: hiệu chuẩn, co–giữ–thả, dừng, mạng yếu, packet drop, khóa màn hình, mở lại và reboot bo. Báo median/p95, cỡ mẫu và môi trường; không lấy một lần đo đẹp làm cam kết.
7. Nếu trễ: kiểm tra task chặn, tần suất OLED/I²C, backlog, kích thước JSON, socket cũ, render và Wi-Fi trước khi tăng tần suất.

Không làm trễ cố ý OLED để che độ trễ web. Nhóm cần chọn và nêu một tiêu chí nghiệm thu sau khi đo thực tế, ví dụ một khoảng chênh cho phép, thay vì hứa đồng thời tuyệt đối.

## Kết quả hiện tại

- Đã chạy ping/pong và metadata clock qua WebSocket thật với **Node virtual ESP32**, cùng các unit test thời gian tổng hợp.
- Chưa kết nối ESP32/OLED thật; chưa có số median/p95 phần cứng.
- Chưa đo độ trễ loa/giọng nói trên iPhone. Âm báo đọc trạng thái đã xác nhận, dừng khi ẩn/mất dữ liệu hoặc tuổi mẫu ước tính >500 ms lúc đang đo/tập, nhưng vẫn phụ thuộc hệ điều hành.

## Nguồn API đã đọc

- https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/speak
- https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures
