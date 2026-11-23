# SMART sEMG TRAINER — Web App (`web/`)

Ứng dụng web PWA (React 19 + TypeScript + Vite) trong monorepo **smart-semg-trainer**, giao tiếp với ESP32 qua WebSocket cục bộ mã hóa TinyJAMBU-128 AEAD hoặc chạy độc lập với nguồn mô phỏng. Xem thêm [README tổng của monorepo](../README.md).

> **Lưu ý:** Không dùng cho mục đích chẩn đoán y khoa.

## Điểm chính của phiên bản hiện tại

- **1 kênh đo `CH1` thống nhất:** hỗ trợ nguồn `simulation`, `replay` (GRABMyo v1.1.0) và `sensor` (ADC ESP32). Vùng cơ (`Cẳng tay` / `Bắp tay`) là thông tin vị trí đặt điện cực của phiên trên `CH1`.
- **Chuỗi dữ liệu `CH1`:** `RAW` (`ch1_adc`/`ch1_uV`) → lọc số (`ch1_filtered`) → `RMS/envelope` (`ch1_rms_envelope`).
- **Xuất dữ liệu hai hướng:** nút **Xuất dữ liệu** tạo **Báo cáo buổi tập** (PDF tiếng Việt A4 + Excel `.xlsx`) hoặc gói **Dữ liệu nghiên cứu — RAW** (`.zip` gồm `signal_raw.csv`, `events.csv`, `metadata.json`, `README.txt` và tùy chọn `signal_processed.csv`). Lưu luồng `RAW` dùng tùy chọn opt-in trong IndexedDB.
- **Bảo mật kết nối:** trường địa chỉ thiết bị mặc định để trống (chỉ hiển thị ví dụ `192.168.1.55` làm placeholder), không tự kết nối nếu chưa nhập địa chỉ hợp lệ; bảo vệ gói tin bằng **TinyJAMBU-128 AEAD** (khóa `000102030405060708090a0b0c0d0e0f` mặc định chỉ dành cho dev/test).

## Chạy nhanh & Kiểm thử (PowerShell tại `web/`)

```powershell
npm ci
npm run dev       # Mở http://localhost:4173
```

Lệnh kiểm tra và build production:

```powershell
npm run check     # TypeScript (tsc -b)
npm test          # Vitest (chạy 1 lần)
npm run build     # Build dist/ và PWA Service Worker
npm run test:ws   # Kiểm thử WebSocket TinyJAMBU-128 AEAD với Node virtual ESP32
```

### Emulator WebSocket cục bộ

```powershell
npm run build
npm run emulator
```

Mở `http://localhost:8787`, vào **Thiết bị** nhập `ws://localhost:8787/ws` để thử kết nối giả lập (vẫn gắn nhãn nguồn mô phỏng). Để mở cho điện thoại cùng Wi-Fi LAN tin cậy, chạy `$env:SEMG_EMULATOR_HOST="0.0.0.0"; npm run emulator` hoặc dùng script trong `../scripts/windows/`.

## Cấu hình Supabase (tùy chọn)

```powershell
copy .env.example .env.local
```

Điền `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` rồi chạy `../web/supabase/schema.sql` trên dự án Supabase mới. Nếu không cấu hình, ứng dụng chạy hoàn toàn cục bộ bằng IndexedDB.

## Giấy phép

Phát hành theo [LICENSE](../LICENSE) và [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
