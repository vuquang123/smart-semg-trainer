#include "emg_ui.h"
#include "emg_ui_config.h"
#include "oled_view.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static tr_engine_t t;
static unsigned page;
static uint32_t id=0x80000000U;
static char ack[2048];
static emg_ui_result_t cmd(const char *name,const char *v) {
    return emg_ui_execute(&t,name,v,++id,&page,ack,sizeof(ack));
}
static void frame(const emg_ui_snapshot_t *s,unsigned index,unsigned age) {
    struct {unsigned char before[16],fb[1024],after[16];} guard;
    memset(&guard,0xA5,sizeof(guard));
    emg_oled_render(s,true,1000+index*250,age,guard.fb);
    for(unsigned i=0;i<16;i++)assert(guard.before[i]==0xA5 && guard.after[i]==0xA5);
    unsigned pixels=0;for(unsigned i=0;i<1024;i++)pixels+=guard.fb[i]!=0;assert(pixels>10);
    char path[64];snprintf(path,sizeof(path),"validation/frame_%02u.pbm",index);
    FILE *f=fopen(path,"wb");assert(f);fprintf(f,"P1\n128 64\n");
    for(unsigned y=0;y<64;y++){for(unsigned x=0;x<128;x++)fprintf(f,"%u ",(guard.fb[y/8*128+x]>>(y%8))&1U);fputc('\n',f);}fclose(f);
}
static double web_number(const char *json,const char *key) {
    char name[48];snprintf(name,sizeof(name),"\"%s\":",key);
    const char *p=strstr(json,name);assert(p);return strtod(p+strlen(name),NULL);
}
static bool web_phase_is(const char *json,tr_phase_t phase) {
    char want[48];snprintf(want,sizeof(want),"\"phase\":\"%s\"",tr_phase_name(phase));
    return strstr(json,want)!=NULL;
}
/* Free counting: OLED must follow the web snapshot (phase + clock), no
 * target progress, no hold-time coaching, and a full ledger is a clean stop. */
