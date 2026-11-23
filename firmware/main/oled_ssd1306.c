/* SSD1306 I2C 128x64 driver for ESP-IDF 5.3+/6.x. No Arduino dependency. */
#include "emg_ui.h"
#include "emg_ui_config.h"
#include "oled_view.h"
#include <stdint.h>
#include <string.h>
#include "driver/i2c_master.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_timer.h"

#if EMG_OLED_FLIP_180 != 0 && EMG_OLED_FLIP_180 != 1
#error "EMG_OLED_FLIP_180 must be 0 or 1"
#endif
static i2c_master_bus_handle_t bus;
static i2c_master_dev_handle_t display;
static const char *TAG="emg_ssd1306";
static uint64_t rendered_sequence;
static bool rendered_valid;
#ifdef ESP_PLATFORM
static portMUX_TYPE rendered_lock=portMUX_INITIALIZER_UNLOCKED;
#endif
static void mark_rendered_sequence(uint64_t seq) {
#ifdef ESP_PLATFORM
    portENTER_CRITICAL(&rendered_lock);
#endif
    rendered_sequence=seq;
    rendered_valid=true;
#ifdef ESP_PLATFORM
    portEXIT_CRITICAL(&rendered_lock);
#endif
}
uint64_t emg_oled_last_sequence(bool *valid) {
#ifdef ESP_PLATFORM
    portENTER_CRITICAL(&rendered_lock);
#endif
    uint64_t seq=rendered_sequence;
    bool ok=rendered_valid;
#ifdef ESP_PLATFORM
    portEXIT_CRITICAL(&rendered_lock);
#endif
    if(valid)*valid=ok;
    return seq;
}
static void delay_ms(uint32_t ms) {
    TickType_t n=pdMS_TO_TICKS(ms);vTaskDelay(n?n:1);
}
static esp_err_t commands(const uint8_t *cmd,size_t n) {
    uint8_t packet[32];
    if(n+1>sizeof(packet))return ESP_ERR_INVALID_SIZE;
    packet[0]=0;memcpy(packet+1,cmd,n);
    return i2c_master_transmit(display,packet,n+1,100);
}
static void release_bus(void) {
    if(display){(void)i2c_master_bus_rm_device(display);display=NULL;}
    if(bus){(void)i2c_del_master_bus(bus);bus=NULL;}
}
static esp_err_t refresh(const uint8_t frame[EMG_OLED_FRAME_BYTES]) {
    const uint8_t address[]={0x21,0,127,0x22,0,7};
    esp_err_t err=commands(address,sizeof(address));
    uint8_t packet[129];packet[0]=0x40;
    for(unsigned page=0;page<8 && err==ESP_OK;page++) {
        memcpy(packet+1,frame+page*128,128);
        err=i2c_master_transmit(display,packet,sizeof(packet),100);
    }
    return err;
}
static esp_err_t init_display(void) {
    const i2c_master_bus_config_t cfg={
        .i2c_port=0,.sda_io_num=EMG_OLED_SDA,.scl_io_num=EMG_OLED_SCL,
        .clk_source=I2C_CLK_SRC_DEFAULT,.glitch_ignore_cnt=7,
        .flags.enable_internal_pullup=true
    };
    esp_err_t err=i2c_new_master_bus(&cfg,&bus);
    if(err!=ESP_OK)return err;
    delay_ms(100);
    err=i2c_master_probe(bus,EMG_OLED_ADDRESS,100);
    if(err!=ESP_OK){release_bus();return err;}
    const i2c_device_config_t dev={.dev_addr_length=I2C_ADDR_BIT_LEN_7,
        .device_address=EMG_OLED_ADDRESS,.scl_speed_hz=EMG_OLED_I2C_HZ};
    err=i2c_master_bus_add_device(bus,&dev,&display);
    if(err!=ESP_OK){release_bus();return err;}
    const uint8_t setup[]={0xAE,0xD5,0x80,0xA8,0x3F,0xD3,0,0x40,
        0x8D,0x14,0x20,0,
        EMG_OLED_FLIP_180?0xA0:0xA1,EMG_OLED_FLIP_180?0xC0:0xC8,
        0xDA,0x12,0x81,EMG_OLED_CONTRAST,0xD9,0xF1,0xDB,0x20,0xA4,0xA6};
    err=commands(setup,sizeof(setup));
    /* Clear RAM before display-on to avoid random startup pixels. */
    uint8_t empty[EMG_OLED_FRAME_BYTES]={0};
    if(err==ESP_OK)err=refresh(empty);
    const uint8_t on[]={0xAF};
    if(err==ESP_OK)err=commands(on,sizeof(on));
    if(err!=ESP_OK)release_bus();
    else ESP_LOGI(TAG,"SSD1306 initialized at 0x%02X, SDA=%d SCL=%d",
        (unsigned)EMG_OLED_ADDRESS,EMG_OLED_SDA,EMG_OLED_SCL);
    return err;
}
void emg_oled_task(void *arg) {
    (void)arg;
    tr_session_t previous=TR_ERROR;
    uint32_t state_since=0;
    for(;;) {
        if(!display) {
            esp_err_t err=init_display();
            if(err!=ESP_OK) {
                ESP_LOGE(TAG,"SSD1306 init failed (%s); check power/pins/address; retry in 5 s",esp_err_to_name(err));
                delay_ms(5000);continue;
            }
        }
        emg_ui_snapshot_t s;
        if(emg_ui_read_snapshot(&s)) {
            uint32_t now=(uint32_t)(esp_timer_get_time()/1000);
            if(s.state!=previous){previous=s.state;state_since=now;}
            bool wifi;emg_ui_link_state(&wifi);
            uint8_t frame[EMG_OLED_FRAME_BYTES];
            emg_oled_render(&s,wifi,now,now-state_since,frame);
            esp_err_t err=refresh(frame);
            if(err!=ESP_OK) {
                ESP_LOGE(TAG,"SSD1306 write failed (%s); reconnecting",esp_err_to_name(err));release_bus();
            } else {
                mark_rendered_sequence(s.sequence);
            }
        }
        delay_ms(EMG_OLED_REFRESH_MS);
    }
}
