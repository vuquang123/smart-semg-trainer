/* Pure 128x64 framebuffer renderer; no I2C, delays or heap allocation. */
#include "oled_view.h"
#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

typedef struct {char key;uint8_t c[5];} glyph_t;
static const glyph_t font[]={
    {' ',{0,0,0,0,0}}, {'!',{0,0,0x5f,0,0}},
    {'%',{0x23,0x13,8,0x64,0x62}}, {'-',{8,8,8,8,8}},
    {'.',{0,0x60,0x60,0,0}}, {'/',{0x20,0x10,8,4,2}},
    {':',{0,0x36,0x36,0,0}}, {'=',{0x14,0x14,0x14,0x14,0x14}},
    {'_',{0x40,0x40,0x40,0x40,0x40}}, {'?',{2,1,0x51,9,6}},
    {'0',{0x3e,0x51,0x49,0x45,0x3e}}, {'1',{0,0x42,0x7f,0x40,0}},
    {'2',{0x42,0x61,0x51,0x49,0x46}}, {'3',{0x21,0x41,0x45,0x4b,0x31}},
    {'4',{0x18,0x14,0x12,0x7f,0x10}}, {'5',{0x27,0x45,0x45,0x45,0x39}},
    {'6',{0x3c,0x4a,0x49,0x49,0x30}}, {'7',{1,0x71,9,5,3}},
    {'8',{0x36,0x49,0x49,0x49,0x36}}, {'9',{6,0x49,0x49,0x29,0x1e}},
    {'A',{0x7e,0x11,0x11,0x11,0x7e}}, {'B',{0x7f,0x49,0x49,0x49,0x36}},
    {'C',{0x3e,0x41,0x41,0x41,0x22}}, {'D',{0x7f,0x41,0x41,0x22,0x1c}},
    {'E',{0x7f,0x49,0x49,0x49,0x41}}, {'F',{0x7f,9,9,9,1}},
    {'G',{0x3e,0x41,0x49,0x49,0x7a}}, {'H',{0x7f,8,8,8,0x7f}},
    {'I',{0,0x41,0x7f,0x41,0}}, {'J',{0x20,0x40,0x41,0x3f,1}},
    {'K',{0x7f,8,0x14,0x22,0x41}}, {'L',{0x7f,0x40,0x40,0x40,0x40}},
    {'M',{0x7f,2,0x0c,2,0x7f}}, {'N',{0x7f,4,8,0x10,0x7f}},
    {'O',{0x3e,0x41,0x41,0x41,0x3e}}, {'P',{0x7f,9,9,9,6}},
    {'Q',{0x3e,0x41,0x51,0x21,0x5e}}, {'R',{0x7f,9,0x19,0x29,0x46}},
    {'S',{0x46,0x49,0x49,0x49,0x31}}, {'T',{1,1,0x7f,1,1}},
    {'U',{0x3f,0x40,0x40,0x40,0x3f}}, {'V',{0x1f,0x20,0x40,0x20,0x1f}},
    {'W',{0x3f,0x40,0x38,0x40,0x3f}}, {'X',{0x63,0x14,8,0x14,0x63}},
    {'Y',{7,8,0x70,8,7}}, {'Z',{0x61,0x51,0x49,0x45,0x43}}
};
static void pixel(uint8_t *f,int x,int y) {
    if(x>=0 && x<128 && y>=0 && y<64)f[(unsigned)y/8*128+(unsigned)x]|=(uint8_t)(1U<<(y&7));
}
static void box(uint8_t *f,int x,int y,int w,int h,bool fill) {
    for(int j=0;j<h;j++)for(int i=0;i<w;i++)
        if(fill || !i || !j || i==w-1 || j==h-1)pixel(f,x+i,y+j);
}
static void text(uint8_t *f,int x,int y,const char *s,int scale) {
    for(unsigned n=0;s[n] && x+(int)n*6*scale<128;n++) {
        char key=(char)toupper((unsigned char)s[n]);
        const uint8_t *g=NULL;
        for(unsigned k=0;k<sizeof(font)/sizeof(font[0]);k++)if(font[k].key==key){g=font[k].c;break;}
        if(!g)continue;
        for(unsigned i=0;i<5;i++)for(unsigned j=0;j<7;j++)if(g[i]&(1U<<j))
            box(f,x+((int)n*6+(int)i)*scale,y+(int)j*scale,scale,scale,true);
    }
}
static void centered(uint8_t *f,int x,int w,int y,const char *s,int scale) {
    int n=(int)strlen(s)*6*scale-scale;
    text(f,x+(w-n)/2,y,s,scale);
}
static void connections(uint8_t *f,bool wifi) {
    /* Wi-Fi indicator at top right. A cross means disconnected. */
    box(f,118,1,7,1,true);box(f,117,2,1,1,true);box(f,125,2,1,1,true);
    box(f,119,4,5,1,true);pixel(f,121,7);
    if(!wifi)for(int i=0;i<7;i++)pixel(f,118+i,7-i);
}
static void face(uint8_t *f,tr_session_t state,tr_muscle_t muscle,uint32_t now,uint32_t age) {
    int x=3,y=17;
    box(f,x+2,y+2,30,24,false);box(f,x+1,y+8,2,11,true);box(f,x+32,y+8,2,11,true);
    box(f,x+16,y-2,2,4,true);box(f,x+14,y-3,6,2,true);
    bool celebrate=state==TR_COMPLETED && age<2000;
    bool active=state==TR_RUNNING && muscle==TR_ACTIVE;
    bool blink=state==TR_CALIBRATING || now%4000U<250U;
    if(state==TR_ERROR) {
        for(int eye=0;eye<2;eye++)for(int i=0;i<5;i++) {
            pixel(f,x+7+eye*14+i,y+9+i);pixel(f,x+7+eye*14+i,y+13-i);
        }
        box(f,x+12,y+20,10,2,true);
    } else {
        for(int eye=0;eye<2;eye++)box(f,x+7+eye*14,y+10,5,blink?1:5,true);
        box(f,x+11,y+19,2,2,true);box(f,x+21,y+19,2,2,true);box(f,x+13,y+21,8,2,true);
    }
    if(active || celebrate) {
        int dy=(int)(now/250U%2U)*2;
        box(f,0,y+3+dy,3,9,true);box(f,38,y+3+dy,3,9,true);
    }
    if(celebrate) {pixel(f,0,13);pixel(f,39,13);box(f,37,44,3,1,true);}
}
static void clock_text(double seconds,char out[16]) {
    unsigned total=(unsigned)fmin(59999.0,fmax(0,seconds));
    snprintf(out,16,"%02u:%02u",total/60,total%60);
}
static void invert(uint8_t *f,int x,int y) {
    if(x>=0 && x<128 && y>=0 && y<64)f[(unsigned)y/8*128+(unsigned)x]^=(uint8_t)(1U<<(y&7));
}
/* Free counting: count only (no "/target"), live signal bar instead of a
 * target progress bar, and no hold-time coaching. Same phase/clock as web. */
