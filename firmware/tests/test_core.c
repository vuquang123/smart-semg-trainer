#include "trainer.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static tr_engine_t t;
static char reply[TR_MESSAGE_BYTES];
static unsigned tests=0;
#define TEST(name) do{ tests++; printf("PASS %s\n",name); }while(0)
static void cmd(const char *s,bool expected) { assert(tr_command(&t,s,reply,sizeof(reply))==expected); }
static void blocks(unsigned n) { while(n-- && tr_is_acquiring(&t))tr_step(&t); }
static void constant(float v,unsigned count) {
    while(count-- && tr_is_acquiring(&t)) {
        tr_block_t b={.first_sample=t.samples,.frames=TR_BLOCK,.channels=1};
        for(unsigned j=0;j<TR_BLOCK;j++)b.sample[j][0]=v;
        assert(tr_process_block(&t,&b));
    }
}
static void envelope(void) {
    tr_init(&t); tr_config_t c=t.config;
    c.kind=TR_ENVELOPE; c.fs_hz=1024; c.highpass_hz=0; c.lowpass_hz=10;
    c.cal_ms=1000; c.settle_ms=100; c.rms_ms=100; c.target_reps=50;
    assert(tr_reset(&t,&c)); t.state=TR_CALIBRATING; t.run_after_calibration=true;
    constant(10,16); assert(t.state==TR_RUNNING);
}
int main(int argc,char **argv) {
    if(argc>1 && !strcmp(argv[1],"--reference")) {
        tr_init(&t); t.config.source=TR_REPLAY; assert(tr_reset(&t,&t.config));
        t.state=TR_CALIBRATING; t.run_after_calibration=true;
        puts("sample_end,rms_uv,on_uv,off_uv,reps");
        for(unsigned i=0;i<480;i++) {
            assert(tr_step(&t));
            if(t.channel[0].filled==t.window)printf("%llu,%.8f,%.8f,%.8f,%u\n",(unsigned long long)t.samples,t.channel[0].value,t.channel[0].on,t.channel[0].off,t.channel[0].reps);
        }
        return 0;
    }
    tr_init(&t);
    assert(fabsf(t.channel[0].filter[0].b0-0.222890183f)<2e-6f);
    assert(fabsf(t.channel[0].filter[0].a1+0.268517733f)<2e-6f);
    assert(fabsf(t.channel[0].filter[1].a1+1.91349411f)<2e-6f);
    TEST("runtime Butterworth matches v0.1 coefficients");

    cmd("{\"v\":1,\"id\":1,\"cmd\":\"configure\",\"source\":\"REPLAY\"}",true);
    cmd("{\"v\":1,\"id\":2,\"cmd\":\"start\"}",true);
    blocks(481); assert(t.state==TR_EOF && t.samples==30720 && t.channel[0].reps==1 && t.channel[0].valid_reps==1);
    TEST("GRABMyo one completed repetition, finite EOF");

    tr_init(&t); t.config.channels=2; t.config.exercise_channel=1;
    assert(tr_reset(&t,&t.config));
    cmd("{\"v\":1,\"id\":1,\"cmd\":\"start\"}",true);
    blocks(1200); assert(t.state==TR_COMPLETED && t.channel[1].valid_reps==5 && t.channel[0].reps==5);
    TEST("two independent channels and target completion");

    tr_init(&t); cmd("{\"v\":1,\"id\":1,\"cmd\":\"calibrate\"}",true);
    blocks(200); assert(t.state==TR_READY && t.samples==10240);
    uint64_t sample=t.samples;
    cmd("{\"v\":1,\"id\":2,\"cmd\":\"start\"}",true);
    assert(t.state==TR_RUNNING && t.samples==sample && t.session_id==1);
    TEST("separate calibration, READY then start without rewinding");
    blocks(100); cmd("{\"v\":1,\"id\":3,\"cmd\":\"stop\"}",true);
    sample=t.samples; blocks(100); assert(t.samples==sample);
    cmd("{\"v\":1,\"id\":4,\"cmd\":\"start\"}",true);
    assert(t.samples==0 && t.channel[0].reps==0 && t.state==TR_CALIBRATING);
    TEST("stop freezes, restart clears pending cycle and recalibrates");

    envelope(); constant(50,48); assert(t.channel[0].state==TR_ACTIVE && t.channel[0].reps==0);
    constant(10,32); assert(t.channel[0].reps==1 && t.channel[0].valid_reps==1);
    constant(10,32); assert(t.channel[0].reps==1);
    TEST("long hold counts only once on release");
    constant(50,1); constant(10,32); assert(t.channel[0].reps==1);
    TEST("brief threshold spike does not count");

    envelope(); t.config.hold_ms=2000; constant(50,10); constant(10,32);
    assert(t.channel[0].reps==1 && t.channel[0].valid_reps==0);
    TEST("short contraction excluded from exercise target");

    envelope();
    tr_block_t b={.first_sample=t.samples+1,.frames=TR_BLOCK,.channels=1};
    assert(!tr_process_block(&t,&b) && t.state==TR_ERROR && t.discontinuities==1 && !t.channel[0].reps);
    TEST("sample gap faults without phantom repetition");
    envelope(); b.first_sample=t.samples; b.sample[4][0]=NAN;
    sample=t.samples; assert(!tr_process_block(&t,&b) && t.state==TR_ERROR && t.samples==sample);
    TEST("nonfinite input rejected before consuming a block");

    tr_init(&t); float old=t.channel[0].filter[0].b0;
    cmd("{\"v\":1,\"id\":1,\"cmd\":\"configure\",\"fs_hz\":4000}",true);
    assert(t.window==400 && t.channel[0].filter[0].b0!=old);
    cmd("{\"v\":1,\"id\":2,\"cmd\":\"start\"}",true); blocks(1700);
    assert(t.state==TR_COMPLETED && t.channel[0].valid_reps==5);
    TEST("Fs change recalculates filters/windows and preserves behavior");

    tr_init(&t);
    cmd("{\"v\":1,\"id\":1,\"cmd\":\"configure\",\"fs_hz\":256}",false); assert(t.config.fs_hz==2048);
    cmd("{\"v\":1,\"id\":2,\"cmd\":\"configure\",\"source\":\"REPLAY\",\"channels\":2}",false); assert(t.config.source==TR_SIMULATION);
    TEST("invalid configuration rejected transactionally");
    cmd("{\"v\":1,\"id\":3,\"cmd\":\"configure\",\"source\":\"ADC\"}",true);
    cmd("{\"v\":1,\"id\":4,\"cmd\":\"start\"}",false); assert(strstr(reply,"adc_not_implemented") && t.state==TR_IDLE);
    cmd("{\"v\":1,\"id\":5,\"cmd\":\"configure\",\"source\":\"ADC\",\"channels\":2}",false); assert(strstr(reply,"adc_single_channel_only"));
    cmd("{\"v\":1,\"id\":6,\"cmd\":\"configure\",\"source\":\"ADC\",\"unit\":\"count\"}",true); assert(!strcmp(t.config.adc_unit,"ADC"));
    cmd("{\"v\":1,\"id\":7,\"cmd\":\"configure\",\"source\":\"ADC\",\"unit\":\"mV\"}",false); assert(strstr(reply,"invalid_unit"));
    cmd("{\"v\":1,\"id\":8,\"cmd\":\"configure\",\"source\":\"ADC\",\"unit\":\"uV\"}",true); assert(!strcmp(t.config.adc_unit,"uV"));
    uint16_t codes[TR_BLOCK]={0}; codes[0]=2148;
    t.config.input_bias[0]=2048; t.config.input_scale[0]=2; t.config.input_gain[0]=4;
    assert(tr_adc_block(&t.config,0,codes,TR_BLOCK,&b) && b.sample[0][0]==50);
    TEST("ADC interface converts bias/scale/gain, unit rules, single-channel check");

    tr_init(&t);
    tr_config_t adc=t.config; adc.source=TR_ADC; adc.fs_hz=1024;
    assert(tr_reset(&t,&adc)); t.state=TR_CALIBRATING;
    uint16_t baseline[TR_BLOCK], signal[TR_BLOCK];
    for(unsigned i=0;i<TR_BLOCK;i++) { baseline[i]=2048; signal[i]=(i&1)?1948:2148; }
    for(unsigned block=0;block<24;block++) {
        assert(tr_adc_block(&t.config,t.samples,baseline,TR_BLOCK,&b));
        assert(tr_process_block(&t,&b));
    }
    float expected_dc=2048.0f*TR_ADC_DEFAULT_SCALE_UV/TR_ADC_DEFAULT_GAIN;
    assert(t.channel[0].dc_calibrated && fabsf(t.channel[0].dc_offset-expected_dc)<0.05f);
    for(unsigned block=0;block<2;block++) {
        assert(tr_adc_block(&t.config,t.samples,signal,TR_BLOCK,&b));
        assert(tr_process_block(&t,&b));
    }
    assert(t.channel[0].value>0 && fabsf(t.channel[0].dc_offset-expected_dc)<0.05f);
    /* Raw ADC count mode keeps samples in ADC counts without scale/gain scaling. */
    tr_init(&t);
    adc=t.config; adc.source=TR_ADC; adc.fs_hz=1024; strcpy(adc.adc_unit,"ADC");
    assert(tr_reset(&t,&adc)); t.state=TR_CALIBRATING;
    for(unsigned i=0;i<TR_BLOCK;i++) { baseline[i]=1000; signal[i]=(i&1)?900:1100; }
    for(unsigned block=0;block<24;block++) {
        assert(tr_adc_block(&t.config,t.samples,baseline,TR_BLOCK,&b));
        assert(tr_process_block(&t,&b));
    }
    assert(t.channel[0].dc_calibrated && fabsf(t.channel[0].dc_offset-1000.0f)<0.01f);
    for(unsigned block=0;block<2;block++) {
        assert(tr_adc_block(&t.config,t.samples,signal,TR_BLOCK,&b));
        assert(tr_process_block(&t,&b));
    }
    assert(t.channel[0].value>0 && fabsf(t.channel[0].dc_offset-1000.0f)<0.01f);
    TEST("ADC DC offset is estimated in uV (INA333/MCP601) and ADC counts, fixed before RMS");

    tr_init(&t);
    const char *invalid[]={"", "[]", "{", "{\"v\":1,\"id\":1,\"cmd\":\"start\",}",
        "{\"v\":1,\"id\":1,\"cmd\":\"start\",\"id\":2}",
        "{\"v\":1,\"id\":-1,\"cmd\":\"start\"}",
        "{\"v\":2,\"id\":3,\"cmd\":\"start\"}",
        "{\"v\":1,\"id\":4,\"cmd\":\"start\",\"other\":0}",
        "{\"v\":1,\"id\":5,\"cmd\":\"configure\",\"rms_ms\":1e999}",
        "{\"v\":01,\"id\":6,\"cmd\":\"start\"}",
        "{\"v\":1,\"id\":7,\"cmd\":\"configure\",\"fs_hz\":{}}"};
    for(unsigned i=0;i<sizeof(invalid)/sizeof(invalid[0]);i++)cmd(invalid[i],false);
    assert(t.state==TR_IDLE); TEST("malformed/version/unknown/duplicate field commands rejected");
    const char *start="{\"v\":1,\"id\":100,\"cmd\":\"start\"}";
    cmd(start,true); blocks(10); sample=t.samples;
    cmd(start,true); assert(t.samples==sample && t.session_id==1);
    cmd("{\"v\":1,\"id\":100,\"cmd\":\"stop\"}",false); assert(t.state==TR_CALIBRATING);
    cmd("{\"v\":1,\"id\":101,\"cmd\":\"configure\",\"channels\":2}",false);
    TEST("latest-command retry is idempotent; config locked during acquisition");
    char tiny[8]; assert(!tr_telemetry(&t,tiny,sizeof(tiny)) && !tiny[0]);
    assert(tr_telemetry(&t,reply,sizeof(reply))>0 && strstr(reply,"\"unit\":\"uV\""));
    TEST("bounded protocol serialization");
    tr_init(&t); tr_config_t c=t.config; c.kind=TR_ENVELOPE; c.highpass_hz=0; c.lowpass_hz=10;
    c.fs_hz=256; c.on_ms=1; c.off_ms=1;
    assert(tr_reset(&t,&c) && t.on_samples==1 && t.off_samples==1);
    TEST("sub-sample confirmation rounds up, never becomes zero");
    tr_init(&t);
    const char *bad="{\"v\":1,\"id\":200,\"cmd\":\"configure\",\"channels\":9}";
    cmd(bad,false); cmd(bad,false);
    uint32_t seed=17;
    const char alphabet[]="{}[],:\"\\01239.eE-+null truefalseabXYZ \t\n";
    for(unsigned i=0;i<12000;i++) {
        char fuzz[300]; seed=seed*1664525U+1013904223U; unsigned n=seed%299;
        for(unsigned j=0;j<n;j++) { seed=seed*1664525U+1013904223U; fuzz[j]=alphabet[seed%(sizeof(alphabet)-1)]; }
        fuzz[n]=0;
        tr_command(&t,fuzz,reply,sizeof(reply));
        assert(t.state==TR_IDLE);
    }
    TEST("failed-command retry and 12000 hostile parser inputs");
    printf("ALL %u GROUPS PASSED\n",tests);
    return 0;
}
