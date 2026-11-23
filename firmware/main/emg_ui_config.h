#pragma once

/* ESP32-WROOM-32 + SSD1306 I2C 128x64 + WebSocket UI.
 * Keep real Wi-Fi credentials in a gitignored main/emg_ui_secrets.h when needed. */
#if defined(__has_include)
#if __has_include("emg_ui_secrets.h")
#include "emg_ui_secrets.h"
#endif
#endif

#define EMG_UI_VERSION       "0.3.0+ui.0.3.0"
#ifndef EMG_WIFI_SSID
#define EMG_WIFI_SSID        "YOUR_WIFI_2G4"
#endif
#ifndef EMG_WIFI_PASSWORD
#define EMG_WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"
#endif

/* Changes to source/filter/sample rate belong in config.c by default. */
#define EMG_REMOTE_TECH_CONFIG_ENABLE 0

#define EMG_OLED_ENABLE      1
#define EMG_OLED_SDA         21
#define EMG_OLED_SCL         22
#define EMG_OLED_ADDRESS     0x3C
#define EMG_OLED_I2C_HZ      100000
#define EMG_OLED_REFRESH_MS  250
#define EMG_OLED_FLIP_180    0
#define EMG_OLED_CONTRAST    0x7F

#define EMG_WS_ENABLE         1
#define EMG_WS_PORT           80
#define EMG_WS_SNAPSHOT_MS    200
#define EMG_WS_FRAME_CAP      1536
#define EMG_WS_PROTOCOL_VERSION 1

#ifndef EMG_WS_AEAD_ENABLE
#define EMG_WS_AEAD_ENABLE    1
#endif
#ifndef EMG_WS_AEAD_KEY_HEX
#define EMG_WS_AEAD_KEY_HEX   "000102030405060708090a0b0c0d0e0f"
#endif
