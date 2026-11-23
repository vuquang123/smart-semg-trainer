# SMART sEMG TRAINER — cập nhật 31/10/2026

Giữ nguồn đầu vào mô phỏng để thử hoạt động trước khi hoàn tất phần cứng.

## Các mục đã triển khai

| Mục | Thay đổi |
|---|---|
| 3 — nhận biết co/nghỉ | Giữ hai ngưỡng riêng; firmware xác nhận theo số mẫu, mock web xác nhận qua 2 cửa sổ 100 ms. Xung ngắn không tạo lượt. |
| 4 — lượt, giữ, nghỉ | Ghi từng lượt khi xác nhận thả: thời điểm kết thúc, thời gian co, thời gian nghỉ trước lượt, khoảng giữ trong vùng liên tục lâu nhất, đạt/không đạt. |
| 6 — lưu kết quả | Web lưu các trường mới trong lịch sử/JSON/CSV; `tools/record_serial.py` ghi Serial, xuất RMS, từng lượt và thống kê phiên. |
| 2 — mức hoạt hóa | RMS / mốc tham chiếu × 100%; thấp <30%, vừa 30–<70%, cao ≥70%. Đây là các dải minh họa cấu hình ứng dụng, không phải phân loại mỏi hay %MVC. |
| 5 — phản hồi vùng mục tiêu | Cận dưới/cận trên độc lập với ngưỡng co/thả. Hiển thị trên thanh mức hoạt hóa và biểu đồ, âm báo tăng/giảm/giữ mức co; OLED/Blynk dùng kết quả engine. |
| 7 — chuẩn bị phân tích mỏi | `tools/raw_features.py` tính RMS/MDF/MNF ngoại tuyến từ CSV RAW. Chưa huấn luyện hoặc đưa ra ba mức mỏi. |

## Thử nhanh trên web

Trong `SMART_sEMG_TRAINER_v1.2.0/SMART_sEMG_TRAINER`:

```powershell
npm run dev
```

Mở `http://localhost:4173`, chọn mô phỏng. Trong Thiết lập:

1. Dùng mốc RMS **300 µV**, mục tiêu **5**, giữ **500 ms**.
2. Bật **Tập trong vùng mục tiêu**, để **40–70%**.
3. Bắt đầu: hiệu chuẩn nghỉ, co–giữ–thả; mô phỏng có lượt ngắn và đoạn vượt vùng.
4. Mở Âm báo để chọn bíp hoặc giọng Việt (mặc định tắt).
5. Xem Lịch sử: thời gian nghỉ, giữ và giữ liên tục trong vùng được lưu theo từng lượt; xuất CSV/JSON để đối chiếu.

Khi tắt vùng mục tiêu, tiêu chí đạt vẫn là giữ đủ lâu rồi thả. Khi bật, khoảng giữ **liên tục** trong vùng phải đủ thời gian; hai khoảng ngắt quãng không được cộng thành một. Khoảng liên tục lâu nhất được giữ lại đến cuối lượt. Đếm tự do không áp dụng mục tiêu giữ/vùng.

Mốc 300 là giá trị thử cho mô phỏng. Khi có cảm biến, cần xác lập mốc co tham chiếu của từng người/cơ/điều kiện đo và nhập vào thiết lập. Hiệu chuẩn lúc nghỉ chỉ ước lượng nền và ngưỡng co/thả, không tự đo mốc co tham chiếu. Không so sánh trực tiếp giá trị giữa các lần thay điện cực nếu chưa hiệu chuẩn phù hợp.

## ESP32 và tính nhất quán dữ liệu

Firmware **0.3.0**, WebSocket snapshot `format: "semg_v2"`:

- Gửi nguồn `simulation` / `replay` / `sensor`, ngưỡng thật, thời gian theo mẫu, thiết lập đã áp dụng và sổ lượt thật.
- ID lần khởi động phân biệt phiên sau reboot; web giữ ID phiên/lượt ổn định khi kết nối lại.
- ACK chỉ trả về sau khi engine xử lý. Các thiết lập đi cùng lệnh hiệu chuẩn được kiểm tra và áp dụng cùng nhau; lệnh sai phiên bị từ chối.
- Có tạm dừng/tiếp tục và đặt lại bộ đếm. Đặt lại bộ đếm mở ID phiên mới để bảo toàn lịch sử phía web.
- RAM giới hạn **128 lượt mỗi kênh/phiên**, gồm cả lượt không đạt. Nếu đầy trước khi đạt mục tiêu, dừng với lỗi `ledger_full`, giữ kết quả để xuất; tạo phiên mới để tiếp tục.
- Web không dựng lại dữ liệu thiếu từ firmware cũ; cần cập nhật firmware và web cùng nhau. `main/web_server.c` thay cho máy chủ WebSocket cũ.
- Thời gian giữ/nghỉ dùng đồng hồ mẫu; ngày giờ bắt đầu trên web được ước lượng theo thời điểm nhận, gắn `started_at_estimated`. Không coi đây là thời gian RTC chính xác.
- Blynk giữ 47 datastream hiện có; các trường chi tiết mới nằm trong web/Serial. OLED thêm hướng dẫn tăng/giảm/giữ trong vùng và trạng thái tạm dừng.

