#include "emg_ui.h"
#include "emg_ui_config.h"
#include "emg_ws_server.h"
#include <ctype.h>
#include <inttypes.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Core bridge: runs only on the engine task, also compiled in host tests. */
void emg_ui_capture(const tr_engine_t *t, emg_ui_snapshot_t *s) {
    memset(s, 0, sizeof(*s));
    s->config=t->config; s->state=t->state;
    s->phase=tr_phase(t);
    s->session_id=t->session_id;
    s->sequence=t->snapshot_seq;
    s->paused=t->paused;
    /* Same clock as the web snapshot: calibration time is not training time. */
    s->elapsed_s=tr_duration_ms(t)/1000.0;
    for (unsigned k=0; k<t->config.channels; ++k) {
        const tr_channel_t *c=&t->channel[k];
        s->ch[k]=(emg_ui_channel_t){
            .value=c->value, .on=c->on, .off=c->off, .baseline=(float)c->mean,
            .hold_ms=c->last_hold_ms, .reps=c->reps, .valid_reps=c->valid_reps,
            .muscle=c->state,
            .rest_now_ms=t->state==TR_RUNNING && !t->paused && c->state==TR_REST?(t->samples-c->rest_started)*1000.0f/t->config.fs_hz:0,
            .in_zone_ms=c->zone_frames*1000.0f/t->config.fs_hz,
            .longest_in_zone_ms=c->zone_longest*1000.0f/t->config.fs_hz,
            .hold_now_ms=(t->state==TR_RUNNING && c->state==TR_ACTIVE &&
                          c->active_frames>=c->below)?
                (c->active_frames-c->below)*1000.0f/t->config.fs_hz:0
        };
    }
    s->signal_ready=t->channel[0].filled==t->window && t->state!=TR_ERROR;
    const tr_channel_t *ex=&t->channel[t->config.exercise_channel];
    /* Free counting has no target, so a target progress bar is meaningless. */
    s->progress=t->config.free_mode?0:fminf(100,100.0f*ex->valid_reps/t->config.target_reps);
    {
        double hold=0,rest=0; unsigned rests=0;
        for(unsigned i=0;i<ex->reps && i<TR_MAX_REPS;i++) {
            const tr_rep_t *r=&ex->ledger[i];
            hold+=r->hold_ms;
            if(r->hold_ms>s->longest_hold_ms)s->longest_hold_ms=r->hold_ms;
            /* The first rest is start->first contraction, not between reps. */
            if(i){rest+=r->rest_ms;rests++;}
        }
        s->avg_hold_ms=ex->reps?(float)(hold/ex->reps):0;
        s->avg_rest_ms=rests?(float)(rest/rests):0;
        s->reps_per_min=s->elapsed_s>=1?(float)(ex->reps*60.0/s->elapsed_s):0;
    }
    s->calibration_progress=t->cal_samples?fminf(100,100.0f*t->samples/t->cal_samples):0;
    s->discontinuities=t->discontinuities; s->tx_dropped=t->tx_dropped;
    s->backlog_ticks=t->backlog_ticks; s->max_dsp_us=t->max_dsp_us;
    snprintf(s->unit,sizeof(s->unit),"%s",tr_unit(t));
    snprintf(s->fault,sizeof(s->fault),"%s",t->fault);
}

static bool numeric(const char *s, double *v) {
    if (!s || !*s) return false;
    for (const char *p=s; *p; ++p)
        if (!isdigit((unsigned char)*p) && !strchr("eE+-. \t\r\n",*p)) return false;
    char *end;
    *v=strtod(s,&end);
    if (end==s || !isfinite(*v)) return false;
    while (isspace((unsigned char)*end)) ++end;
    return !*end;
}
static emg_ui_result_t reject(uint32_t id, const char *code, char *out, size_t cap) {
    snprintf(out,cap,"{\"v\":1,\"type\":\"ack\",\"id\":%" PRIu32 ",\"ok\":false,\"code\":\"%s\"}",id,code);
    return EMG_UI_REJECTED;
}
/* Internal key-value control synchronization bridge (used by local UI controls
 * and native integration tests in tests/test_sync.c). Web App commands arrive
 * directly through WebSocket semg_v2 JSON in web_server.c -> tr_command(). */
