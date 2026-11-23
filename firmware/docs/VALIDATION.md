# Validation — Firmware Core 0.3.0 (ESP32-WROOM-32E)

Kiến trúc hiện tại: ESP-IDF C11 cho **ESP32-WROOM-32E** (`target: esp32`), màn hình **OLED SSD1306 I²C 128×64**, **WebSocket cục bộ (`semg_v2`) mã hóa TinyJAMBU-128 AEAD**, driver **ADC1 DMA (`GPIO34` / `ADC_CHANNEL_6`)** với oversampling 16× + `adc_cali` Line Fitting, và giao thức đồng bộ **`timing_v1` + `oled_sequence`**.

## 1. Kiểm thử tự động (Host C11 & Web App)

### Firmware host tests (`python tests/run_tests.py`)
Biên dịch bằng GCC C11 với `-Wall -Wextra -Werror -Wformat=2`:
- `test_core`: kiểm thử bộ lọc Butterworth, phát lại GRABMyo (`REPLAY`), 2 kênh mô phỏng, hiệu chuẩn tách rời, hysteresis & đếm tại cạnh thả, lọc xung ngắn, phát hiện gián đoạn mẫu (`data_discontinuity`), từ chối cấu hình lỗi theo giao dịch, quy đổi `tr_adc_block()` theo thông số INA333+MCP601 (`uV` và `ADC`), ánh xạ an toàn `"count"` $\rightarrow$ `"ADC"`, từ chối `TR_ADC` > 1 kênh, và fuzzing 12.000 gói JSON.
- `test_features`: kiểm thử sổ lượt/thời gian nghỉ (`rest_ms`), vùng mục tiêu liên tục (`target_zone`), mã hóa/xác thực **TinyJAMBU-128 AEAD** (gồm NIST KAT Count=1, kiểm tra chống phản xạ AD hai chiều, sai khóa, sửa ciphertext), decimation 16× + bộ đếm clipping (`emg_adc_decimate_16x`), snapshot `semg_v2` cho nguồn `sensor` với đầy đủ metadata `conversion` (`uV` và `ADC`, có/không `adc_cali`), và xử lý **`timing_v1` (`ping`/`pong`) + `oled_sequence`**.
- `test_sync`: kiểm thử đồng bộ engine $\leftrightarrow$ OLED framebuffer 128×64 (chế độ luyện tập và đếm tự do), kiểm tra khóa cấu hình kỹ thuật và bộ đồng bộ lệnh nội bộ `emg_ui_execute()`.
- `test_ssd1306`: kiểm thử mô phỏng RAM SSD1306 (địa chỉ ngang, 8 trang 128 byte, xóa RAM trước display-on, mô phỏng lỗi I²C và dọn tài nguyên).

### Web App & WebSocket integration tests
- `npm test` (Vitest): kiểm thử `SimulationEngine`, `biofeedback`, `TinyJAMBU-128 AEAD`, `firmwareMapper`, `frameSchema`, `PacketGate` (cả nguồn `simulation`, `replay`, và `sensor` với đơn vị `uV` + `conversion` và `ADC`), `timing_v1`, `oled_sequence`, lưu trữ IndexedDB và giao diện phản hồi.
- `npm run test:ws`: kiểm thử WebSocket thực tế end-to-end với Node virtual ESP32 qua kênh mã hóa TinyJAMBU-128 AEAD (handshake, calibrate, start, stop, reconnect, `timing_v1` RTT/sample_age, từ chối khóa sai).

### Biên dịch mục tiêu ESP32 (`idf.py build`)
- Kiểm chứng biên dịch sạch trên target `esp32` với ESP-IDF 6.1, bao gồm component `esp_adc` (`adc_continuous`, `adc_cali` Line Fitting), `esp_http_server` (WebSocket), `esp_driver_i2c` (SSD1306) và TinyJAMBU-128 Xtensa assembly.

## 2. Giới hạn kiểm thử tại môi trường host
- Unit tests host và mô phỏng SSD1306/WebSocket xác nhận logic DSP, giao thức và biên dịch firmware nhưng không thay thế phép đo trực tiếp trên phần cứng vật lý.
- Cần chạy kiểm chứng trên bo ESP32-WROOM-32E + OLED SSD1306 + mạch AFE INA333/MCP601 (kiểm tra nền DC `1,65 V` trên `GPIO34`, biến trở `R16`, không clipping, và thu số liệu `LatencyPanel` khi kết nối Wi-Fi thực tế).

## 3. Tài liệu tham chiếu API
- ESP-IDF ADC Continuous Mode (DMA): https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/peripherals/adc_continuous.html
- ESP-IDF ADC Calibration (Line Fitting): https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/peripherals/adc_calibration.html
- ESP-IDF I2C Master Driver: https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/peripherals/i2c.html
- ESP-IDF HTTP Server WebSocket: https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/protocols/esp_http_server.html