Build trong ESP-IDF Terminal:

```powershell
cd semg_trainer
idf.py build
```

Chưa nạp board trong lần cập nhật này. Khi có board, kiểm tra heap/độ trễ khi Wi-Fi, OLED và Blynk chạy cùng lúc; lỗi mạng/mất kết nối không được xem là lệnh dừng đã thành công.

## Ghi Serial lên máy tính

Chạy tại gốc `DTYS`; đóng Serial Monitor để giải phóng COM:

```powershell
python -m pip install pyserial
python tools/record_serial.py --port COM8 --baud 115200 --out recordings/buoi_01
```

Dừng ghi bằng Ctrl+C. Kết quả: `raw.jsonl` (giữ cả dòng log), `samples.csv`, `repetitions.csv`, `sessions.json`. Công cụ chỉ đọc, không gửi lệnh thay đổi thiết bị. Thư mục đã có `raw.jsonl` bị từ chối để tránh ghi đè.

Không có board vẫn thử được bằng gói JSON do test C sinh ra:

```powershell
python semg_trainer/tests/run_tests.py
python tools/record_serial.py --input semg_trainer/validation/firmware_snapshot.json --out recordings/thu_nghiem
```

Serial telemetry gửi lại lượt gần nhất; nếu mất nhiều gói hoặc bắt đầu ghi giữa phiên, recorder ghi rõ chỉ số lượt thiếu trong `sessions.json`. WebSocket gửi toàn bộ sổ lượt trong giới hạn 128. Recorder không đoán lại lượt bị mất. `samples.csv` là RMS, không phải EMG thô. Giới hạn số thứ tự giữa gói chỉ là chẩn đoán, không suy ra số mẫu RAW mất.

## Mở rộng mỏi cơ khi có dữ liệu RAW

CSV đầu vào một kênh, một người, một phiên; cột bắt buộc:

```csv
sample_index,value,signal_kind,source,session_id,subject_id,unit,fs_hz
0,12.3,RAW,simulation,demo_01,demo,uV,2048
1,-8.1,RAW,simulation,demo_01,demo,uV,2048
```

Cần ít nhất 2048 mẫu cho cấu hình mặc định:

```powershell
python tools/raw_features.py raw.csv --output features.csv --fs 2048 --window 2048 --hop 1024
```

RMS: trừ trung bình cửa sổ rồi tính năng lượng, chưa lọc dải trong công cụ này. MDF/MNF: FFT cửa sổ Hann, chỉ xét phổ 20–450 Hz. MDF lấy bin đầu tiên đạt nửa năng lượng; độ phân giải 1 Hz với mặc định. Tín hiệu phẳng không có chỉ số phổ hợp lệ. Cần chuẩn hóa bước lọc phần cứng/phần mềm trước khi dùng vào nghiên cứu.

Công cụ từ chối CSV RMS/envelope, mẫu không liên tục, tần số sai, nhiều phiên trộn lẫn. Nó không xác nhận dữ liệu tự gắn `RAW` là tín hiệu cảm biến thực. Phần cứng cần cung cấp đường RAW và metadata lấy mẫu; firmware hiện chưa truyền toàn bộ RAW qua Serial/WebSocket.

Để triển khai Random Forest sau này: thu bộ dữ liệu bài tập phù hợp, quy định nhãn ba mức mỏi bằng tiêu chí thực nghiệm độc lập, giữ `subject_id`/`session_id`, chia train/test theo người hoặc phiên phù hợp câu hỏi đánh giá. Không gán nhãn chỉ bằng chính ngưỡng MDF/RMS rồi dùng kết quả đó làm bằng chứng đo mỏi. Thử trên mô phỏng chỉ kiểm tra quy trình tính toán.

## Kiểm tra

```powershell
python semg_trainer/tests/run_tests.py
python -m unittest discover -s tools -v
cd SMART_sEMG_TRAINER_v1.2.0/SMART_sEMG_TRAINER
npm test
npm run check
npm run test:ws
npm run build
```

Fixture `tests/fixtures/firmware_snapshot.json` được tạo bằng serializer C trong `test_features.c`; kiểm tra TS đảm bảo không thay thế ngưỡng, nguồn, thời gian và kết quả lượt. Khi sửa giao thức, chạy lại test native và cập nhật fixture từ `semg_trainer/validation/firmware_snapshot.json`.

Chưa kiểm chứng lần cập nhật này trên OLED/ESP32 thật, âm thanh/cảm ứng Safari hoặc Supabase thật. Cấu hình Supabase mới dùng `schema.sql`; dự án đã có schema dùng migration `supabase/migrations/20261031_biofeedback.sql` để chấp nhận nguồn replay. Các trường giữ/nghỉ/vùng mới được giữ đầy đủ trong payload JSON của phiên.