emg_ui_result_t emg_ui_execute(tr_engine_t *t, const char *name,
        const char *value, uint32_t id, unsigned *page, char *ack, size_t cap) {
    double n;
    char cmd[512], body[384]="";
    const char *action=NULL;
    if (cap) ack[0]=0;
    if (!numeric(value,&n)) return reject(id,"ui_invalid_number",ack,cap);
    bool button=!strcmp(name,"Start") || !strcmp(name,"Stop") ||
        !strcmp(name,"Calibrate") || !strcmp(name,"Reset");
    /* Repeated settings / an echoed server value must not reset a session. */
    if ((!strcmp(name,"SourceMode") && n!=2 && n==(double)t->config.source) ||
        (!strcmp(name,"Channels") && n==t->config.channels) ||
        (!strcmp(name,"SignalKind") && n==(double)t->config.kind) ||
        (!strcmp(name,"TargetReps") && n==t->config.target_reps) ||
        (!strcmp(name,"HoldMs") && n==t->config.hold_ms) ||
        (!strcmp(name,"ExerciseChannel") && n==t->config.exercise_channel+1) ||
        (!strcmp(name,"NotchHz") && n==t->config.notch_hz) ||
        (!strcmp(name,"RmsMs") && (float)n==t->config.rms_ms) ||
        (!strcmp(name,"FsHz") && n==t->config.fs_hz) ||
        (!strcmp(name,"OledPage") && n==*page)) return EMG_UI_IGNORED;
    if (!EMG_REMOTE_TECH_CONFIG_ENABLE &&
        (!strcmp(name,"SourceMode") || !strcmp(name,"Channels") ||
         !strcmp(name,"SignalKind") || !strcmp(name,"NotchHz") ||
         !strcmp(name,"RmsMs") || !strcmp(name,"FsHz")))
        return reject(id,"technical_config_locked",ack,cap);
    if (button) {
        if (n==0) return EMG_UI_IGNORED; /* release of a PUSH button */
        if (n!=1) return reject(id,"ui_button_requires_0_1",ack,cap);
        action=!strcmp(name,"Start")?"start":!strcmp(name,"Stop")?"stop":
            !strcmp(name,"Calibrate")?"calibrate":"configure";
    } else if (!strcmp(name,"OledPage")) {
        if (n!=0 && n!=1) return reject(id,"ui_page_requires_0_1",ack,cap);
        *page=(unsigned)n;
        snprintf(ack,cap,"{\"v\":1,\"type\":\"ack\",\"id\":%" PRIu32 ",\"ok\":true,\"code\":\"ok\"}",id);
        return EMG_UI_OK;
    } else {
        action="configure";
        if (!strcmp(name,"SourceMode")) {
#ifdef ESP_PLATFORM
            if (n==2) snprintf(body,sizeof(body),
                ",\"source\":\"ADC\",\"fs_hz\":2048,\"channels\":1,\"exercise_channel\":0");
            else
#else
            if (n==2) return reject(id,"adc_not_implemented",ack,cap);
#endif
            if (n==0) snprintf(body,sizeof(body),",\"source\":\"SIMULATION\"");
            else if (n==1) snprintf(body,sizeof(body),
                ",\"source\":\"REPLAY\",\"fs_hz\":2048,\"channels\":1,\"exercise_channel\":0,"
                "\"signal_kind\":\"RAW\",\"highpass_hz\":20,\"lowpass_hz\":450,\"notch_hz\":0,\"cal_ms\":%.6g",
                (double)fminf(5000,t->config.cal_ms));
            else return reject(id,"ui_source_requires_0_1_2",ack,cap);
        } else if (!strcmp(name,"Channels")) {
            if (n!=1 && n!=2) return reject(id,"channels_range_1_2",ack,cap);
            snprintf(body,sizeof(body),",\"channels\":%.0f,\"exercise_channel\":%" PRIu32,n,
                n==1?0:t->config.exercise_channel);
        } else if (!strcmp(name,"SignalKind")) {
            if (n==0) snprintf(body,sizeof(body),
                ",\"signal_kind\":\"RAW\",\"highpass_hz\":20,\"lowpass_hz\":%.6g,\"notch_hz\":0",
                fmin(450,0.4*t->config.fs_hz));
            else if (n==1) snprintf(body,sizeof(body),
                ",\"signal_kind\":\"ENVELOPE\",\"highpass_hz\":0,\"lowpass_hz\":10,\"notch_hz\":0");
            else return reject(id,"ui_kind_requires_0_1",ack,cap);
        } else if (!strcmp(name,"TargetReps") || !strcmp(name,"HoldMs") || !strcmp(name,"ExerciseChannel")) {
            action="set_target";
            if (floor(n)!=n) return reject(id,"ui_integer_required",ack,cap);
            const char *field=!strcmp(name,"TargetReps")?"target_reps":
                !strcmp(name,"HoldMs")?"hold_ms":"exercise_channel";
            if (!strcmp(name,"ExerciseChannel")) n-=1; /* app CH1/CH2 -> core 0/1 */
            snprintf(body,sizeof(body),",\"%s\":%.0f",field,n);
        } else if (!strcmp(name,"NotchHz")) {
            if (n!=0 && n!=50 && n!=60) return reject(id,"notch_0_50_60",ack,cap);
            snprintf(body,sizeof(body),",\"notch_hz\":%.0f",n);
        } else if (!strcmp(name,"RmsMs")) {
            snprintf(body,sizeof(body),",\"rms_ms\":%.9g",n);
        } else if (!strcmp(name,"FsHz")) {
            if (floor(n)!=n || n<256 || n>8000) return reject(id,"fs_range_256_8000",ack,cap);
            double lp=t->config.lowpass_hz;
            if (lp>=0.45*n) lp=0.4*n;
            snprintf(body,sizeof(body),",\"fs_hz\":%.0f,\"lowpass_hz\":%.9g",n,lp);
        } else return reject(id,"ui_unknown_control",ack,cap);
    }
    int len=snprintf(cmd,sizeof(cmd),"{\"v\":1,\"id\":%" PRIu32 ",\"cmd\":\"%s\"%s}",id,action,body);
    if (len<0 || (size_t)len>=sizeof(cmd)) return reject(id,"ui_command_too_long",ack,cap);
    return tr_command(t,cmd,ack,cap)?EMG_UI_OK:EMG_UI_REJECTED;
}

