#include "trainer.h"
#include "emg_adc.h"
#include "emg_ui.h"
#include "emg_ws_server.h"
#include "esp_random.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "esp_err.h"
#include "esp_timer.h"

static tr_engine_t engine;
static TaskHandle_t engine_task;
static QueueHandle_t commands, replies, telemetry;
static void run_engine(void *arg);
typedef struct { char text[TR_COMMAND_BYTES]; } command_line_t;
typedef struct { char text[TR_MESSAGE_BYTES]; } message_t;

/* A 5 ms delay must not become a zero-tick busy loop at FreeRTOS 100 Hz. */
static TickType_t wait_ticks(uint32_t ms) {
    TickType_t n=pdMS_TO_TICKS(ms);
    return n?n:1;
}
static void tick(void *unused) { (void)unused; xTaskNotifyGive(engine_task); }
static void receive_task(void *unused) {
    (void)unused;
    command_line_t line; size_t n=0; bool overflow=false;
    for(;;) {
        int ch=getchar();
        if(ch==EOF) { clearerr(stdin); vTaskDelay(wait_ticks(5)); continue; }
        if(ch=='\r')continue;
        if(ch=='\n') {
            if(n || overflow) {
                if(overflow)strcpy(line.text,"{}"); else line.text[n]=0;
                /* Apply backpressure to input only, never to the DSP task. */
                xQueueSend(commands,&line,portMAX_DELAY);
            }
            n=0; overflow=false;
        } else if(n+1<sizeof(line.text))line.text[n++]=(char)ch;
        else overflow=true;
    }
}
static void transmit_task(void *unused) {
    (void)unused; message_t msg;
    for(;;) {
        if(xQueueReceive(replies,&msg,0)==pdTRUE || xQueueReceive(telemetry,&msg,wait_ticks(5))==pdTRUE) {
            puts(msg.text); fflush(stdout);
        }
    }
}
static void reply(const char *s) {
    message_t msg;
    snprintf(msg.text,sizeof(msg.text),"%s",s);
    if(xQueueSend(replies,&msg,0)!=pdTRUE) { engine.tx_dropped++; tr_fail(&engine,"control_queue_overflow"); }
}
static void send_data(void) {
    message_t msg;
    if(!tr_telemetry(&engine,msg.text,sizeof(msg.text))) { tr_fail(&engine,"telemetry_too_large"); return; }
    if(uxQueueMessagesWaiting(telemetry))engine.tx_dropped++;
    xQueueOverwrite(telemetry,&msg);
}
static void sync_pacing(esp_timer_handle_t timer, bool *timer_running,
                        uint32_t *timer_fs, uint32_t *pending) {
    if (engine.config.source == TR_ADC) {
        if (*timer_running) {
            ESP_ERROR_CHECK(esp_timer_stop(timer));
            *timer_running = false;
            *pending = 0;
        }
        if (tr_is_acquiring(&engine)) {
            if (!emg_adc_is_running()) {
                if (!emg_adc_start(engine_task)) {
                    tr_fail(&engine, "adc_init_failed");
                    send_data();
                }
                *pending = 0;
            }
        } else if (emg_adc_is_running()) {
            emg_adc_stop();
            (void)ulTaskNotifyTake(pdTRUE, 0);
            *pending = 0;
        }
    } else {
        if (emg_adc_is_running()) {
            emg_adc_stop();
            (void)ulTaskNotifyTake(pdTRUE, 0);
            *pending = 0;
        }
        if (!*timer_running || *timer_fs != engine.config.fs_hz) {
            if (*timer_running) {
                ESP_ERROR_CHECK(esp_timer_stop(timer));
            }
            ESP_ERROR_CHECK(esp_timer_start_periodic(timer, (uint64_t)llround(TR_BLOCK * 1000000.0 / engine.config.fs_hz)));
            *timer_running = true;
            *timer_fs = engine.config.fs_hz;
            *pending = 0;
        }
    }
}
void app_main(void) {
    tr_init(&engine);
    uint8_t boot[16];esp_fill_random(boot,sizeof(boot));boot[6]=(boot[6]&15)|64;boot[8]=(boot[8]&63)|128;
    snprintf(engine.boot_id,sizeof(engine.boot_id),"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",boot[0],boot[1],boot[2],boot[3],boot[4],boot[5],boot[6],boot[7],boot[8],boot[9],boot[10],boot[11],boot[12],boot[13],boot[14],boot[15]);
    (void)emg_adc_init(&engine);
    engine.timing_valid = true;
    engine.device_clock_ms = (double)esp_timer_get_time() / 1000.0;
    engine.sampled_at_device_ms = engine.device_clock_ms;
    ESP_ERROR_CHECK(emg_ws_init()?ESP_OK:ESP_ERR_NO_MEM);
    engine.on_raw_block = emg_ws_push_raw;
    emg_ws_update(&engine);
    engine.snapshot_seq = emg_ws_sequence();
    ESP_ERROR_CHECK(emg_ui_init()?ESP_OK:ESP_ERR_NO_MEM);
    emg_ui_update(&engine);
    commands=xQueueCreate(8,sizeof(command_line_t));
    replies=xQueueCreate(16,sizeof(message_t));
    telemetry=xQueueCreate(1,sizeof(message_t));
    ESP_ERROR_CHECK(commands && replies && telemetry?ESP_OK:ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(xTaskCreate(receive_task,"commands",4096,NULL,3,NULL)==pdPASS?ESP_OK:ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(xTaskCreate(transmit_task,"telemetry",6144,NULL,1,NULL)==pdPASS?ESP_OK:ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(xTaskCreate(run_engine,"emg_engine",16384,NULL,5,NULL)==pdPASS?ESP_OK:ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(emg_ui_start()?ESP_OK:ESP_ERR_NO_MEM);
}

static void run_engine(void *arg) {
    (void)arg;
    engine_task=xTaskGetCurrentTaskHandle();
    esp_timer_handle_t timer;
    esp_timer_create_args_t args={.callback=tick,.dispatch_method=ESP_TIMER_TASK,.name="emg_block"};
    ESP_ERROR_CHECK(esp_timer_create(&args,&timer));
    bool timer_running = false;
    uint32_t timer_fs = 0;
    uint32_t init_pending = 0;
    sync_pacing(timer, &timer_running, &timer_fs, &init_pending);
    char response[TR_MESSAGE_BYTES];
    tr_status(&engine,response,sizeof(response)); reply(response);
    for(;;) {
        uint32_t pending=ulTaskNotifyTake(pdTRUE,wait_ticks(10));
        command_line_t cmd;
        if(emg_ws_process_one(&engine,response,sizeof(response))) {
            send_data();
            sync_pacing(timer, &timer_running, &timer_fs, &pending);
        }
        for(unsigned budget=0; budget<4 && xQueueReceive(commands,&cmd,0)==pdTRUE; ++budget) {
            tr_command(&engine,cmd.text,response,sizeof(response)); reply(response);
            tr_status(&engine,response,sizeof(response)); reply(response);
            sync_pacing(timer, &timer_running, &timer_fs, &pending);
            send_data();
        }
        /* UI queue commands use the same core/parser, owned by this task only. */
        for(unsigned budget=0; budget<4; ++budget) {
            response[0]=0;
            if(!emg_ui_process_one(&engine,response,sizeof(response))) break;
            if(response[0]) {
                send_data();
            }
            sync_pacing(timer, &timer_running, &timer_fs, &pending);
        }
        if(pending>1 && tr_is_acquiring(&engine))engine.backlog_ticks+=pending-1;
        if(pending>32 && tr_is_acquiring(&engine)) { tr_fail(&engine,"scheduler_overrun"); send_data(); pending=0; }
        while(pending-- && tr_is_acquiring(&engine)) {
            tr_session_t before=engine.state;
            int64_t begin=esp_timer_get_time();
            bool stepped=tr_step(&engine);
            int64_t end=esp_timer_get_time();
            uint32_t us=(uint32_t)(end-begin);
            if(us>engine.max_dsp_us)engine.max_dsp_us=us;
            if(stepped) {
                engine.sampled_at_device_ms = (double)end / 1000.0;
            }
            if(engine.config.source==TR_ADC) {
                emg_adc_sync_meta(&engine);
            }
            uint32_t every=(engine.config.fs_hz+TR_BLOCK*8-1)/(TR_BLOCK*8);
            if((stepped && engine.blocks%every==0) || before!=engine.state)send_data();
        }
        sync_pacing(timer, &timer_running, &timer_fs, &pending);
        if (!tr_is_acquiring(&engine)) {
            emg_ws_flush_raw(&engine);
        }
        engine.timing_valid = true;
        engine.device_clock_ms = (double)esp_timer_get_time() / 1000.0;
        if (!tr_is_acquiring(&engine) || engine.sampled_at_device_ms <= 0.0) {
            engine.sampled_at_device_ms = engine.device_clock_ms;
        }
        engine.oled_sequence = emg_oled_last_sequence(&engine.oled_sequence_valid);
        emg_ws_update(&engine);
        engine.snapshot_seq = emg_ws_sequence();
        emg_ui_update(&engine);
    }
}