static void free_mode_checks(void) {
    static char web[TR_WEB_BYTES];
    tr_init(&t);
    tr_config_t c=t.config;c.free_mode=true;c.target_reps=3;c.hold_ms=5000;assert(tr_reset(&t,&c));
    emg_ui_snapshot_t s,train;
    t.state=TR_CALIBRATING;t.run_after_calibration=true;
    bool contract=false,relax=false,frames=false;
    for(unsigned i=0;i<6000 && tr_is_acquiring(&t);i++) {
        assert(tr_step(&t));emg_ui_capture(&t,&s);
        assert(tr_web_snapshot(&t,i,web,sizeof(web)));
        assert(web_phase_is(web,s.phase));
        assert(fabs(web_number(web,"duration_ms")/1000.0-s.elapsed_s)<1e-6);
        assert(s.progress==0);
        assert(t.state!=TR_COMPLETED); /* no target in free mode */
        if(t.state==TR_RUNNING && s.phase==TR_PHASE_CONTRACT) contract=true;
        if(t.state==TR_RUNNING && s.phase==TR_PHASE_RELAX && t.channel[0].reps>3) relax=true;
        if(!frames && t.channel[0].reps>3 && s.phase==TR_PHASE_CONTRACT) {
            frame(&s,12,0);
            train=s;train.config.free_mode=false;
            uint8_t a[1024],b[1024];
            emg_oled_render(&s,true,1000,0,a);emg_oled_render(&train,true,1000,0,b);
            assert(memcmp(a,b,sizeof(a))); /* separate free layout */
            frames=true;
        }
    }
    assert(contract && relax && frames);
    /* Every contraction counts, beyond target_reps, until a clean stop. */
    assert(t.channel[0].reps==t.channel[0].valid_reps && t.channel[0].reps>c.target_reps);
    /* Force the ledger limit: free mode stops without a fault. */
    if(t.state==TR_RUNNING) {
        t.channel[0].reps=t.channel[0].valid_reps=TR_MAX_REPS;
        assert(tr_step(&t));
    }
    assert(t.state==TR_STOPPED && !t.fault[0]);
    emg_ui_capture(&t,&s);s.oled_page=0;frame(&s,13,0);s.oled_page=1;frame(&s,14,0);
    assert(s.reps_per_min>=0 && s.avg_hold_ms>0);
}
int main(void) {
    tr_init(&t);
    assert(cmd("ExerciseChannel","2")==EMG_UI_REJECTED);
    assert(t.config.exercise_channel==0 && strstr(ack,"invalid_exercise_channel"));
    assert(cmd("SourceMode","1")==EMG_UI_REJECTED && strstr(ack,"technical_config_locked"));
    assert(cmd("Start","0")==EMG_UI_IGNORED && !ack[0]);
    tr_config_t c=t.config;c.channels=2;c.exercise_channel=1;c.target_reps=3;assert(tr_reset(&t,&c));
    emg_ui_snapshot_t s;emg_ui_capture(&t,&s);frame(&s,0,0);
    assert(cmd("Start","1")==EMG_UI_OK && t.state==TR_CALIBRATING);
    assert(cmd("Reset","1")==EMG_UI_REJECTED && strstr(ack,"busy_stop_first"));
    assert(cmd("TargetReps","8")==EMG_UI_REJECTED);assert(t.config.target_reps==3);
    assert(cmd("TargetReps","3")==EMG_UI_IGNORED); /* echo cannot reset */
    bool active=false,enough=false,rest=false,cal=false;
    for(unsigned i=0;i<3000 && tr_is_acquiring(&t);i++) {
        assert(tr_step(&t));emg_ui_capture(&t,&s);
        assert(s.ch[0].valid_reps==t.channel[0].valid_reps);
        assert(s.ch[1].valid_reps==t.channel[1].valid_reps);
        assert(fabsf(s.progress-fminf(100,100.0f*t.channel[1].valid_reps/3))<0.01f);
        const tr_channel_t *ch=&t.channel[1];
        if(t.state==TR_CALIBRATING && !cal && s.calibration_progress>40) {frame(&s,1,0);cal=true;}
        if(t.state==TR_RUNNING && ch->state==TR_ACTIVE) {
            float expected=(ch->active_frames-ch->below)*1000.0f/t.config.fs_hz;
            assert(fabsf(s.ch[1].hold_now_ms-expected)<0.001f);
            if(!active){frame(&s,2,0);active=true;}
            if(s.ch[1].hold_now_ms>=t.config.hold_ms && !enough){frame(&s,3,0);enough=true;}
        }
        if(t.state==TR_RUNNING && ch->valid_reps>0 && ch->state==TR_REST && !rest){frame(&s,4,0);rest=true;}
    }
    assert(active && enough && rest && cal && t.state==TR_COMPLETED);
    assert(t.channel[1].valid_reps==3);emg_ui_capture(&t,&s);assert(s.progress==100 && s.ch[1].hold_now_ms==0);
    frame(&s,5,0);frame(&s,6,5000);
    uint32_t reps=t.channel[1].valid_reps;float hold=t.channel[1].last_hold_ms;
    assert(cmd("Stop","1")==EMG_UI_OK);emg_ui_capture(&t,&s);
    assert(s.ch[1].valid_reps==reps && s.ch[1].hold_ms==hold && s.ch[1].hold_now_ms==0);
    frame(&s,7,0);
    assert(cmd("Reset","1")==EMG_UI_OK);emg_ui_capture(&t,&s);
    assert(t.state==TR_IDLE && s.progress==0 && s.ch[1].reps==0 && s.ch[1].hold_ms==0);
    assert(cmd("Calibrate","1")==EMG_UI_OK);
    while(t.state==TR_CALIBRATING)assert(tr_step(&t));
    assert(t.state==TR_READY);emg_ui_capture(&t,&s);frame(&s,8,0);
    assert(cmd("Start","1")==EMG_UI_OK && t.state==TR_RUNNING);
    assert(cmd("Stop","1")==EMG_UI_OK);
    assert(cmd("ExerciseChannel","1")==EMG_UI_OK && t.config.exercise_channel==0);
    /* Selected result must follow CH1/CH2 even when values differ. */
    t.channel[0].valid_reps=1;t.channel[1].valid_reps=2;
    emg_ui_capture(&t,&s);assert(fabsf(s.progress-100.0f/3)<0.01f);
    t.config.exercise_channel=1;emg_ui_capture(&t,&s);
    tr_fail(&t,"scheduler_overrun");emg_ui_capture(&t,&s);frame(&s,9,0);
    s.state=TR_COMPLETED;s.fault[0]=0;s.signal_ready=true;s.config.target_reps=1000;s.ch[1].valid_reps=1000;s.progress=100;
    frame(&s,10,0);s.oled_page=1;frame(&s,11,0);
    uint8_t a[1024],b[1024];
    emg_oled_render(&s,true,1000,0,a);emg_oled_render(&s,false,1000,0,b);
    assert(memcmp(a,b,sizeof(a))); /* Wi-Fi icon changes; no session mutation */
    free_mode_checks();
    puts("Web/OLED sync, hold timing, commands, channel selection and frame checks passed.");
    return 0;
}
