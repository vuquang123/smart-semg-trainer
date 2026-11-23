#include "trainer.h"
#include <complex.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#define PI 3.14159265358979323846

static tr_biquad_t lowpass(double fs, double hz) {
    double w=2*PI*hz/fs, cs=cos(w), alpha=sin(w)/sqrt(2.0), a0=1+alpha;
    return (tr_biquad_t){(float)((1-cs)/2/a0),(float)((1-cs)/a0),(float)((1-cs)/2/a0),
        (float)(-2*cs/a0),(float)((1-alpha)/a0),0,0};
}
/* Butterworth prototype N=2 -> bandpass order 4 -> bilinear transform.
 * Recomputed from Fs/cutoffs on every reset; defaults reproduce v0.1 SOS. */
static void bandpass(tr_biquad_t f[2], double fs, double lo, double hi) {
    double wlo=2*fs*tan(PI*lo/fs), whi=2*fs*tan(PI*hi/fs);
    double bw=whi-wlo, w0=sqrt(wlo*whi);
    double complex p=(-1+I)/sqrt(2.0), z[2];
    double complex d=csqrt(p*p*bw*bw-4*w0*w0);
    double complex s0=(p*bw+d)/2, s1=(p*bw-d)/2;
    z[0]=(2*fs+s0)/(2*fs-s0); z[1]=(2*fs+s1)/(2*fs-s1);
    if(cabs(z[0])>cabs(z[1])) { double complex tmp=z[0]; z[0]=z[1]; z[1]=tmp; }
    for(unsigned j=0;j<2;j++) f[j]=(tr_biquad_t){1,j?-2:2,1,
        (float)(-2*creal(z[j])),(float)(creal(z[j]*conj(z[j]))),0,0};
    double w=2*atan(w0/(2*fs));
    double complex zi=cexp(-I*w), h=1;
    for(unsigned j=0;j<2;j++) h*=(f[j].b0+f[j].b1*zi+f[j].b2*zi*zi)/(1+f[j].a1*zi+f[j].a2*zi*zi);
    float gain=(float)(1/cabs(h)); f[0].b0*=gain; f[0].b1*=gain; f[0].b2*=gain;
}
static tr_biquad_t notch(double fs, double hz, double q) {
    double w=2*PI*hz/fs, cs=cos(w), alpha=sin(w)/(2*q), a0=1+alpha;
    return (tr_biquad_t){(float)(1/a0),(float)(-2*cs/a0),(float)(1/a0),
        (float)(-2*cs/a0),(float)((1-alpha)/a0),0,0};
}
static float biquad(tr_biquad_t *f,float x) {
    float y=f->b0*x+f->z1;
    f->z1=f->b1*x-f->a1*y+f->z2; f->z2=f->b2*x-f->a2*y;
    return y;
}
static uint32_t ms_samples(float ms, uint32_t fs) { return (uint32_t)lround((double)ms*fs/1000); }
bool tr_reset(tr_engine_t *t, const tr_config_t *c) {
    char error[80];
    if(!tr_validate(c,error,sizeof(error))) return false;
    t->config=*c; memset(t->channel,0,sizeof(t->channel));
    memset(&t->incomplete_rep,0,sizeof(t->incomplete_rep));
    t->raw_dropped_samples=0; t->raw_overflow_events=0;
    tr_source_reset(&t->source); t->samples=0; t->blocks=0; t->fault[0]=0;
    t->window=ms_samples(c->rms_ms,c->fs_hz);
    t->cal_samples=ms_samples(c->cal_ms,c->fs_hz);
    t->settle_samples=ms_samples(c->settle_ms,c->fs_hz);
    t->dc_cal_samples=ms_samples(TR_DC_CAL_MS,c->fs_hz);
    t->on_samples=(uint32_t)ceil((double)c->on_ms*c->fs_hz/1000);
    t->off_samples=(uint32_t)ceil((double)c->off_ms*c->fs_hz/1000);
    t->state=TR_IDLE; t->run_after_calibration=false; t->paused=false; t->training_started=0;
    for(unsigned k=0;k<c->channels;k++) {
        tr_channel_t *ch=&t->channel[k]; ch->state=TR_CAL;
        if(c->kind==TR_RAW) { bandpass(ch->filter,c->fs_hz,c->highpass_hz,c->lowpass_hz); ch->filter_count=2; }
        else { ch->filter[0]=lowpass(c->fs_hz,c->lowpass_hz); ch->filter_count=1; }
        if(c->notch_hz>0) ch->filter[ch->filter_count++]=notch(c->fs_hz,c->notch_hz,c->notch_q);
    }
    return true;
}
void tr_init(tr_engine_t *t) { memset(t,0,sizeof(*t)); tr_config_t c=tr_default_config(); (void)tr_reset(t,&c); }
bool tr_is_acquiring(const tr_engine_t *t) { return t->state==TR_CALIBRATING || (t->state==TR_RUNNING && !t->paused); }
void tr_fail(tr_engine_t *t,const char *code) {
    t->state=TR_ERROR; snprintf(t->fault,sizeof(t->fault),"%s",code);
    for(unsigned k=0;k<t->config.channels;k++) { t->channel[k].above=0; t->channel[k].below=0; t->channel[k].active_rms_sum=0; t->channel[k].active_rms_peak=0; t->channel[k].active_rms_count=0; t->channel[k].state=TR_REST; }
}
/* Free counting has no end condition. A full ledger ends it as a normal stop
 * (results kept, no fault); the web shows why from total_count. */
