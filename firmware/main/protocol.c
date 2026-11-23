#include "trainer.h"
#include <ctype.h>
#include <inttypes.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef ESP_PLATFORM
#define TR_ADC_AVAILABLE_STR "true"
#define TR_ADC_ENABLED 1
#else
#define TR_ADC_AVAILABLE_STR "false"
#define TR_ADC_ENABLED 0
#endif

typedef struct { char *p; size_t used,cap; bool ok; } writer_t;
static void add(writer_t *w,const char *fmt,...) {
    if(!w->ok) return;
    va_list ap; va_start(ap,fmt); int n=vsnprintf(w->p+w->used,w->cap-w->used,fmt,ap); va_end(ap);
    if(n<0 || (size_t)n>=w->cap-w->used) { w->ok=false; if(w->cap)w->p[0]=0; return; }
    w->used+=(size_t)n;
}
typedef struct { char key[40],text[64]; double number; bool string; } field_t;
typedef struct { field_t f[40]; unsigned n; } object_t;
static void space(const char **p) { while(isspace((unsigned char)**p))++*p; }
static bool quoted(const char **p,char *s,size_t cap) {
    if(*(*p)++!='"') return false;
    size_t n=0;
    while(**p && **p!='"') {
        unsigned char c=(unsigned char)*(*p)++;
        /* Command strings are ASCII identifiers. Escapes/nesting are outside
         * the documented protocol subset and are explicitly rejected. */
        if(c<32 || c>=127 || c=='\\' || n+1>=cap)return false;
        s[n++]=(char)c;
    }
    if(**p!='"')return false;
    ++*p; s[n]=0; return true;
}
static bool number(const char **p,double *v) {
    const char *start=*p;
    if(**p=='-')++*p;
    if(**p=='0')++*p;
    else { if(**p<'1'||**p>'9')return false; while(isdigit((unsigned char)**p))++*p; }
    if(**p=='.') { ++*p; if(!isdigit((unsigned char)**p))return false; while(isdigit((unsigned char)**p))++*p; }
    if(**p=='e'||**p=='E') { ++*p; if(**p=='+'||**p=='-')++*p; if(!isdigit((unsigned char)**p))return false; while(isdigit((unsigned char)**p))++*p; }
    char *end; *v=strtod(start,&end); return end==*p && isfinite(*v);
}
static bool parse(const char *s,object_t *o) {
    memset(o,0,sizeof(*o)); space(&s); if(*s++!='{')return false; space(&s);
    if(*s=='}') { s++; space(&s); return !*s; }
    for(;;) {
        if(o->n>=40)return false;
        field_t *f=&o->f[o->n]; if(!quoted(&s,f->key,sizeof(f->key)))return false;
        for(unsigned i=0;i<o->n;i++)if(!strcmp(o->f[i].key,f->key))return false;
        space(&s); if(*s++!=':')return false; space(&s);
        f->string=*s=='"';
        if(f->string) { if(!quoted(&s,f->text,sizeof(f->text)))return false; }
        else if(!number(&s,&f->number))return false;
        o->n++; space(&s);
        if(*s=='}') { s++; space(&s); return !*s; }
        if(*s++!=',')return false;
        space(&s);
    }
}
static const field_t *get(const object_t *o,const char *key) {
    for(unsigned i=0;i<o->n;i++)if(!strcmp(o->f[i].key,key))return &o->f[i];
    return NULL;
}
static bool integer(const field_t *f,uint32_t lo,uint32_t hi,uint32_t *v) {
    if(!f || f->string || f->number<lo || f->number>hi || floor(f->number)!=f->number)return false;
    *v=(uint32_t)f->number; return true;
}
static bool set_field(tr_config_t *c,const field_t *f) {
    if(!strcmp(f->key,"source")) {
        if(!f->string)return false;
        if(!strcmp(f->text,"SIMULATION"))c->source=TR_SIMULATION;
        else if(!strcmp(f->text,"REPLAY"))c->source=TR_REPLAY;
        else if(!strcmp(f->text,"ADC"))c->source=TR_ADC;
        else return false;
        return true;
    }
    if(!strcmp(f->key,"signal_kind")) {
        if(!f->string)return false;
        if(!strcmp(f->text,"RAW"))c->kind=TR_RAW;
        else if(!strcmp(f->text,"ENVELOPE"))c->kind=TR_ENVELOPE;
        else return false;
        return true;
    }
    if(!strcmp(f->key,"unit")) {
        if(!f->string || strlen(f->text)>=sizeof(c->adc_unit))return false;
        if(!strcmp(f->text,"count"))strcpy(c->adc_unit,"ADC");
        else strcpy(c->adc_unit,f->text);
        return true;
    }
#define INT(key_,member,lo,hi) if(!strcmp(f->key,key_))return integer(f,lo,hi,&c->member)
    INT("fs_hz",fs_hz,256,8000);
    INT("channels",channels,1,2);
    INT("target_reps",target_reps,1,1000);
    INT("hold_ms",hold_ms,0,10000);
    INT("exercise_channel",exercise_channel,0,1);
#undef INT
    if(!strcmp(f->key,"mode")) { if(!f->string || (strcmp(f->text,"free") && strcmp(f->text,"training")))return false; c->free_mode=!strcmp(f->text,"free"); return true; }
    if(!strcmp(f->key,"muscle")) { if(!f->string || (strcmp(f->text,"forearm") && strcmp(f->text,"biceps")))return false; c->biceps=!strcmp(f->text,"biceps"); return true; }
    if(!strcmp(f->key,"zone_enabled")) { uint32_t flag; if(!integer(f,0,1,&flag))return false; c->zone_enabled=flag; return true; }
    if(f->string || !isfinite((float)f->number))return false;
#define FLOAT(key_,member) if(!strcmp(f->key,key_)){c->member=(float)f->number; return true;}
    FLOAT("reference_rms",reference_rms); FLOAT("zone_low_pct",zone_low_pct); FLOAT("zone_high_pct",zone_high_pct);
    FLOAT("highpass_hz",highpass_hz); FLOAT("lowpass_hz",lowpass_hz);
    FLOAT("notch_hz",notch_hz); FLOAT("notch_q",notch_q); FLOAT("rms_ms",rms_ms);
    FLOAT("cal_ms",cal_ms); FLOAT("settle_ms",settle_ms);
    FLOAT("on_ms",on_ms); FLOAT("off_ms",off_ms);
    FLOAT("on_factor",on_factor); FLOAT("off_factor",off_factor);
    FLOAT("on_sd",on_sd); FLOAT("off_sd",off_sd);
    FLOAT("threshold_floor",threshold_floor); FLOAT("threshold_gap",threshold_gap);
    FLOAT("bias1",input_bias[0]); FLOAT("bias2",input_bias[1]);
    FLOAT("scale1",input_scale[0]); FLOAT("scale2",input_scale[1]);
    FLOAT("gain1",input_gain[0]); FLOAT("gain2",input_gain[1]);
#undef FLOAT
    return false;
}
size_t tr_status(const tr_engine_t *t,char *out,size_t cap) {
    writer_t w={out,0,cap,true}; const tr_config_t *c=&t->config;
    add(&w,"{\"v\":1,\"type\":\"status\",\"firmware\":\"%s\",\"state\":\"%s\",\"session_id\":%llu,\"adc_available\":" TR_ADC_AVAILABLE_STR ",\"config\":{",TR_VERSION,tr_session_name(t->state),(unsigned long long)t->session_id);
    add(&w,"\"source\":\"%s\",\"signal_kind\":\"%s\",\"fs_hz\":%u,\"channels\":%u,\"unit\":\"%s\",",tr_source_name(c->source),c->kind==TR_RAW?"RAW":"ENVELOPE",c->fs_hz,c->channels,tr_unit(t));
    add(&w,"\"highpass_hz\":%.6g,\"lowpass_hz\":%.6g,\"notch_hz\":%.6g,\"notch_q\":%.6g,\"rms_ms\":%.7g,\"cal_ms\":%.7g,\"settle_ms\":%.7g,",(double)c->highpass_hz,(double)c->lowpass_hz,(double)c->notch_hz,(double)c->notch_q,(double)c->rms_ms,(double)c->cal_ms,(double)c->settle_ms);
    add(&w,"\"on_ms\":%.6g,\"off_ms\":%.6g,\"on_factor\":%.6g,\"off_factor\":%.6g,\"on_sd\":%.6g,\"off_sd\":%.6g,\"threshold_floor\":%.6g,\"threshold_gap\":%.6g,",(double)c->on_ms,(double)c->off_ms,(double)c->on_factor,(double)c->off_factor,(double)c->on_sd,(double)c->off_sd,(double)c->threshold_floor,(double)c->threshold_gap);
    add(&w,"\"bias1\":%.7g,\"bias2\":%.7g,\"scale1\":%.7g,\"scale2\":%.7g,\"gain1\":%.7g,\"gain2\":%.7g,\"dc_offset1\":%.7g,\"dc_offset2\":%.7g,\"target_reps\":%u,\"hold_ms\":%u,\"exercise_channel\":%u},\"fault\":\"%s\"}",
        (double)c->input_bias[0],(double)c->input_bias[1],(double)c->input_scale[0],(double)c->input_scale[1],(double)c->input_gain[0],(double)c->input_gain[1],(double)t->channel[0].dc_offset,(double)t->channel[1].dc_offset,c->target_reps,c->hold_ms,c->exercise_channel,t->fault);
    return w.ok?w.used:0;
}
size_t tr_telemetry(tr_engine_t *t,char *out,size_t cap) {
    writer_t w={out,0,cap,true};
    add(&w,"{\"v\":1,\"type\":\"data\",\"seq\":%llu,\"session_id\":%llu,\"clock\":\"sample\",\"sample_end\":%llu,\"t_ms\":%.3f,\"source\":\"%s\",\"signal_kind\":\"%s\",\"unit\":\"%s\",\"fs_hz\":%u,\"state\":\"%s\",\"target\":%u,\"hold_ms\":%u,\"exercise_channel\":%u,\"trace_step_ms\":%.4f,\"channels\":[",
        (unsigned long long)++t->seq,(unsigned long long)t->session_id,(unsigned long long)t->samples,t->samples*1000.0/t->config.fs_hz,tr_source_name(t->config.source),t->config.kind==TR_RAW?"RAW":"ENVELOPE",tr_unit(t),t->config.fs_hz,tr_session_name(t->state),t->config.target_reps,t->config.hold_ms,t->config.exercise_channel,TR_BLOCK*1000.0/t->config.fs_hz);
    for(unsigned k=0;k<t->config.channels;k++) {
        const tr_channel_t *c=&t->channel[k];
        add(&w,"%s{\"id\":%u,\"value\":%.5g,\"on\":%.5g,\"off\":%.5g,\"muscle\":\"%s\",\"reps\":%u,\"valid_reps\":%u,\"last_hold_ms\":%.2f,\"baseline\":%.5g,\"trace\":[",k?",":"",k,c->value,c->on,c->off,tr_muscle_name(c->state),c->reps,c->valid_reps,c->last_hold_ms,c->mean);
        for(unsigned j=0;j<c->trace_pairs*2;j++)add(&w,"%s%.4g",j?",":"",c->trace[j]);
        add(&w,"]");
        if(c->reps) { const tr_rep_t *r=&c->ledger[c->reps-1]; add(&w,",\"last_rep\":{\"ordinal\":%u,\"ended_ms\":%.3f,\"hold_ms\":%.3f,\"rest_ms\":%.3f,\"in_zone_ms\":%.3f,\"valid\":%s}",c->reps,(double)r->ended_ms,(double)r->hold_ms,(double)r->rest_ms,(double)r->in_zone_ms,r->valid?"true":"false"); }
        add(&w,"}");
    }
    add(&w,"],\"boot_id\":\"%s\",\"signal_valid\":%s,\"health\":{\"discontinuities\":%u,\"tx_dropped\":%u,\"backlog_ticks\":%u,\"max_dsp_us\":%u},\"fault\":\"%s\"}",t->boot_id,t->channel[0].filled==t->window?"true":"false",t->discontinuities,t->tx_dropped,t->backlog_ticks,t->max_dsp_us,t->fault);
    return w.ok?w.used:0;
}
size_t tr_web_snapshot(const tr_engine_t *t,uint64_t sequence,char *out,size_t cap) {
    writer_t w={out,0,cap,true}; const tr_config_t *c=&t->config;
    const tr_channel_t *ch=&t->channel[c->exercise_channel];
    const char *states[]={"idle","calibrating","ready","training","stopped","completed","completed","error"};
    double hold=tr_current_hold_ms(t);
    double in_zone=ch->zone_frames*1000.0/c->fs_hz,longest=ch->zone_longest*1000.0/c->fs_hz;
    const char *phase=tr_phase_name(tr_phase(t));
    add(&w,"{\"type\":\"snapshot\",\"protocol\":1,\"format\":\"semg_v2\",\"firmware_version\":\"%s\",\"boot_id\":\"%s\",\"session_id\":%llu,\"sequence\":%llu,\"t_ms\":%.3f,\"duration_ms\":%.3f,",TR_VERSION,t->boot_id,(unsigned long long)t->session_id,(unsigned long long)sequence,t->samples*1000.0/c->fs_hz,tr_duration_ms(t));
    add(&w,"\"state\":\"%s\",\"phase\":\"%s\",\"paused\":%s,\"raw_recording\":%s,\"source\":\"%s\",\"signal_kind\":\"%s\",\"fs_hz\":%u,\"unit\":\"%s\",",states[t->state],phase,t->paused?"true":"false",t->raw_recording_enabled?"true":"false",c->source==TR_SIMULATION?"simulation":c->source==TR_REPLAY?"replay":"sensor",c->kind==TR_RAW?"RAW":"ENVELOPE",(unsigned)c->fs_hz,tr_unit(t));
    if(c->source==TR_ADC) {
        unsigned ch_idx=c->exercise_channel<c->channels?c->exercise_channel:0;
        bool using_cali=t->adc_calibrated && fabsf(c->input_scale[ch_idx]-TR_ADC_DEFAULT_SCALE_UV)<0.05f && t->adc_cali_scale_uv>0.0f;
        float eff_scale=using_cali?t->adc_cali_scale_uv:c->input_scale[ch_idx];
        float uv_per_unit=eff_scale/c->input_gain[ch_idx];
        float offset_uv=c->input_bias[ch_idx]==0.0f?0.0f:-c->input_bias[ch_idx]*uv_per_unit;
        const char *ref=t->adc_cali_ref[0]?t->adc_cali_ref:"ESP32 ADC1 GPIO34 (nominal 805.86 uV/count) + INA333/MCP601";
        add(&w,"\"conversion\":{\"uV_per_unit\":%.6g,\"offset_uV\":%.6g,\"reference\":\"%s\",\"bias\":%.7g,\"scale\":%.6g,\"gain\":%.7g,\"calibrated\":%s},",
            (double)uv_per_unit,(double)offset_uv,ref,(double)c->input_bias[ch_idx],(double)eff_scale,(double)c->input_gain[ch_idx],using_cali?"true":"false");
    }
    add(&w,"\"capabilities\":[\"semg_v2\",\"biofeedback_v1\",\"rest_v1\",\"raw_stream_v1\"%s],",t->timing_valid?",\"timing_v1\"":"");
    if(t->timing_valid) {
        double clk_ms=t->device_clock_ms>=0.0?t->device_clock_ms:0.0;
        double sampled_ms=t->sampled_at_device_ms>0.0?t->sampled_at_device_ms:clk_ms;
        add(&w,"\"device_clock_ms\":%.3f,\"sampled_at_device_ms\":%.3f,",clk_ms,sampled_ms);
    }
    if(t->oled_sequence_valid) {
        add(&w,"\"oled_sequence\":%llu,",(unsigned long long)t->oled_sequence);
    }
    add(&w,"\"dsp_config\":{\"highpass_hz\":%.6g,\"lowpass_hz\":%.6g,\"notch_hz\":%.6g,\"notch_q\":%.6g,\"rms_ms\":%.7g,\"cal_ms\":%.7g,\"settle_ms\":%.7g,\"on_ms\":%.6g,\"off_ms\":%.6g,\"on_factor\":%.6g,\"off_factor\":%.6g,\"on_sd\":%.6g,\"off_sd\":%.6g,",
        (double)c->highpass_hz,(double)c->lowpass_hz,(double)c->notch_hz,(double)c->notch_q,(double)c->rms_ms,(double)c->cal_ms,(double)c->settle_ms,(double)c->on_ms,(double)c->off_ms,(double)c->on_factor,(double)c->off_factor,(double)c->on_sd,(double)c->off_sd);
    if(c->source==TR_ADC && t->channel[0].dc_calibrated) add(&w,"\"dc_offset_ch1\":%.5g},",(double)t->channel[0].dc_offset);
    else add(&w,"\"dc_offset_ch1\":null},");
    if(c->source==TR_ADC) {
        unsigned ch_idx=c->exercise_channel<c->channels?c->exercise_channel:0;
        add(&w,"\"adc_config\":{\"resolution_bits\":12,\"atten_db\":12,\"hw_sample_rate_hz\":32768,\"oversampling_ratio\":16,\"sampling_mode\":\"single_channel_dma\",\"gpio\":34,\"analog_frontend\":\"INA333/MCP601 AFE\",\"analog_gain\":%.6g,\"analog_bandpass_hz\":null,\"clip_count\":%u},",
            (double)c->input_gain[ch_idx],t->adc_clip_count);
    } else if(c->source==TR_REPLAY) {
        add(&w,"\"adc_config\":{\"resolution_bits\":null,\"atten_db\":null,\"hw_sample_rate_hz\":2048,\"oversampling_ratio\":1,\"sampling_mode\":\"single_channel_replay\",\"gpio\":null,\"analog_frontend\":null,\"analog_gain\":null,\"analog_bandpass_hz\":null,\"clip_count\":0},");
    } else {
        add(&w,"\"adc_config\":{\"resolution_bits\":null,\"atten_db\":null,\"hw_sample_rate_hz\":%u,\"oversampling_ratio\":1,\"sampling_mode\":\"%s\",\"gpio\":null,\"analog_frontend\":null,\"analog_gain\":null,\"analog_bandpass_hz\":null,\"clip_count\":0},",
            (unsigned)c->fs_hz,c->channels>1?"simulated_synchronous":"simulated_single_channel");
    }
    add(&w,"\"health\":{\"discontinuities\":%u,\"tx_dropped\":%u,\"backlog_ticks\":%u,\"max_dsp_us\":%u,\"raw_dropped_samples\":%u,\"raw_overflow_events\":%u,\"tracking_supported\":true},",
        t->discontinuities,t->tx_dropped,t->backlog_ticks,t->max_dsp_us,t->raw_dropped_samples,t->raw_overflow_events);
    if(c->source==TR_REPLAY) {
        add(&w,"\"replay_info\":{\"dataset_name\":\"GRABMyo\",\"dataset_version\":\"1.1.0\",\"doi\":\"10.13026/89dm-f662\",\"channel_name\":\"F1\",\"segment_description\":\"rest (5s) -> active (5s) -> rest (5s), 30720 samples @ 2048 Hz\",\"total_samples\":30720,\"license\":\"CC BY 4.0\"},");
    }
    add(&w,"\"settings\":{\"mode\":\"%s\",\"muscle\":\"%s\",\"channel\":%u,\"target\":%u,\"min_hold_ms\":%u,\"zone_enabled\":%s,\"zone_low_pct\":%.7g,\"zone_high_pct\":%.7g",c->free_mode?"free":"training",c->biceps?"biceps":"forearm",(unsigned)c->exercise_channel+1,(unsigned)c->target_reps,(unsigned)c->hold_ms,c->zone_enabled?"true":"false",(double)c->zone_low_pct,(double)c->zone_high_pct);
    if(c->reference_rms>0)add(&w,",\"reference_rms\":%.7g",(double)c->reference_rms);
    add(&w,"},\"channels\":[");
    for(unsigned k=0;k<c->channels;k++)add(&w,"%s{\"id\":%u,\"rms\":%.7g,\"filtered\":%.7g,\"on_threshold\":%.7g,\"off_threshold\":%.7g}",k?",":"",k+1,(double)t->channel[k].value,(double)t->channel[k].filtered,(double)t->channel[k].on,(double)t->channel[k].off);
    add(&w,"],\"valid_count\":%u,\"total_count\":%u,\"current_hold_ms\":%.3f,\"last_hold_ms\":%.3f,\"current_rest_ms\":%.3f,\"current_in_zone_ms\":%.3f,\"longest_in_zone_ms\":%.3f,\"calibration_progress\":%.6g,\"activation_pct\":",(unsigned)ch->valid_reps,(unsigned)ch->reps,hold,(double)ch->last_hold_ms,t->state==TR_RUNNING && !t->paused && ch->state==TR_REST?(t->samples-ch->rest_started)*1000.0/c->fs_hz:0,in_zone,longest,t->cal_samples?fmin(1,(double)t->samples/t->cal_samples):0);
    float pct=tr_activation(c,ch->value);
    if(pct<0)add(&w,"null");else add(&w,"%.7g",(double)pct);
    add(&w,",\"activation_level\":\"%s\",\"target_zone\":\"%s\",\"fault\":\"%s\",\"repetitions\":[",tr_activation_level(pct),tr_target_zone(c,pct),t->fault);
    for(unsigned i=0;i<ch->reps;i++) {
        const tr_rep_t *r=&ch->ledger[i];
        unsigned rep_ch=r->channel?r->channel:(unsigned)(c->exercise_channel+1);
        double started_ms=r->start_sample?(r->start_sample*1000.0/c->fs_hz):fmax(0.0,(double)r->ended_ms-(double)r->hold_ms);
        const char *reason=r->valid?"null":(r->reason_code==2?"\"insufficient_in_zone\"":(r->reason_code==1?"\"short_hold\"":(c->zone_enabled?"\"insufficient_in_zone\"":"\"short_hold\"")));
        add(&w,"%s{\"ordinal\":%u,\"channel\":%u,\"started_ms\":%.2f,\"ended_ms\":%.2f,\"hold_ms\":%.2f,\"rest_ms\":%.2f,\"in_zone_ms\":%.2f,\"start_sample_index\":%llu,\"end_sample_index\":%llu,\"rms_mean\":%.5g,\"rms_peak\":%.5g,\"reason_code\":%s,\"label_source\":\"algorithm_predicted\",\"valid\":%s}",
            i?",":"",i+1,rep_ch,started_ms,(double)r->ended_ms,(double)r->hold_ms,(double)r->rest_ms,(double)r->in_zone_ms,
            (unsigned long long)r->start_sample,(unsigned long long)r->end_sample,(double)r->rms_mean,(double)r->rms_peak,reason,r->valid?"true":"false");
    }
    add(&w,"]");
    if(t->state==TR_RUNNING && !t->paused && ch->state==TR_ACTIVE) {
        double started_ms=ch->contraction_started*1000.0/c->fs_hz;
        double ended_ms=t->samples*1000.0/c->fs_hz;
        float rms_mean=ch->active_rms_count?(float)(ch->active_rms_sum/ch->active_rms_count):ch->value;
        float rms_peak=ch->active_rms_count?ch->active_rms_peak:ch->value;
        add(&w,",\"active_contraction\":{\"channel\":%u,\"started_ms\":%.2f,\"ended_ms\":%.2f,\"hold_ms\":%.2f,\"in_zone_ms\":%.2f,\"start_sample_index\":%llu,\"end_sample_index\":%llu,\"rms_mean\":%.5g,\"rms_peak\":%.5g,\"reason_code\":\"session_in_progress\"}",
            (unsigned)(c->exercise_channel+1),started_ms,ended_ms,hold,longest,(unsigned long long)ch->contraction_started,(unsigned long long)t->samples,(double)rms_mean,(double)rms_peak);
    }
    if(t->incomplete_rep.present) {
        const tr_incomplete_rep_t *ir=&t->incomplete_rep;
        add(&w,",\"incomplete_contraction\":{\"channel\":%u,\"started_ms\":%.2f,\"ended_ms\":%.2f,\"hold_ms\":%.2f,\"in_zone_ms\":%.2f,\"start_sample_index\":%llu,\"end_sample_index\":%llu,\"rms_mean\":%.5g,\"rms_peak\":%.5g,\"reason_code\":\"stopped_mid_contraction\"}",
            (unsigned)ir->channel,(double)ir->started_ms,(double)ir->ended_ms,(double)ir->hold_ms,(double)ir->in_zone_ms,(unsigned long long)ir->start_sample,(unsigned long long)ir->end_sample,(double)ir->rms_mean,(double)ir->rms_peak);
    }
    add(&w,"}");return w.ok?w.used:0;
}
static bool is_uuid_string(const char *s) {
    if(!s || strlen(s)!=36)return false;
    for(unsigned i=0;i<36;i++) {
        bool dash=(i==8 || i==13 || i==18 || i==23);
        if(dash) { if(s[i]!='-')return false; }
        else if(!isxdigit((unsigned char)s[i]))return false;
    }
    return true;
}
bool tr_handle_ping(const char *json,double rx_ms,double tx_ms,char *out,size_t cap) {
    if(out && cap)out[0]=0;
    if(!json || !out || !cap || !isfinite(rx_ms) || !isfinite(tx_ms) || rx_ms<0.0 || tx_ms<rx_ms)return false;
    if(strlen(json)>=TR_COMMAND_BYTES)return false;
    object_t o;
    if(!parse(json,&o) || o.n!=3)return false;
    const field_t *tf=get(&o,"type"), *pf=get(&o,"protocol"), *id=get(&o,"ping_id");
    uint32_t proto=0;
    if(!tf || !tf->string || strcmp(tf->text,"ping"))return false;
    if(!integer(pf,1,1,&proto))return false;
    if(!id || !id->string || !is_uuid_string(id->text))return false;
    int n=snprintf(out,cap,"{\"type\":\"pong\",\"protocol\":1,\"ping_id\":\"%s\",\"device_rx_ms\":%.3f,\"device_tx_ms\":%.3f}",id->text,rx_ms,tx_ms);
    if(n<0 || (size_t)n>=cap){out[0]=0;return false;}
    return true;
}
static void capture_incomplete_rep(tr_engine_t *t) {
    const tr_config_t *c=&t->config;
    const tr_channel_t *ch=&t->channel[c->exercise_channel];
    if(t->state==TR_RUNNING && !t->paused && ch->state==TR_ACTIVE) {
        t->incomplete_rep=(tr_incomplete_rep_t){
            .present=true,
            .channel=(uint8_t)(c->exercise_channel+1U),
            .start_sample=ch->contraction_started,
            .end_sample=t->samples,
            .started_ms=(float)(ch->contraction_started*1000.0/c->fs_hz),
            .ended_ms=(float)(t->samples*1000.0/c->fs_hz),
            .hold_ms=(float)tr_current_hold_ms(t),
            .in_zone_ms=(float)(ch->zone_longest*1000.0/c->fs_hz),
            .rms_mean=ch->active_rms_count?(float)(ch->active_rms_sum/ch->active_rms_count):ch->value,
            .rms_peak=ch->active_rms_count?ch->active_rms_peak:ch->value
        };
    }
}
bool tr_command(tr_engine_t *t,const char *json,char *out,size_t cap) {
    object_t o; uint32_t id=0,v=0; const char *error=NULL;
    bool ok=false; const char *cmd="";
    if(strlen(json)>=TR_COMMAND_BYTES || !parse(json,&o)) { error="invalid_json"; goto done; }
    if(!integer(get(&o,"id"),1,UINT32_MAX,&id)) { error="invalid_id"; goto done; }
    if(!integer(get(&o,"v"),1,1,&v)) { error="unsupported_version"; goto done; }
    const field_t *cf=get(&o,"cmd");
    if(!cf || !cf->string) { error="missing_command"; goto done; }
    cmd=cf->text;
    if(t->previous_valid && id==t->previous_id) {
        if(!strcmp(json,t->previous_command)) { snprintf(out,cap,"%s",t->previous_ack); return t->previous_ok; }
        error="id_conflict"; goto done;
    }
    if(!strncmp(cmd,"web_",4)) {
        const field_t *boot=get(&o,"boot_id"), *session=get(&o,"session_id");
        uint32_t sid;
        if(!boot || !boot->string || strcmp(boot->text,t->boot_id) || !integer(session,0,UINT32_MAX,&sid) || sid!=t->session_id) {error="stale_session";goto done;}
        const char *action=cmd+4;
        tr_config_t next=t->config;
        bool has_raw_record=false, raw_record_val=t->raw_recording_enabled;
        for(unsigned i=0;i<o.n;i++) {
            const field_t *f=&o.f[i];
            if(!strcmp(f->key,"v") || !strcmp(f->key,"id") || !strcmp(f->key,"cmd") || !strcmp(f->key,"request_id") || !strcmp(f->key,"boot_id") || !strcmp(f->key,"session_id"))continue;
            if(strcmp(action,"calibrate") && strcmp(action,"start") && strcmp(action,"reset")) {error="unexpected_settings";goto done;}
            if(!strcmp(f->key,"raw_record")) {
                uint32_t flag=0;
                if(!integer(f,0,1,&flag)){error="invalid_settings";goto done;}
                has_raw_record=true; raw_record_val=(flag!=0);
                continue;
            }
            if(strcmp(f->key,"target_reps") && strcmp(f->key,"hold_ms") && strcmp(f->key,"exercise_channel") && strcmp(f->key,"channels") && strcmp(f->key,"mode") && strcmp(f->key,"muscle") && strcmp(f->key,"reference_rms") && strcmp(f->key,"zone_enabled") && strcmp(f->key,"zone_low_pct") && strcmp(f->key,"zone_high_pct")) {error="unknown_field";goto done;}
            if(!set_field(&next,f)){error="invalid_settings";goto done;}
        }
        if(next.exercise_channel==1 && next.channels<2 && next.source==TR_SIMULATION) next.channels=2;
        char validation[80];
        if(!tr_validate(&next,validation,sizeof(validation))) {error="invalid_settings";goto done;}
        if(!strcmp(action,"calibrate")) {
            if(t->state!=TR_IDLE && t->state!=TR_READY){error="busy_stop_first";goto done;}
            if(!TR_ADC_ENABLED && next.source==TR_ADC){error="adc_not_implemented";goto done;}
            if(has_raw_record)t->raw_recording_enabled=raw_record_val;
            tr_reset(t,&next);t->session_id++;t->state=TR_CALIBRATING;ok=true;
        } else if(!strcmp(action,"start")) {
            if(t->state!=TR_READY){error="calibrate_first";goto done;}
            if(memcmp(&next,&t->config,sizeof(next))){error="settings_changed";goto done;}
            if(has_raw_record)t->raw_recording_enabled=raw_record_val;
            t->state=TR_RUNNING;t->training_started=t->samples;ok=true;
        } else if(!strcmp(action,"reset")) {
            if(t->state==TR_RUNNING || t->state==TR_CALIBRATING){error="busy_stop_first";goto done;}
            if(has_raw_record)t->raw_recording_enabled=raw_record_val;
            tr_reset(t,&next);t->session_id++;ok=true;
        } else if(!strcmp(action,"stop")) {
            capture_incomplete_rep(t);
            t->state=TR_STOPPED;t->paused=false;ok=true;
        } else if(!strcmp(action,"pause") || !strcmp(action,"resume")) {
            bool pause=!strcmp(action,"pause");
            if(t->state!=TR_RUNNING || t->paused==pause){error="invalid_state";goto done;}
            t->paused=pause;ok=true;
        } else if(!strcmp(action,"reset_counter")) {
            /* A new ledger gets a new session; old records remain on the PC. */
            if(t->state==TR_CALIBRATING){error="busy_stop_first";goto done;}
            for(unsigned k=0;k<t->config.channels;k++){t->channel[k].reps=t->channel[k].valid_reps=0;t->channel[k].last_hold_ms=0;}
            memset(&t->incomplete_rep,0,sizeof(t->incomplete_rep));
            t->session_id++;ok=true;
        } else if(!strcmp(action,"get_state"))ok=true;
        else error="unknown_command";
        if(ok && (!strcmp(action,"stop") || !strcmp(action,"pause") || !strcmp(action,"resume") || !strcmp(action,"reset_counter"))) {
            for(unsigned k=0;k<t->config.channels;k++) {tr_channel_t *c=&t->channel[k];c->above=c->below=c->active_frames=c->onset_zone_frames=c->zone_frames=c->zone_longest=0;c->active_rms_sum=0;c->active_rms_peak=0;c->active_rms_count=0;c->state=TR_REST;c->rest_started=t->samples;}
        }
        goto done;
    }
    if(!strcmp(cmd,"configure") || !strcmp(cmd,"set_target")) {
        if(t->state==TR_RUNNING || t->state==TR_CALIBRATING) { error="busy_stop_first"; goto done; }
        tr_config_t next=t->config;
        for(unsigned i=0;i<o.n;i++) {
            const field_t *f=&o.f[i];
            if(!strcmp(f->key,"v") || !strcmp(f->key,"id") || !strcmp(f->key,"cmd"))continue;
            if(!strcmp(cmd,"set_target") && strcmp(f->key,"target_reps") && strcmp(f->key,"hold_ms") && strcmp(f->key,"exercise_channel")) { error="unknown_field"; goto done; }
            if(!set_field(&next,f)) { error="unknown_or_invalid_field"; goto done; }
        }
        char validation[80];
        if(!tr_validate(&next,validation,sizeof(validation))) {
            snprintf(out, cap,
         "{\"v\":1,\"type\":\"ack\",\"id\":%" PRIu32
         ",\"ok\":false,\"code\":\"%s\",\"state\":\"%s\"}",
         id, validation, tr_session_name(t->state));
            goto cache;
        }
        if(!strcmp(cmd,"configure")) { (void)tr_reset(t,&next); t->session_id++; }
        else if(t->state==TR_READY)t->config=next;
        else { (void)tr_reset(t,&next); t->session_id++; }
        ok=true;
    } else {
        if(o.n!=3) { error="unknown_field"; goto done; }
        if(!strcmp(cmd,"status"))ok=true;
        else if(!strcmp(cmd,"stop")) {
            capture_incomplete_rep(t);
            t->state=TR_STOPPED;
            for(unsigned k=0;k<t->config.channels;k++) {
                t->channel[k].above=t->channel[k].below=t->channel[k].active_frames=0;
                t->channel[k].active_rms_sum=0; t->channel[k].active_rms_peak=0; t->channel[k].active_rms_count=0;
                t->channel[k].state=TR_REST;
            }
            ok=true;
        }
        else if(!strcmp(cmd,"start") || !strcmp(cmd,"calibrate")) {
            if(t->state==TR_RUNNING || t->state==TR_CALIBRATING) { error="busy_stop_first"; goto done; }
            if(!TR_ADC_ENABLED && t->config.source==TR_ADC) { error="adc_not_implemented"; goto done; }
            if(!strcmp(cmd,"start") && t->state==TR_READY) {
                t->state=TR_RUNNING;t->training_started=t->samples;
            } else {
                (void)tr_reset(t,&t->config);
                t->run_after_calibration=!strcmp(cmd,"start");
                t->state=TR_CALIBRATING;
                t->session_id++;
            }
            ok=true;
        } else error="unknown_command";
    }
done:
   snprintf(out, cap,
         "{\"v\":1,\"type\":\"ack\",\"id\":%" PRIu32
         ",\"ok\":%s,\"code\":\"%s\",\"state\":\"%s\",\"session_id\":%llu}",
         id,
         ok ? "true" : "false",
         error ? error : "ok",
         tr_session_name(t->state),
         (unsigned long long)t->session_id);
cache:
    if(id && (!t->previous_valid || id!=t->previous_id)) {
        t->previous_id=id; t->previous_valid=true;
        t->previous_ok=ok;
        snprintf(t->previous_command,sizeof(t->previous_command),"%s",json);
        snprintf(t->previous_ack,sizeof(t->previous_ack),"%s",out);
    }
    return ok;
}
