# This is main/CMakeLists.txt, NOT the project-root CMakeLists.txt.
idf_component_register(
    SRCS "main.c" "config.c" "engine.c" "source.c" "protocol.c" "replay_data.c"
         "emg_adc.c" "emg_ui.c" "web_server.c" "ws_aead.c" "oled_view.c" "oled_ssd1306.c"
         "tinyjambu/tinyjambu-128-aead.c"
         "tinyjambu/backend/tinyjambu-aead-common-128.c"
         "tinyjambu/backend/tinyjambu-128-c32.c"
         "tinyjambu/backend/tinyjambu-128-asm-xtensa.S"
         "tinyjambu/backend/tinyjambu-util.c"
    INCLUDE_DIRS "." "tinyjambu" "tinyjambu/backend"
    REQUIRES esp_timer freertos esp_wifi esp_event esp_netif nvs_flash
             esp_driver_i2c esp_adc esp_http_server lwip)
