#pragma once

/* Sao chép file này thành firmware/main/emg_ui_secrets.h trước khi biên dịch cho ESP32 thật.
 * File firmware/main/emg_ui_secrets.h được .gitignore chặn để không đưa thông tin thật lên Git.
 *
 * Copy this file to firmware/main/emg_ui_secrets.h before building for physical hardware.
 */

#define EMG_WIFI_SSID        "YOUR_WIFI_2G4"
#define EMG_WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"

/* Khóa TinyJAMBU-128 AEAD mặc định dùng cho development/test (32 ký tự hex).
 * Hãy thay bằng khóa ngẫu nhiên riêng khi triển khai thật và nhập khóa tương ứng trên Web App.
 * Public dev/test key only; override with your own 32-hex-character key for real deployments.
 */
#define EMG_WS_AEAD_KEY_HEX  "000102030405060708090a0b0c0d0e0f"