#ifndef EMG_UI_HOST_TEST
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "nvs_flash.h"

#define WIFI_UP BIT0
typedef struct {char name[32],value[48];} ui_command_t;
static QueueHandle_t command_queue,snapshot_queue;
static EventGroupHandle_t link_events;
static uint32_t command_id=0x80000000U, revision;
static unsigned oled_page;
static char last_ack[160]="San sang.";
static portMUX_TYPE drops_lock=portMUX_INITIALIZER_UNLOCKED;
static uint32_t ui_dropped;
static const char *TAG="emg_ui";

bool emg_ui_init(void) {
    command_queue=xQueueCreate(8,sizeof(ui_command_t));
    snapshot_queue=xQueueCreate(1,sizeof(emg_ui_snapshot_t));
    link_events=xEventGroupCreate();
    return command_queue && snapshot_queue && link_events;
}
void emg_ui_update(const tr_engine_t *t) {
    emg_ui_snapshot_t s; emg_ui_capture(t,&s);
    s.revision=revision; s.oled_page=oled_page;
    snprintf(s.last_ack,sizeof(s.last_ack),"%s",last_ack);
    xQueueOverwrite(snapshot_queue,&s);
}
bool emg_ui_read_snapshot(emg_ui_snapshot_t *s) {
    return xQueuePeek(snapshot_queue,s,0)==pdTRUE;
}
void emg_ui_link_state(bool *wifi) {
    EventBits_t b=xEventGroupGetBits(link_events);
    *wifi=(b&WIFI_UP)!=0;
}
bool emg_ui_process_one(tr_engine_t *t,char *ack,size_t cap) {
    ui_command_t c;
    if (xQueueReceive(command_queue,&c,0)!=pdTRUE) return false;
    if (++command_id==0) command_id=0x80000000U;
    emg_ui_result_t r=emg_ui_execute(t,c.name,c.value,command_id,&oled_page,ack,cap);
    if (r==EMG_UI_IGNORED) return true;
    const char *code=strstr(ack,"\"code\":\"");
    char clean[64]="ack_format_error";
    if (code) {code+=8; size_t n=strcspn(code,"\""); if(n<sizeof(clean)){memcpy(clean,code,n);clean[n]=0;}}
    snprintf(last_ack,sizeof(last_ack),"%s:%s",c.name,clean);
    if(r==EMG_UI_REJECTED) ESP_LOGW(TAG,"Control %s rejected: %s",c.name,clean);
    ++revision;
    return true;
}
/* Enqueue an internal key-value control command to be executed on emg_engine. */
bool emg_ui_submit_control(const char *name,const char *value) {
    if(!name || !value || strlen(name)>=sizeof(((ui_command_t *)0)->name) ||
            strlen(value)>=sizeof(((ui_command_t *)0)->value)) return false;
    ui_command_t c={0};
    snprintf(c.name,sizeof(c.name),"%s",name);
    snprintf(c.value,sizeof(c.value),"%s",value);
    if(xQueueSend(command_queue,&c,0)==pdTRUE) return true;
    portENTER_CRITICAL(&drops_lock); ++ui_dropped; portEXIT_CRITICAL(&drops_lock);
    return false;
}

