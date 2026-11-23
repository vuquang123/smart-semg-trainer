# SMART sEMG TRAINER — Firmware ESP32-WROOM-32E (`firmware/`)

Firmware ESP-IDF (C11) cho **ESP32-WROOM-32E** (`target: esp32`), màn hình **OLED SSD1306 I²C 128×64** và **WebSocket cục bộ (`semg_v2`) mã hóa payload bằng TinyJAMBU-128 AEAD**. Xem thêm [README tổng của monorepo](../README.md).

> **Lưu ý:** Phục vụ nghiên cứu và theo dõi luyện tập kỹ thuật sEMG; không dùng cho chẩn đoán y khoa.

## 1. Đặc tả hoạt động (1 kênh `CH1`)

- **1 kênh đo `CH1` thống nhất:** mặc định khi khởi động là `TR_SIMULATION` (`.channels = 1`, `.exercise_channel = 0`, `2048 Hz`). Các nguồn `TR_ADC` (`GPIO34` / `ADC1_CH6`) và `TR_REPLAY` (GRABMyo v1.1.0 `F1`, `30.720` mẫu @ `2048 Hz`) đều chạy cố định trên `CH1`.
- **Chuỗi xử lý trên `CH1`:**
  1. `raw_adc_codes` + hook `on_raw_block` (xuất gói `raw_batch` opt-in qua WebSocket trước bước xử lý số).
  2. `filtered`: triệt DC offset (ước lượng `1500 ms` đầu ở nguồn ADC) → lọc thông dải Butterworth 20–450 Hz bậc 4 → tùy chọn notch `0 / 50 / 60 Hz` (`Q = 30`).
  3. `rms`: cửa sổ trượt RMS (`100,1 ms`), hiệu chuẩn mức nghỉ (`5000 ms`, settle `500 ms`), nhận diện Co – Giữ – Thả bằng hysteresis (`on_factor = 1,8`, `off_factor = 1,3`, debounce `125 ms / 218,75 ms`) và lưu sổ kết quả tối đa `128` lượt/phiên kèm `start_sample_index`, `end_sample_index`, `rms_mean`, `rms_peak`, `reason_code`, `incomplete_contraction`.
- **Thu ADC1 DMA (`emg_adc.c`):** oversampling `16×` ở `32.768 Hz` → decimation `2048 Hz`, hiệu chuẩn `esp_adc/adc_cali` Line Fitting (fallback `805,86 µV/count`), gain mạch analog INA333+MCP601 mặc định `400,0`, bắt tràn DMA (`data_discontinuity`) và đếm bão hòa `0 / 4095`.

## 2. Đấu nối phần cứng

| Thiết bị ngoại vi | Chân tín hiệu | Chân ESP32-WROOM-32E | Ghi chú |
|---|---|---|---|
| OLED SSD1306 | `SDA` / `SCL` | `GPIO21` / `GPIO22` | I²C `100 kHz`, địa chỉ `0x3C` |
| OLED SSD1306 | `VCC` / `GND` | `3V3` / `GND` | Đảo chiều hiển thị bằng `EMG_OLED_FLIP_180 1` |
| Mạch AFE (INA333 + MCP601) | `VOUT_SEMG` | `GPIO34` (`ADC1_CH6`) | Input-only, `12-bit`, nền `V_Ref = +1,65 V` |
| Mạch AFE | `+3V3` / `GND` | `3V3` / `GND` | Chung mass, nguồn lọc nhiễu |

## 3. Tạo secrets cục bộ & Biên dịch ESP-IDF (tại `firmware/`)

1. Tạo file thông tin Wi-Fi / khóa AEAD cục bộ từ file mẫu (đã được `.gitignore` chặn):
   ```powershell
   cd firmware
   copy main\emg_ui_secrets.example.h main\emg_ui_secrets.h
   ```
   Cập nhật `EMG_WIFI_SSID`, `EMG_WIFI_PASSWORD` và đặt `EMG_WS_AEAD_KEY_HEX` riêng (32 ký tự hex; giá trị `000102030405060708090a0b0c0d0e0f` chỉ dùng để dev/test).
2. Trong **ESP-IDF Terminal** (`ESP-IDF >= 5.3`):
   ```powershell
   idf.py set-target esp32
   idf.py build
   idf.py -p COM8 -b 115200 flash monitor
   ```
   *(Cấu hình mặc định nằm trong `sdkconfig.defaults` và `partitions.csv`; không đưa `sdkconfig` hay `build/` lên Git.)*

## 4. Chọn nguồn qua Serial JSON (`115200 baud`, kết thúc `\n`)

```json
{"v":1,"id":1,"cmd":"configure","source":"ADC","channels":1,"exercise_channel":0,"fs_hz":2048,"unit":"uV","gain1":400}
{"v":1,"id":2,"cmd":"configure","source":"REPLAY","channels":1,"exercise_channel":0,"fs_hz":2048}
{"v":1,"id":3,"cmd":"configure","source":"SIMULATION","channels":1,"exercise_channel":0}
```

## 5. Kiểm thử C11 trên host

Xem chi tiết trong [docs/VALIDATION.md](docs/VALIDATION.md) và [docs/REPLAY_SOURCES.md](docs/REPLAY_SOURCES.md):

```powershell
cd firmware
python tests/run_tests.py
```

Kiểm thử này biên dịch và chạy 4 bộ test trên PC (`test_features`, `test_sync`, `test_ssd1306`, `test_core`) và không thay thế cho bước `idf.py build` trên target `esp32`.

## Giấy phép

Phát hành theo [LICENSE](../LICENSE) và [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) (bao gồm TinyJAMBU-128 tại [main/tinyjambu/LICENSE](main/tinyjambu/LICENSE) và trích dẫn GRABMyo v1.1.0 CC BY 4.0).