static void stop_full_free(tr_engine_t *t) {
    t->state=TR_STOPPED; t->paused=false;
    for(unsigned k=0;k<t->config.channels;k++) {
        tr_channel_t *c=&t->channel[k];
        c->above=c->below=c->active_frames=c->onset_zone_frames=c->zone_frames=c->zone_longest=0;
        c->active_rms_sum=0; c->active_rms_peak=0; c->active_rms_count=0;
        c->state=TR_REST; c->rest_started=t->samples;
    }
}
double tr_current_hold_ms(const tr_engine_t *t) {
    const tr_channel_t *ch=&t->channel[t->config.exercise_channel];
    return t->state==TR_RUNNING && !t->paused && ch->state==TR_ACTIVE && ch->active_frames>=ch->below?
        (ch->active_frames-ch->below)*1000.0/t->config.fs_hz:0;
}
double tr_duration_ms(const tr_engine_t *t) {
    return t->training_started && t->samples>=t->training_started?
        (t->samples-t->training_started)*1000.0/t->config.fs_hz:0;
}
tr_phase_t tr_phase(const tr_engine_t *t) {
    const tr_config_t *c=&t->config;
    const tr_channel_t *ch=&t->channel[c->exercise_channel];
    if(t->state==TR_COMPLETED) return TR_PHASE_COMPLETE;
    if(t->state!=TR_RUNNING || t->paused) return TR_PHASE_IDLE;
    if(ch->state!=TR_ACTIVE) return TR_PHASE_RELAX;
    if(c->free_mode) return TR_PHASE_CONTRACT;
    double held=c->zone_enabled?ch->zone_longest*1000.0/c->fs_hz:tr_current_hold_ms(t);
    return held>=c->hold_ms?TR_PHASE_RELEASE:TR_PHASE_HOLD;
}
const char *tr_phase_name(tr_phase_t v) {
    static const char *const names[]={"idle","relax","contract","hold","release","complete"};
    return (unsigned)v<sizeof(names)/sizeof(names[0])?names[v]:"idle";
}
static void evaluate(tr_engine_t *t, tr_channel_t *ch) {
    uint32_t hop=TR_BLOCK;
    if(t->state==TR_CALIBRATING) {
        if(t->samples>=t->settle_samples && ch->filled==t->window) {
            ++ch->cal_count;
            double delta=ch->value-ch->mean;
            ch->mean+=delta/ch->cal_count; ch->m2+=delta*(ch->value-ch->mean);
        }
        return;
    }
    if(t->state!=TR_RUNNING) return;
    float pct=tr_activation(&t->config,ch->value);
    bool inside=pct>=t->config.zone_low_pct && pct<=t->config.zone_high_pct && pct>=0;
    if(ch->state==TR_REST) {
        ch->above=ch->value>ch->on?ch->above+hop:0;
        ch->onset_zone_frames=ch->above && inside?ch->onset_zone_frames+hop:0;
        if(ch->above>=t->on_samples) {
            ch->state=TR_ACTIVE; ch->active_frames=ch->above;
            ch->contraction_started=t->samples-ch->above;
            ch->last_rest_ms=(float)(ch->contraction_started-ch->rest_started)*1000/t->config.fs_hz;
            ch->zone_frames=ch->zone_longest=ch->onset_zone_frames;
            ch->active_rms_sum=ch->value; ch->active_rms_peak=ch->value; ch->active_rms_count=1;
            ch->above=0; ch->below=0;
        }
    } else if(ch->state==TR_ACTIVE) {
        ch->active_frames+=hop;
        ch->active_rms_sum+=ch->value;
        if(ch->value>ch->active_rms_peak)ch->active_rms_peak=ch->value;
        ch->active_rms_count++;
        ch->zone_frames=inside?ch->zone_frames+hop:0;
        if(ch->zone_frames>ch->zone_longest)ch->zone_longest=ch->zone_frames;
        ch->below=ch->value<ch->off?ch->below+hop:0;
        if(ch->below>=t->off_samples) {
            if(ch->reps>=TR_MAX_REPS) {
                if(t->config.free_mode) { stop_full_free(t); return; }
                tr_fail(t,"ledger_full"); return;
            }
            /* Measured hold excludes release-confirmation samples. */
            ch->last_hold_ms=(ch->active_frames-ch->below)*1000.0f/t->config.fs_hz;
            ch->last_in_zone_ms=ch->zone_longest*1000.0f/t->config.fs_hz;
            bool valid=t->config.free_mode ||
                (t->config.zone_enabled?ch->last_in_zone_ms:ch->last_hold_ms)>=t->config.hold_ms;
            uint64_t end_sample=t->samples-ch->below;
            uint8_t ch_id=(uint8_t)(ch-t->channel)+1U;
            uint8_t reason=valid?0U:(t->config.zone_enabled?2U:1U);
            float rms_mean=ch->active_rms_count?(float)(ch->active_rms_sum/ch->active_rms_count):ch->value;
            float rms_peak=ch->active_rms_count?ch->active_rms_peak:ch->value;
            ch->ledger[ch->reps++]=(tr_rep_t){
                .ended_ms=end_sample*1000.0f/t->config.fs_hz,
                .hold_ms=ch->last_hold_ms,.rest_ms=ch->last_rest_ms,
                .in_zone_ms=ch->last_in_zone_ms,
                .start_sample=ch->contraction_started,.end_sample=end_sample,
                .rms_mean=rms_mean,.rms_peak=rms_peak,
                .channel=ch_id,.reason_code=reason,.valid=valid};
            if(valid) ch->valid_reps++;
            ch->rest_started=end_sample;
            ch->state=TR_REST; ch->below=ch->above=ch->active_frames=0;
            ch->zone_frames=ch->zone_longest=ch->onset_zone_frames=0;
            ch->active_rms_sum=0; ch->active_rms_peak=0; ch->active_rms_count=0;
        }
    }
}
bool tr_process_block(tr_engine_t *t,const tr_block_t *b) {
    if(!tr_is_acquiring(t)) return false;
    if(b->discontinuity || b->first_sample!=t->samples || b->channels!=t->config.channels || b->frames!=TR_BLOCK) {
        t->discontinuities++; tr_fail(t,"data_discontinuity"); return false;
    }
    /* Validate entire block first: no half-processed invalid block. */
    for(unsigned i=0;i<b->frames;i++) for(unsigned k=0;k<b->channels;k++)
        if(!isfinite(b->sample[i][k]) || fabsf(b->sample[i][k])>1e9f) { tr_fail(t,"invalid_sample"); return false; }
    /* Emit pre-DSP raw block before DC offset removal, filtering, and RMS. */
    if(t->raw_recording_enabled && t->on_raw_block) {
        t->on_raw_block(t, b);
    }
    /*
     * The ADC adapter has already converted codes to the configured unit.
     * Estimate the remaining input DC in that same unit, then keep it fixed.
     * Simulation and replay are intentionally excluded: their samples are
     * already centered and must not be calibrated a second time.
     */
    if(t->config.source==TR_ADC && !t->channel[0].dc_calibrated) {
        for(unsigned k=0;k<b->channels;k++) {
            tr_channel_t *ch=&t->channel[k];
            for(unsigned i=0;i<b->frames;i++) {
                ch->dc_sum+=(double)b->sample[i][k];
                ch->dc_count++;
            }
        }
        t->samples+=b->frames;
        if(t->samples>=t->dc_cal_samples) {
            for(unsigned k=0;k<b->channels;k++) {
                tr_channel_t *ch=&t->channel[k];
                ch->dc_offset=(float)(ch->dc_sum/ch->dc_count);
                ch->dc_calibrated=true;
            }
        }
        return true;
    }
    for(unsigned k=0;k<b->channels;k++) {
        tr_channel_t *ch=&t->channel[k];
        float lo=INFINITY,hi=-INFINITY;
        for(unsigned i=0;i<b->frames;i++) {
            float x=b->sample[i][k];
            if(t->config.source==TR_ADC)x-=ch->dc_offset;
            for(unsigned j=0;j<ch->filter_count;j++) x=biquad(&ch->filter[j],x);
            if(!isfinite(x)) { tr_fail(t,"filter_not_finite"); return false; }
            ch->filtered=x;
            if(x<lo)lo=x;
            if(x>hi)hi=x;
            double sq=(double)x*x;
            ch->sum+=sq-ch->square[ch->pos]; ch->square[ch->pos]=sq;
            ch->pos=(ch->pos+1)%t->window;
            if(ch->filled<t->window) ch->filled++;
        }
        if(ch->trace_pairs>=8) { memmove(ch->trace,ch->trace+2,14*sizeof(float)); ch->trace_pairs=7; }
        ch->trace[2*ch->trace_pairs]=lo; ch->trace[2*ch->trace_pairs+1]=hi; ch->trace_pairs++;
        /* RAW -> RMS. ENVELOPE -> low-pass amplitude, never high-pass/RMS again. */
        ch->value=t->config.kind==TR_RAW?(float)sqrt(fmax(0,ch->sum/t->window)):fmaxf(0,ch->filtered);
    }
    t->samples+=b->frames; t->blocks++;
    if(t->channel[0].filled<t->window) return true;
    for(unsigned k=0;k<b->channels && t->state!=TR_ERROR;k++) evaluate(t,&t->channel[k]);
    if(t->state==TR_CALIBRATING && t->samples>=t->cal_samples) {
        for(unsigned k=0;k<b->channels;k++) {
            tr_channel_t *ch=&t->channel[k];
            if(ch->cal_count<3) { tr_fail(t,"insufficient_calibration"); return false; }
            double sd=sqrt(fmax(0,ch->m2/(ch->cal_count-1)));
            ch->off=(float)fmax(t->config.threshold_floor,fmax(t->config.off_factor*ch->mean,ch->mean+t->config.off_sd*sd));
            ch->on=(float)fmax(ch->off+t->config.threshold_gap,fmax(t->config.on_factor*ch->mean,ch->mean+t->config.on_sd*sd));
            ch->state=TR_REST;
            ch->rest_started=t->samples;
        }
        t->state=t->run_after_calibration?TR_RUNNING:TR_READY;
        if(t->state==TR_RUNNING)t->training_started=t->samples;
    }
    if(t->state==TR_RUNNING && !t->config.free_mode && t->channel[t->config.exercise_channel].valid_reps>=t->config.target_reps) t->state=TR_COMPLETED;
    if(t->state==TR_RUNNING && t->channel[t->config.exercise_channel].reps>=TR_MAX_REPS) {
        if(t->config.free_mode) stop_full_free(t); else tr_fail(t,"ledger_full");
    }
    return true;
}
bool tr_step(tr_engine_t *t) {
    if(!tr_is_acquiring(t)) return false;
    tr_block_t b;
    tr_read_t r=tr_source_read(&t->source,&t->config,&b);
    if(r==TR_SOURCE_END) { t->state=TR_EOF; return false; }
    if(r!=TR_SOURCE_OK) {
#ifdef ESP_PLATFORM
        if(t->config.source==TR_ADC && r==TR_SOURCE_NOT_READY) return false;
#endif
        tr_fail(t,"adc_not_implemented");
        return false;
    }
    return tr_process_block(t,&b);
}