static void wifi_event(void *arg,esp_event_base_t base,int32_t id,void *event) {
    (void)arg;
    if (base==WIFI_EVENT && id==WIFI_EVENT_STA_START) {
        ESP_LOGI(TAG,"Wi-Fi started, connecting...");
        esp_err_t err=esp_wifi_connect();
        if (err!=ESP_OK) ESP_LOGE(TAG,"Wi-Fi connect: %s",esp_err_to_name(err));
    } else if (base==WIFI_EVENT && id==WIFI_EVENT_STA_DISCONNECTED) {
        const wifi_event_sta_disconnected_t *e=event;
        if (e) ESP_LOGW(TAG,"Wi-Fi disconnected, reason=%u",(unsigned int)e->reason);
        else ESP_LOGW(TAG,"Wi-Fi disconnected, reason unavailable");
        xEventGroupClearBits(link_events,WIFI_UP);
        (void)emg_ws_server_stop();
        esp_err_t err=esp_wifi_connect();
        if (err!=ESP_OK) ESP_LOGE(TAG,"Wi-Fi reconnect: %s",esp_err_to_name(err));
    } else if (base==IP_EVENT && id==IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *e=event;
        if (e) ESP_LOGI(TAG,"Wi-Fi connected, IP acquired: " IPSTR,IP2STR(&e->ip_info.ip));
        else ESP_LOGI(TAG,"Wi-Fi connected, IP acquired");
        xEventGroupSetBits(link_events,WIFI_UP);
        if(EMG_WS_ENABLE) {
            if(!emg_ws_server_start()) ESP_LOGE(TAG,"WebSocket start failed");
        }
    }
}
static esp_err_t wifi_init(void) {
    esp_err_t err=nvs_flash_init();
    if(err==ESP_ERR_NVS_NO_FREE_PAGES || err==ESP_ERR_NVS_NEW_VERSION_FOUND) {
        err=nvs_flash_erase(); if(err==ESP_OK) err=nvs_flash_init();
    }
    if (err!=ESP_OK) return err;
    err=esp_netif_init(); if(err!=ESP_OK) return err;
    err=esp_event_loop_create_default(); if(err!=ESP_OK && err!=ESP_ERR_INVALID_STATE) return err;
    if (!esp_netif_create_default_wifi_sta()) return ESP_ERR_NO_MEM;
    wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT();
    err=esp_wifi_init(&init); if(err!=ESP_OK) return err;
    err=esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,NULL); if(err!=ESP_OK)return err;
    err=esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_event,NULL); if(err!=ESP_OK)return err;
    wifi_config_t cfg={0};
    size_t sn=strlen(EMG_WIFI_SSID),pn=strlen(EMG_WIFI_PASSWORD);
    if(sn>sizeof(cfg.sta.ssid) || pn>sizeof(cfg.sta.password)) return ESP_ERR_INVALID_ARG;
    memcpy(cfg.sta.ssid,EMG_WIFI_SSID,sn); memcpy(cfg.sta.password,EMG_WIFI_PASSWORD,pn);
    err=esp_wifi_set_storage(WIFI_STORAGE_RAM); if(err!=ESP_OK)return err;
    err=esp_wifi_set_mode(WIFI_MODE_STA); if(err!=ESP_OK)return err;
    err=esp_wifi_set_config(WIFI_IF_STA,&cfg); if(err!=ESP_OK)return err;
    err=esp_wifi_start(); if(err!=ESP_OK)return err;
    return esp_wifi_set_ps(WIFI_PS_NONE);
}
static void network_task(void *arg) {
    (void)arg;
    if(!EMG_WS_ENABLE || strcmp(EMG_WIFI_SSID,"YOUR_WIFI_2G4")==0) {
        ESP_LOGW(TAG,"Wi-Fi credentials unset or WS disabled; USB serial remains available");
        vTaskDelete(NULL); return;
    }
    esp_err_t err=wifi_init();
    if(err!=ESP_OK) ESP_LOGE(TAG,"Wi-Fi init: %s",esp_err_to_name(err));
    vTaskDelete(NULL);
}
bool emg_ui_start(void) {
    bool ok=true;
    if(EMG_OLED_ENABLE && xTaskCreate(emg_oled_task,"emg_oled",6144,NULL,1,NULL)!=pdPASS) ok=false;
    if(EMG_WS_ENABLE && xTaskCreate(network_task,"emg_wifi",4096,NULL,1,NULL)!=pdPASS) ok=false;
    return ok;
}
#endif