static void render_free(const emg_ui_snapshot_t *s,unsigned k,bool wifi,
        uint32_t now,uint32_t state_age,uint8_t *frame) {
    const emg_ui_channel_t *c=&s->ch[k];
    char header[32],big[24],footer[40],time[16];
    clock_text(s->elapsed_s,time);
    if(s->oled_page==1) {
        text(frame,0,0,"KET QUA DO TU DO",1);connections(frame,wifi);
        snprintf(footer,sizeof(footer),"SO LAN CO: %lu",(unsigned long)c->reps);text(frame,0,13,footer,1);
        snprintf(footer,sizeof(footer),"THOI GIAN: %s",time);text(frame,0,24,footer,1);
        snprintf(footer,sizeof(footer),"TB CO: %.1fS",(double)s->avg_hold_ms/1000);text(frame,0,35,footer,1);
        snprintf(footer,sizeof(footer),"TB NGHI: %.1fS",(double)s->avg_rest_ms/1000);text(frame,0,46,footer,1);
        if(s->fault[0])text(frame,0,57,"LOI - XEM TREN WEB",1);
        else {snprintf(footer,sizeof(footer),"TAN SUAT: %.1f/PHUT",(double)s->reps_per_min);text(frame,0,57,footer,1);}
        return;
    }
    const char *state="DO TU DO";
    switch(s->state) {
    case TR_IDLE: state="CHO DO";break;
    case TR_CALIBRATING: state="HIEU CHUAN";break;
    case TR_READY: state="SAN SANG";break;
    case TR_RUNNING: state=s->paused?"TAM DUNG":"DO TU DO";break;
    case TR_STOPPED: state="DA DUNG";break;
    case TR_EOF: state="HET DU LIEU";break;
    case TR_ERROR: state="LOI THIET BI";break;
    default: break;
    }
    snprintf(header,sizeof(header),"CH%u %s",k+1,state);
    text(frame,0,0,header,1);connections(frame,wifi);box(frame,0,10,128,1,true);
    face(frame,s->state,c->muscle,now,state_age);
    if(s->state==TR_CALIBRATING)snprintf(big,sizeof(big),"%.0f%%",(double)s->calibration_progress);
    else snprintf(big,sizeof(big),"%lu",(unsigned long)c->reps);
    int scale=strlen(big)<=4?3:2;
    centered(frame,44,84,17,big,scale);
    centered(frame,44,84,40,s->state==TR_CALIBRATING?"THA LONG":"LAN CO",1);
    bool live=s->state==TR_RUNNING && !s->paused && s->signal_ready;
    switch(s->state) {
    case TR_IDLE:snprintf(footer,sizeof(footer),"NHAN BAT DAU");break;
    case TR_CALIBRATING:snprintf(footer,sizeof(footer),"GIU TAY YEN");break;
    case TR_READY:snprintf(footer,sizeof(footer),"SAN SANG - BAT DAU");break;
    case TR_RUNNING:
        if(s->paused)snprintf(footer,sizeof(footer),"TIEP TUC TREN WEB");
        else if(!s->signal_ready)snprintf(footer,sizeof(footer),"DANG CHO DU LIEU");
        else if(s->phase==TR_PHASE_CONTRACT)snprintf(footer,sizeof(footer),"DANG CO %.1fS",(double)c->hold_now_ms/1000);
        else snprintf(footer,sizeof(footer),"THA LONG  %s",time);
        break;
    case TR_STOPPED:
        if(c->reps>=TR_MAX_REPS)snprintf(footer,sizeof(footer),"DU 128 LAN %s",time);
        else snprintf(footer,sizeof(footer),"DA DUNG   %s",time);
        break;
    case TR_EOF:snprintf(footer,sizeof(footer),"KET THUC  %s",time);break;
    default:snprintf(footer,sizeof(footer),"LOI - XEM TREN WEB");break;
    }
    text(frame,0,49,footer,1);
    box(frame,2,59,1,4,true);box(frame,125,59,1,4,true);
    if(s->state==TR_CALIBRATING) {
        box(frame,2,59,(int)lroundf(fminf(100,fmaxf(0,s->calibration_progress))*1.24f),4,true);
    } else if(live && c->on>0) {
        /* Live level: the contraction threshold sits at the middle of the bar. */
        float level=c->value/c->on;
        int width=(int)lroundf(fminf(124,fmaxf(0,level*62)));
        box(frame,2,59,width,4,true);
        for(int y=57;y<64;y++)invert(frame,64,y);
        int off=(int)lroundf(fminf(124,fmaxf(0,c->off/c->on*62)));
        for(int y=61;y<64;y++)invert(frame,2+off,y);
    }
}
void emg_oled_render(const emg_ui_snapshot_t *s,bool wifi,
        uint32_t now,uint32_t state_age,uint8_t frame[EMG_OLED_FRAME_BYTES]) {
    memset(frame,0,EMG_OLED_FRAME_BYTES);
    unsigned k=s->config.exercise_channel<s->config.channels?s->config.exercise_channel:0;
    if(s->config.free_mode) { render_free(s,k,wifi,now,state_age,frame); return; }
    const emg_ui_channel_t *c=&s->ch[k];
    char header[32],big[24],footer[40],time[16];
    clock_text(s->elapsed_s,time);
    if(s->oled_page==1) {
        snprintf(header,sizeof(header),"KET QUA CH%u",k+1);text(frame,0,0,header,1);connections(frame,wifi);
        snprintf(footer,sizeof(footer),"CH1: %lu LUOT",(unsigned long)s->ch[0].valid_reps);text(frame,0,13,footer,1);
        if(s->config.channels==2)snprintf(footer,sizeof(footer),"CH2: %lu LUOT",(unsigned long)s->ch[1].valid_reps);
        else snprintf(footer,sizeof(footer),"CH2: CHUA BAT");
        text(frame,0,24,footer,1);
        snprintf(footer,sizeof(footer),"GIU CUOI: %.1fS",(double)c->hold_ms/1000);text(frame,0,35,footer,1);
        snprintf(footer,sizeof(footer),"THOI GIAN %s",time);text(frame,0,46,footer,1);
        if(s->fault[0])text(frame,0,57,"LOI - XEM TREN WEB",1);
        return;
    }
    const char *state="SAN SANG",*subtitle="LUOT DAT";
    switch(s->state) {
    case TR_IDLE: state="CHO TAP";break;
    case TR_CALIBRATING:state="HIEU CHUAN";subtitle="THA LONG";break;
    case TR_RUNNING:state=s->paused?"TAM DUNG":"DANG TAP";break;
    case TR_STOPPED:state="DA DUNG";break;
    case TR_COMPLETED:state="HOAN THANH";break;
    case TR_EOF:state="HET DU LIEU";break;
    case TR_ERROR:state="LOI THIET BI";subtitle="DA DUNG";break;
    default:break;
    }
    snprintf(header,sizeof(header),"CH%u %s",k+1,state);
    text(frame,0,0,header,1);connections(frame,wifi);box(frame,0,10,128,1,true);
    face(frame,s->state,c->muscle,now,state_age);
    if(s->state==TR_CALIBRATING)snprintf(big,sizeof(big),"%.0f%%",(double)s->calibration_progress);
    else snprintf(big,sizeof(big),"%lu/%lu",(unsigned long)c->valid_reps,(unsigned long)s->config.target_reps);
    int scale=strlen(big)<=4?3:strlen(big)<=7?2:1;
    centered(frame,44,84,17,big,scale);centered(frame,44,84,40,subtitle,1);
    switch(s->state) {
    case TR_IDLE:snprintf(footer,sizeof(footer),"NHAN BAT DAU");break;
    case TR_CALIBRATING:snprintf(footer,sizeof(footer),"GIU TAY YEN");break;
    case TR_READY:snprintf(footer,sizeof(footer),"SAN SANG - BAT DAU");break;
    case TR_RUNNING:
        if(s->paused)snprintf(footer,sizeof(footer),"TIEP TUC TREN WEB");
        else if(!s->signal_ready)snprintf(footer,sizeof(footer),"DANG CHO DU LIEU");
        else if(s->config.zone_enabled && !s->config.free_mode && c->muscle==TR_ACTIVE) {
            float pct=tr_activation(&s->config,c->value);
            if(c->longest_in_zone_ms>=s->config.hold_ms)snprintf(footer,sizeof(footer),"DU ROI - THA LONG");
            else snprintf(footer,sizeof(footer),"%s %.0f%%",pct<s->config.zone_low_pct?"TANG CO":pct>s->config.zone_high_pct?"GIAM CO":"GIU MUC NAY",(double)pct);
        }
        else if(c->muscle==TR_ACTIVE && c->hold_now_ms>=s->config.hold_ms)
            snprintf(footer,sizeof(footer),"DU ROI - THA LONG");
        else if(c->muscle==TR_ACTIVE)snprintf(footer,sizeof(footer),"GIU %.1f/%.1fS",(double)c->hold_now_ms/1000,s->config.hold_ms/1000.0);
        else if(c->reps && c->hold_ms<s->config.hold_ms)snprintf(footer,sizeof(footer),"GIU CHUA DU - THU LAI");
        else snprintf(footer,sizeof(footer),"THA LONG  %s",time);
        break;
    case TR_STOPPED:snprintf(footer,sizeof(footer),"DA DUNG   %s",time);break;
    case TR_COMPLETED:snprintf(footer,sizeof(footer),"%s %s",state_age<2000?"TOT LAM!":"KET QUA",time);break;
    case TR_EOF:snprintf(footer,sizeof(footer),"KET THUC  %s",time);break;
    default:snprintf(footer,sizeof(footer),"LOI - XEM TREN WEB");break;
    }
    text(frame,0,49,footer,1);
    float p=s->state==TR_CALIBRATING?s->calibration_progress:s->progress;
    unsigned width=(unsigned)lroundf(fminf(100,fmaxf(0,p))*1.24f);
    /* Filled progress only; small endpoint marks also make 0% visible. */
    box(frame,2,59,1,4,true);box(frame,125,59,1,4,true);
    box(frame,2,59,(int)width,4,true);
}
