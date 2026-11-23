#include "emg_ws_server.h"
#include "emg_ui.h"
#include "emg_ui_config.h"
#include "ws_aead.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
/* Engine owns commands; HTTP receives an ACK only after application. */
#define WS_RAW_FRAME_BYTES 2560
#define RAW_BATCH_FRAMES   256U
typedef struct {char text[TR_COMMAND_BYTES];uint32_t token;int64_t deadline;} request_t;
typedef struct {char *text;uint32_t token;} result_t;
typedef struct {httpd_handle_t server;char payload[];} push_t;
typedef struct {
    char boot_id[37];
    uint64_t session_id;
    uint64_t first_sample;
    uint32_t frames;
    uint32_t channels;
    uint32_t fs_hz;
    uint32_t dropped_before;
    bool is_adc_u16;
    uint8_t bytes[RAW_BATCH_FRAMES * TR_MAX_CHANNELS * 4U];
} raw_batch_t;
static QueueHandle_t requests,results,raw_queue;
static SemaphoreHandle_t snapshot_lock;
static httpd_handle_t server;
static TaskHandle_t broadcast_handle;
static char latest[TR_WEB_BYTES];
static uint64_t sequence;
static uint32_t next_token;
static int64_t last_publish;
static const tr_engine_t *engine_ref;
static bool push_pending;
static bool raw_push_pending;
static raw_batch_t raw_staging;
static bool raw_staging_active;
static uint32_t raw_pending_dropped;
static uint8_t aead_key[TINYJAMBU_128_KEY_SIZE];
static uint32_t aead_nonce_prefix=0x53454D47U;
static uint64_t aead_tx_counter;
static portMUX_TYPE push_lock=portMUX_INITIALIZER_UNLOCKED;
static size_t base64_encode(const uint8_t *src,size_t len,char *dst,size_t cap) {
    static const char tbl[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    size_t need=((len+2U)/3U)*4U+1U;
    if(!dst || cap<need)return 0;
    size_t o=0;
    for(size_t i=0;i<len;i+=3U) {
        uint32_t v=((uint32_t)src[i])<<16;
        if(i+1U<len)v|=((uint32_t)src[i+1U])<<8;
        if(i+2U<len)v|=(uint32_t)src[i+2U];
        dst[o++]=tbl[(v>>18)&0x3FU];
        dst[o++]=tbl[(v>>12)&0x3FU];
        dst[o++]=(i+1U<len)?tbl[(v>>6)&0x3FU]:'=';
        dst[o++]=(i+2U<len)?tbl[v&0x3FU]:'=';
    }
    dst[o]=0;
    return o;
}
static uint64_t next_aead_counter(void) {
    portENTER_CRITICAL(&push_lock);
    uint64_t c=++aead_tx_counter;
    portEXIT_CRITICAL(&push_lock);
    return c;
}
static esp_err_t send_ws_frame_aead(httpd_req_t *req,const char *plain,size_t plain_len) {
#if EMG_WS_AEAD_ENABLE
    size_t enc_len=0;
    char *enc=emg_ws_aead_encrypt_alloc(plain,plain_len,EMG_WS_AEAD_AD_S2C,aead_nonce_prefix,next_aead_counter(),aead_key,&enc_len);
    if(!enc)return ESP_ERR_NO_MEM;
    httpd_ws_frame_t reply={.type=HTTPD_WS_TYPE_TEXT,.payload=(uint8_t *)enc,.len=enc_len};
    esp_err_t err=httpd_ws_send_frame(req,&reply);
    free(enc);
    return err;
#else
    httpd_ws_frame_t reply={.type=HTTPD_WS_TYPE_TEXT,.payload=(uint8_t *)plain,.len=plain_len};
    return httpd_ws_send_frame(req,&reply);
#endif
}
bool emg_ws_init(void) {
    if(!emg_ws_aead_parse_key(EMG_WS_AEAD_KEY_HEX,aead_key))return false;
    requests=xQueueCreate(1,sizeof(request_t));results=xQueueCreate(1,sizeof(result_t));
    raw_queue=xQueueCreate(8,sizeof(raw_batch_t));
    snapshot_lock=xSemaphoreCreateMutex();
    return requests && results && raw_queue && snapshot_lock;
}
void emg_ws_flush_raw(tr_engine_t *t) {
    if(!raw_staging_active || !raw_staging.frames)return;
    raw_staging.dropped_before=raw_pending_dropped;
    raw_pending_dropped=0;
    if(!raw_queue || xQueueSend(raw_queue,&raw_staging,0)!=pdTRUE) {
        if(t) { t->raw_dropped_samples+=raw_staging.frames; t->raw_overflow_events++; }
        raw_pending_dropped+=raw_staging.frames;
    } else {
        portENTER_CRITICAL(&push_lock);
        TaskHandle_t h=broadcast_handle;
        portEXIT_CRITICAL(&push_lock);
        if(h)xTaskNotifyGive(h);
    }
    raw_staging_active=false;
    raw_staging.frames=0;
}
void emg_ws_push_raw(tr_engine_t *t,const tr_block_t *b) {
    if(!t || !b || !b->frames || !b->channels || b->channels>TR_MAX_CHANNELS)return;
    bool is_u16=b->has_raw_adc_codes;
    if(raw_staging_active) {
        if(raw_staging.session_id!=t->session_id ||
           raw_staging.is_adc_u16!=is_u16 ||
           raw_staging.channels!=b->channels ||
           raw_staging.fs_hz!=t->config.fs_hz ||
           (raw_staging.first_sample+raw_staging.frames)!=b->first_sample ||
           (raw_staging.frames+b->frames)>RAW_BATCH_FRAMES) {
            emg_ws_flush_raw(t);
        }
    }
    if(!raw_staging_active) {
        snprintf(raw_staging.boot_id,sizeof(raw_staging.boot_id),"%s",t->boot_id);
        raw_staging.session_id=t->session_id;
        raw_staging.first_sample=b->first_sample;
        raw_staging.frames=0;
        raw_staging.channels=b->channels;
        raw_staging.fs_hz=t->config.fs_hz;
        raw_staging.dropped_before=0;
        raw_staging.is_adc_u16=is_u16;
        raw_staging_active=true;
    }
    size_t elem_size=is_u16?sizeof(uint16_t):sizeof(float);
    size_t dst_off=(size_t)raw_staging.frames*(size_t)b->channels*elem_size;
    for(uint32_t i=0;i<b->frames;i++) {
        for(uint32_t k=0;k<b->channels;k++) {
            if(is_u16) {
                uint16_t code=b->raw_adc_codes[i][k];
                raw_staging.bytes[dst_off++]=(uint8_t)(code&0xFFU);
                raw_staging.bytes[dst_off++]=(uint8_t)((code>>8)&0xFFU);
            } else {
                float v=b->sample[i][k];
                memcpy(&raw_staging.bytes[dst_off],&v,sizeof(float));
                dst_off+=sizeof(float);
            }
        }
    }
    raw_staging.frames+=b->frames;
    if(raw_staging.frames>=RAW_BATCH_FRAMES)emg_ws_flush_raw(t);
}
uint64_t emg_ws_sequence(void) {
    portENTER_CRITICAL(&push_lock);
    uint64_t s=sequence;
    portEXIT_CRITICAL(&push_lock);
    return s;
}
void emg_ws_update(const tr_engine_t *t) {
    engine_ref=t;
    if(t && t->boot_id[0]) {
        uint32_t p=0;
        for(unsigned i=0;i<8 && t->boot_id[i];++i)p=(p<<4)^(uint32_t)t->boot_id[i];
        if(p)aead_nonce_prefix=p;
    }
    int64_t now=esp_timer_get_time();if(now-last_publish<(int64_t)EMG_WS_SNAPSHOT_MS*1000LL && latest[0])return;
    if(xSemaphoreTake(snapshot_lock,pdMS_TO_TICKS(20))!=pdTRUE)return;
    portENTER_CRITICAL(&push_lock);
    uint64_t next_seq=++sequence;
    portEXIT_CRITICAL(&push_lock);
    size_t written=tr_web_snapshot(t,next_seq,latest,sizeof(latest));
    if(written) {
        last_publish=now;
        portENTER_CRITICAL(&push_lock);
        TaskHandle_t h=broadcast_handle;
        portEXIT_CRITICAL(&push_lock);
        if(h)xTaskNotifyGive(h);
    } else {
        latest[0]=0; ESP_LOGE("emg_ws","Snapshot generation failed");
    }
    xSemaphoreGive(snapshot_lock);
}
static char *copy_snapshot(uint64_t *seq_out) {
    if(xSemaphoreTake(snapshot_lock,pdMS_TO_TICKS(100))!=pdTRUE)return NULL;
    if(!latest[0] && engine_ref) {
        portENTER_CRITICAL(&push_lock);
        uint64_t next_seq=++sequence;
        portEXIT_CRITICAL(&push_lock);
        size_t written=tr_web_snapshot(engine_ref,next_seq,latest,sizeof(latest));
        if(!written)ESP_LOGE("emg_ws","Snapshot generation failed during handshake");
    }
    if(seq_out) {
        portENTER_CRITICAL(&push_lock);
        *seq_out=sequence;
        portEXIT_CRITICAL(&push_lock);
    }
    size_t len=strnlen(latest,TR_WEB_BYTES);
    char *out=len?malloc(len+1):NULL;
    if(out)memcpy(out,latest,len+1);
    xSemaphoreGive(snapshot_lock);
    return out;
}
static bool json_uuid_field(const char *json,const char *key,char out[37]) {
    char name[48];
    int n=snprintf(name,sizeof(name),"\"%s\"",key);
    if(n<0 || (size_t)n>=sizeof(name))return false;
    const char *p=strstr(json,name);if(!p)return false;
    p=strchr(p,':');if(!p)return false;p++;while(*p==' ' || *p=='\t')p++;
    if(*p++!='"')return false;
    for(unsigned i=0;i<36;i++){if(!p[i])return false;bool dash=i==8||i==13||i==18||i==23;
        if(dash?p[i]!='-':!strchr("0123456789abcdefABCDEF",p[i]))return false;
        out[i]=p[i];}
    out[36]=0;return p[36]=='"';
}
static bool request_id(const char *json,char out[37]) {
    return json_uuid_field(json,"request_id",out);
}
static bool initial_get_state(const char *json,char out[37]) {
    const char *action=strstr(json,"\"action\":\"get_state\"");
    return action && json_uuid_field(json,"command_id",out);
}
bool emg_ws_process_one(tr_engine_t *t,char *ack,size_t cap) {
    request_t request;if(xQueueReceive(requests,&request,0)!=pdTRUE)return false;
    char id[37];if(!request_id(request.text,id))return true;
    bool accepted=false;
    if(esp_timer_get_time()<=request.deadline)accepted=tr_command(t,request.text,ack,cap);
    else snprintf(ack,cap,"{\"code\":\"command_expired\"}");
    t->timing_valid=true;
    t->device_clock_ms=(double)esp_timer_get_time()/1000.0;
    if(!tr_is_acquiring(t) || t->sampled_at_device_ms<=0.0)t->sampled_at_device_ms=t->device_clock_ms;
    t->oled_sequence=emg_oled_last_sequence(&t->oled_sequence_valid);
    last_publish=0;emg_ws_update(t);
    t->snapshot_seq=emg_ws_sequence();
    char code[80]="rejected",*p=strstr(ack,"\"code\":\"");
    if(p){p+=8;size_t n=strcspn(p,"\"");if(n<sizeof(code)){memcpy(code,p,n);code[n]=0;}}
    if(xSemaphoreTake(snapshot_lock,pdMS_TO_TICKS(100))!=pdTRUE)return true;
    size_t snapshot_len=strnlen(latest,TR_WEB_BYTES);
    char *response=snapshot_len?malloc(snapshot_len+257):NULL;
    if(!response){
        xSemaphoreGive(snapshot_lock);
        ESP_LOGE("emg_ws","Command response allocation failed: bytes=%u",(unsigned)(snapshot_len+257));
        return true;
    }
    memcpy(response+256,latest,snapshot_len+1);
    xSemaphoreGive(snapshot_lock);
    int n=snprintf(response,256,"{\"type\":\"ack\",\"protocol\":1,\"command_id\":\"%s\",\"accepted\":%s,\"message\":\"%s\",\"snapshot\":",id,accepted?"true":"false",code);
    if(n<0 || n>=256){free(response);return true;}
    memmove(response+n,response+256,snapshot_len+1);
    response[n+snapshot_len]='}';response[n+snapshot_len+1]=0;
    result_t old;if(xQueueReceive(results,&old,0)==pdTRUE)free(old.text);
    result_t result={response,request.token};if(xQueueSend(results,&result,0)!=pdTRUE)free(response);return true;
}
static esp_err_t ws_handler(httpd_req_t *req) {
    httpd_ws_frame_t packet={.type=HTTPD_WS_TYPE_TEXT};esp_err_t err=httpd_ws_recv_frame(req,&packet,0);
    if(err!=ESP_OK){ESP_LOGE("emg_ws","Receive frame header failed: %s",esp_err_to_name(err));return err;}
    if(packet.type!=HTTPD_WS_TYPE_TEXT || !packet.len || packet.len>=WS_RAW_FRAME_BYTES){
        ESP_LOGE("emg_ws","Invalid frame: type=%d len=%u",(int)packet.type,(unsigned)packet.len);
        return ESP_ERR_INVALID_ARG;
    }
    char *raw=malloc(packet.len+1);if(!raw)return ESP_ERR_NO_MEM;
    packet.payload=(uint8_t *)raw;
    err=httpd_ws_recv_frame(req,&packet,packet.len);
    if(err!=ESP_OK){free(raw);ESP_LOGE("emg_ws","Receive frame payload failed: %s",esp_err_to_name(err));return err;}
    raw[packet.len]=0;
    double rx_ms=(double)esp_timer_get_time()/1000.0;
    request_t request={0};
#if EMG_WS_AEAD_ENABLE
    if(!emg_ws_aead_decrypt(raw,packet.len,EMG_WS_AEAD_AD_C2S,aead_key,request.text,sizeof(request.text))){
        free(raw);
        ESP_LOGW("emg_ws","Rejected unauthenticated TinyJAMBU-128 AEAD frame");
        return ESP_ERR_INVALID_ARG;
    }
    free(raw);
#else
    if(packet.len>=sizeof(request.text)){free(raw);return ESP_ERR_INVALID_ARG;}
    memcpy(request.text,raw,packet.len+1);
    free(raw);
#endif
    /* Fast path: timing_v1 ping/pong replied directly from WS handler without DSP queue delay. */
    char pong[256];
    double tx_ms=(double)esp_timer_get_time()/1000.0;
    if(tr_handle_ping(request.text,rx_ms,tx_ms,pong,sizeof(pong))) {
        err=send_ws_frame_aead(req,pong,strlen(pong));
        if(err!=ESP_OK)ESP_LOGE("emg_ws","Send pong failed: %s",esp_err_to_name(err));
        return err;
    }
    char id[37];
    if(!request_id(request.text,id)) {
        if(!initial_get_state(request.text,id)){ESP_LOGE("emg_ws","Invalid command: %s",request.text);return ESP_ERR_INVALID_ARG;}
        char *snapshot=copy_snapshot(NULL);if(!snapshot){ESP_LOGE("emg_ws","No snapshot available");return ESP_ERR_NO_MEM;}
        size_t cap=strlen(snapshot)+128;char *response=malloc(cap);
        if(!response){free(snapshot);return ESP_ERR_NO_MEM;}
        int n=snprintf(response,cap,
            "{\"type\":\"ack\",\"protocol\":1,\"command_id\":\"%s\",\"accepted\":true,\"message\":\"ok\",\"snapshot\":%s}",
            id,snapshot);
        free(snapshot);
        if(n<0 || (size_t)n>=cap){free(response);return ESP_ERR_INVALID_SIZE;}
        err=send_ws_frame_aead(req,response,(size_t)n);free(response);
        if(err!=ESP_OK)ESP_LOGE("emg_ws","Send initial state failed: %s",esp_err_to_name(err));
        return err;
    }
    request.token=++next_token;request.deadline=esp_timer_get_time()+1500000;
    if(xQueueSend(requests,&request,0)!=pdTRUE){ESP_LOGE("emg_ws","Command queue full");return ESP_ERR_TIMEOUT;}
    int64_t deadline=esp_timer_get_time()+2000000;
    while(esp_timer_get_time()<deadline){result_t result;if(xQueueReceive(results,&result,pdMS_TO_TICKS(100))!=pdTRUE)continue;
        if(result.token!=request.token){free(result.text);continue;}
        err=send_ws_frame_aead(req,result.text,strlen(result.text));free(result.text);return err;}
    ESP_LOGE("emg_ws","Command timed out");
    return ESP_ERR_TIMEOUT;
}
static void push_work(void *arg) {
    push_t *push=arg;
    if(server==push->server){int clients[8];size_t count=8;
        if(httpd_get_client_list(server,&count,clients)==ESP_OK)for(size_t i=0;i<count;i++){
            if(httpd_ws_get_fd_info(server,clients[i])!=HTTPD_WS_CLIENT_WEBSOCKET)continue;
            httpd_ws_frame_t packet={.type=HTTPD_WS_TYPE_TEXT,.payload=(uint8_t *)push->payload,.len=strlen(push->payload)};
            (void)httpd_ws_send_frame_async(server,clients[i],&packet);}}
    free(push);portENTER_CRITICAL(&push_lock);push_pending=false;portEXIT_CRITICAL(&push_lock);
}
static void push_raw_work(void *arg) {
    push_t *push=arg;
    if(server==push->server){int clients[8];size_t count=8;
        if(httpd_get_client_list(server,&count,clients)==ESP_OK)for(size_t i=0;i<count;i++){
            if(httpd_ws_get_fd_info(server,clients[i])!=HTTPD_WS_CLIENT_WEBSOCKET)continue;
            httpd_ws_frame_t packet={.type=HTTPD_WS_TYPE_TEXT,.payload=(uint8_t *)push->payload,.len=strlen(push->payload)};
            (void)httpd_ws_send_frame_async(server,clients[i],&packet);}}
    free(push);
    portENTER_CRITICAL(&push_lock);
    raw_push_pending=false;
    TaskHandle_t h=broadcast_handle;
    portEXIT_CRITICAL(&push_lock);
    if(h && raw_queue && uxQueueMessagesWaiting(raw_queue)>0)xTaskNotifyGive(h);
}
static void send_raw_batch_if_ready(void) {
    static raw_batch_t rb;
    portENTER_CRITICAL(&push_lock);bool busy=raw_push_pending;portEXIT_CRITICAL(&push_lock);
    if(!server || !raw_queue || busy)return;
    if(xQueueReceive(raw_queue,&rb,0)!=pdTRUE)return;
    size_t raw_bytes=(size_t)rb.frames*(size_t)rb.channels*(rb.is_adc_u16?sizeof(uint16_t):sizeof(float));
    size_t b64_cap=((raw_bytes+2U)/3U)*4U+1U;
    size_t json_cap=b64_cap+320U;
    char *json=malloc(json_cap);
    char *b64=malloc(b64_cap);
    if(!json || !b64){free(json);free(b64);return;}
    if(!base64_encode(rb.bytes,raw_bytes,b64,b64_cap)){free(json);free(b64);return;}
    int n=snprintf(json,json_cap,
        "{\"type\":\"raw_batch\",\"protocol\":1,\"boot_id\":\"%s\",\"session_id\":%llu,\"first_sample\":%llu,\"frames\":%u,\"channels\":%u,\"fs_hz\":%u,\"encoding\":\"%s\",\"dropped_before\":%u,\"data_b64\":\"%s\"}",
        rb.boot_id,(unsigned long long)rb.session_id,(unsigned long long)rb.first_sample,
        (unsigned)rb.frames,(unsigned)rb.channels,(unsigned)rb.fs_hz,
        rb.is_adc_u16?"uint16_adc":"float32_uv",(unsigned)rb.dropped_before,b64);
    free(b64);
    if(n<=0 || (size_t)n>=json_cap){free(json);return;}
#if EMG_WS_AEAD_ENABLE
    size_t len=0;
    char *wire=emg_ws_aead_encrypt_alloc(json,(size_t)n,EMG_WS_AEAD_AD_S2C,aead_nonce_prefix,next_aead_counter(),aead_key,&len);
    free(json);
    if(!wire)return;
    push_t *push=malloc(sizeof(*push)+len+1U);
    if(!push){free(wire);return;}
    push->server=server;memcpy(push->payload,wire,len+1U);free(wire);
#else
    push_t *push=malloc(sizeof(*push)+(size_t)n+1U);
    if(!push){free(json);return;}
    push->server=server;memcpy(push->payload,json,(size_t)n+1U);free(json);
#endif
    portENTER_CRITICAL(&push_lock);raw_push_pending=true;portEXIT_CRITICAL(&push_lock);
    if(httpd_queue_work(server,push_raw_work,push)!=ESP_OK){free(push);portENTER_CRITICAL(&push_lock);raw_push_pending=false;portEXIT_CRITICAL(&push_lock);}
}
static void broadcast_task(void *arg) {
    (void)arg;
    uint64_t last_broadcast_seq=0;
    for(;;){(void)ulTaskNotifyTake(pdTRUE,pdMS_TO_TICKS(EMG_WS_SNAPSHOT_MS));
        send_raw_batch_if_ready();
        portENTER_CRITICAL(&push_lock);bool pending=push_pending;portEXIT_CRITICAL(&push_lock);
        if(!server || pending)continue;
        uint64_t snap_seq=0;
        char *snapshot=copy_snapshot(&snap_seq);if(!snapshot)continue;
        if(snap_seq==last_broadcast_seq){free(snapshot);continue;}
        last_broadcast_seq=snap_seq;
#if EMG_WS_AEAD_ENABLE
        size_t len=0;
        char *wire=emg_ws_aead_encrypt_alloc(snapshot,strlen(snapshot),EMG_WS_AEAD_AD_S2C,aead_nonce_prefix,next_aead_counter(),aead_key,&len);
        free(snapshot);
        if(!wire)continue;
        push_t *push=malloc(sizeof(*push)+len+1);
        if(!push){free(wire);continue;}push->server=server;memcpy(push->payload,wire,len+1);free(wire);
#else
        size_t len=strlen(snapshot);push_t *push=malloc(sizeof(*push)+len+1);
        if(!push){free(snapshot);continue;}push->server=server;memcpy(push->payload,snapshot,len+1);free(snapshot);
#endif
        portENTER_CRITICAL(&push_lock);push_pending=true;portEXIT_CRITICAL(&push_lock);
        if(httpd_queue_work(server,push_work,push)!=ESP_OK){free(push);portENTER_CRITICAL(&push_lock);push_pending=false;portEXIT_CRITICAL(&push_lock);}}
}
bool emg_ws_server_start(void) {
    if(server)return true;
    httpd_config_t config=HTTPD_DEFAULT_CONFIG();config.server_port=EMG_WS_PORT;config.stack_size=8192;
    if(httpd_start(&server,&config)!=ESP_OK)return false;
    static const httpd_uri_t ws={.uri="/ws",.method=HTTP_GET,.handler=ws_handler,.is_websocket=true};
    if(httpd_register_uri_handler(server,&ws)!=ESP_OK){httpd_stop(server);server=NULL;return false;}
    if(!broadcast_handle){
        TaskHandle_t created=NULL;
        if(xTaskCreate(broadcast_task,"emg_ws_push",4096,NULL,1,&created)!=pdPASS){httpd_stop(server);server=NULL;return false;}
        portENTER_CRITICAL(&push_lock);broadcast_handle=created;portEXIT_CRITICAL(&push_lock);
    }
    ESP_LOGI("emg_ws","WebSocket server listening at ws://<ESP32-IP>:%u/ws",(unsigned)config.server_port);return true;
}
bool emg_ws_server_stop(void) {
    if(!server)return true;
    httpd_handle_t previous=server;server=NULL;return httpd_stop(previous)==ESP_OK;
}
