#include "trainer.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

tr_config_t tr_default_config(void) {
    return (tr_config_t){
        .source=TR_SIMULATION, .kind=TR_RAW, .fs_hz=2048, .channels=1,
        .highpass_hz=20, .lowpass_hz=450, .notch_hz=0, .notch_q=30,
        .rms_ms=100.09765625f, .cal_ms=5000, .settle_ms=500,
        .on_ms=125, .off_ms=218.75f,
        .on_factor=1.8f, .off_factor=1.3f, .on_sd=4, .off_sd=2,
        .threshold_floor=0.5f, .threshold_gap=0.5f,
        .input_bias={0,0}, .input_scale={TR_ADC_DEFAULT_SCALE_UV,TR_ADC_DEFAULT_SCALE_UV},
        .input_gain={TR_ADC_DEFAULT_GAIN,TR_ADC_DEFAULT_GAIN}, .adc_unit="uV",
        .target_reps=5, .hold_ms=500, .exercise_channel=0,
        .reference_rms=300, .zone_low_pct=40, .zone_high_pct=70,
        .zone_enabled=false, .free_mode=false, .biceps=false
    };
}

bool tr_validate(const tr_config_t *c, char *error, size_t cap) {
#define CHECK(condition, why) do { if (!(condition)) { snprintf(error,cap,"%s",why); return false; } } while(0)
    CHECK(c->source>=TR_SIMULATION && c->source<=TR_ADC,"invalid_source");
    CHECK(c->kind==TR_RAW || c->kind==TR_ENVELOPE,"invalid_kind");
    CHECK(c->fs_hz>=256 && c->fs_hz<=8000,"fs_range_256_8000");
    CHECK(c->channels>=1 && c->channels<=2,"channels_range_1_2");
    CHECK(c->exercise_channel<c->channels,"invalid_exercise_channel");
    CHECK(isfinite(c->highpass_hz) && isfinite(c->lowpass_hz),"invalid_filter");
    CHECK(c->lowpass_hz>0 && c->lowpass_hz<0.45f*c->fs_hz,"lowpass_below_0_45_fs");
    CHECK(c->kind!=TR_RAW || (c->highpass_hz>0 && c->highpass_hz<c->lowpass_hz),"invalid_bandpass");
    CHECK(c->kind!=TR_ENVELOPE || c->highpass_hz==0,"envelope_requires_hp_zero");
    CHECK(c->kind!=TR_ENVELOPE || c->notch_hz==0,"envelope_requires_notch_zero");
    CHECK(isfinite(c->notch_hz) && (c->notch_hz==0 || c->notch_hz==50 || c->notch_hz==60),"notch_0_50_60");
    CHECK(c->notch_hz<0.45f*c->fs_hz && isfinite(c->notch_q) && c->notch_q>=1 && c->notch_q<=100,"invalid_notch");
    CHECK(isfinite(c->rms_ms) && c->rms_ms>=10 && c->rms_ms<=500,"rms_range_10_500_ms");
    CHECK(lroundf(c->rms_ms*c->fs_hz/1000.0f)<=TR_MAX_WINDOW,"window_too_large");
    CHECK(isfinite(c->cal_ms) && c->cal_ms>=1000 && c->cal_ms<=10000,"cal_range_1000_10000_ms");
    CHECK(isfinite(c->settle_ms) && c->settle_ms>=0 && c->settle_ms+c->rms_ms+3*TR_BLOCK*1000.0f/c->fs_hz<c->cal_ms,"insufficient_calibration");
    CHECK(isfinite(c->on_ms) && c->on_ms>=1 && c->on_ms<=5000,"invalid_on_ms");
    CHECK(isfinite(c->off_ms) && c->off_ms>=1 && c->off_ms<=5000,"invalid_off_ms");
    CHECK(isfinite(c->on_factor) && isfinite(c->off_factor) && c->on_factor>c->off_factor && c->off_factor>=1 && c->on_factor<=20,"invalid_factors");
    CHECK(isfinite(c->on_sd) && isfinite(c->off_sd) && c->on_sd>c->off_sd && c->off_sd>=0 && c->on_sd<=20,"invalid_sd_factors");
    CHECK(isfinite(c->threshold_floor) && c->threshold_floor>0 && c->threshold_floor<=1e6f,"invalid_threshold_floor");
    CHECK(isfinite(c->threshold_gap) && c->threshold_gap>0 && c->threshold_gap<=1e6f,"invalid_threshold_gap");
    CHECK(c->target_reps>=1 && c->target_reps<=1000 && c->hold_ms<=10000,"invalid_target");
    CHECK(isfinite(c->reference_rms) && c->reference_rms>=0 && c->reference_rms<=1e6f,"invalid_reference");
    CHECK(isfinite(c->zone_low_pct) && isfinite(c->zone_high_pct) && c->zone_low_pct>=0 && c->zone_low_pct<c->zone_high_pct && c->zone_high_pct<=200,"invalid_target_zone");
    CHECK(!c->zone_enabled || c->reference_rms>0,"reference_required");
    for(unsigned k=0;k<2;k++) {
        CHECK(isfinite(c->input_bias[k]) && fabsf(c->input_bias[k])<=65535,"invalid_bias");
        CHECK(isfinite(c->input_scale[k]) && c->input_scale[k]>0 && c->input_scale[k]<=1e6f,"invalid_scale");
        CHECK(isfinite(c->input_gain[k]) && c->input_gain[k]>0 && c->input_gain[k]<=1e6f,"invalid_gain");
    }
    CHECK(!strcmp(c->adc_unit,"uV") || !strcmp(c->adc_unit,"ADC") || !strcmp(c->adc_unit,"a.u."),"invalid_unit");
    CHECK(c->source!=TR_ADC || c->channels==1,"adc_single_channel_only");
    CHECK(c->source!=TR_ADC || (float)TR_DC_CAL_MS+c->rms_ms+3*TR_BLOCK*1000.0f/c->fs_hz<c->cal_ms,"insufficient_calibration");
#ifdef ESP_PLATFORM
    CHECK(c->source!=TR_ADC || c->fs_hz==2048,"adc_fixed_2048Hz");
#endif
    CHECK(c->source!=TR_REPLAY || (c->fs_hz==2048 && c->channels==1 && c->kind==TR_RAW),"replay_fixed_2048Hz_1ch_RAW");
    CHECK(c->source!=TR_REPLAY || c->cal_ms<=5000,"replay_has_only_5s_baseline");
    if(cap) error[0]=0;
    return true;
#undef CHECK
}

const char *tr_source_name(tr_source_t v) { return v==TR_SIMULATION?"SIMULATION":v==TR_REPLAY?"REPLAY":"ADC"; }
const char *tr_session_name(tr_session_t v) {
    const char *names[]={"IDLE","CALIBRATING","READY","RUNNING","STOPPED","COMPLETED","EOF","ERROR"};
    return v>=TR_IDLE && v<=TR_ERROR?names[v]:"INVALID";
}
const char *tr_muscle_name(tr_muscle_t v) { return v==TR_CAL?"CAL":v==TR_REST?"REST":"ACTIVE"; }
const char *tr_unit(const tr_engine_t *t) { return t->config.source==TR_ADC?t->config.adc_unit:"uV"; }

float tr_activation(const tr_config_t *c,float rms) { return c->reference_rms>0?100*rms/c->reference_rms:-1; }
const char *tr_activation_level(float p) { return p<0?"unavailable":p<30?"low":p<70?"medium":"high"; }
const char *tr_target_zone(const tr_config_t *c,float p) { return p<0 || !c->zone_enabled?"unavailable":p<c->zone_low_pct?"below":p>c->zone_high_pct?"above":"inside"; }
