#include "trainer.h"
#include "emg_adc.h"
#include "replay_data.h"
#include <math.h>
#include <string.h>
#define PI 3.14159265358979323846

void tr_source_reset(tr_source_state_t *s) {
    memset(s,0,sizeof(*s)); s->rng[0]=20261016; s->rng[1]=41029;
}
static float noise(uint32_t *r) {
    *r=*r*1664525U+1013904223U;
    return ((float)(*r>>8)/16777216.0f*2-1)*1.7320508f;
}
tr_read_t tr_source_read(tr_source_state_t *s, const tr_config_t *c, tr_block_t *b) {
    memset(b,0,sizeof(*b));
    b->first_sample=s->cursor; b->channels=c->channels;
    if(c->source==TR_ADC) {
#ifdef ESP_PLATFORM
        tr_read_t r=emg_adc_read_block(c,s->cursor,b);
        if(r==TR_SOURCE_OK) s->cursor+=b->frames;
        return r;
#else
        return TR_SOURCE_NOT_READY;
#endif
    }
    if(c->source==TR_REPLAY && s->cursor>=REPLAY_TOTAL_SAMPLES) return TR_SOURCE_END;
    b->frames=TR_BLOCK;
    if(c->source==TR_REPLAY && REPLAY_TOTAL_SAMPLES-s->cursor<TR_BLOCK)
        b->frames=(uint32_t)(REPLAY_TOTAL_SAMPLES-s->cursor);
    for(uint32_t i=0;i<b->frames;i++,s->cursor++) {
        if(c->source==TR_REPLAY) { b->sample[i][0]=replay_sample((uint32_t)s->cursor); continue; }
        double sec=(double)s->cursor/c->fs_hz;
        double baseline=c->cal_ms/1000.0+0.5;
        for(uint32_t k=0;k<c->channels;k++) {
            double phase=sec-baseline-k*0.30;
            bool active=phase>=0 && fmod(phase,3.0)<1.5;
            float level=active?(k?115.0f:150.0f):(k?11.0f:14.0f);
            float n=noise(&s->rng[k]);
            if(c->kind==TR_ENVELOPE) b->sample[i][k]=fmaxf(0,level+level*0.12f*n);
            else b->sample[i][k]=level*(0.75f*n+0.8f*(float)sin(2*PI*83*sec+k)+
                                      0.6f*(float)sin(2*PI*137*sec+k))+
                                      5*(float)sin(2*PI*50*sec);
        }
    }
    return TR_SOURCE_OK;
}
bool tr_adc_block(const tr_config_t *c, uint64_t first, const uint16_t *codes,
                  uint32_t frames, tr_block_t *b) {
    if(!codes || !b || c->source!=TR_ADC || !frames || frames>TR_BLOCK || c->channels<1 || c->channels>2) return false;
    memset(b,0,sizeof(*b)); b->first_sample=first; b->frames=frames; b->channels=c->channels;
    bool raw_counts=!strcmp(c->adc_unit,"ADC");
    for(unsigned i=0;i<frames;i++) for(unsigned k=0;k<c->channels;k++) {
        uint16_t code=codes[i*c->channels+k];
        b->raw_adc_codes[i][k]=code;
        float centered=(float)code-c->input_bias[k];
        b->sample[i][k]=raw_counts?centered:centered*c->input_scale[k]/c->input_gain[k];
    }
    b->has_raw_adc_codes=true;
    return true;
}
