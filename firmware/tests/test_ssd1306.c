#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "../main/oled_ssd1306.c"
static uint8_t ram[1024];
static unsigned column,page,tx_count,data_count,removed,deleted,on;
static int fail_bus,fail_probe,fail_add,fail_tx=-1;
static TickType_t last_delay;
void test_log(const char *tag,const char *fmt,...){(void)tag;(void)fmt;}
const char *esp_err_to_name(esp_err_t err){(void)err;return "injected";}
int64_t esp_timer_get_time(void){return 1000000;}
void vTaskDelay(TickType_t n){assert(n>0);last_delay=n;}
bool emg_ui_read_snapshot(emg_ui_snapshot_t *s){(void)s;return false;}
void emg_ui_link_state(bool *w){*w=true;}
esp_err_t i2c_new_master_bus(const i2c_master_bus_config_t *c,i2c_master_bus_handle_t *out){
    assert(c->sda_io_num==21 && c->scl_io_num==22 && c->flags.enable_internal_pullup);
    if(fail_bus)return ESP_FAIL;
    *out=(void *)1;return ESP_OK;
}
esp_err_t i2c_master_probe(i2c_master_bus_handle_t b,unsigned addr,int ms){
    assert(b==(void *)1 && addr==0x3C && ms==100);return fail_probe?ESP_FAIL:ESP_OK;
}
esp_err_t i2c_master_bus_add_device(i2c_master_bus_handle_t b,const i2c_device_config_t *c,i2c_master_dev_handle_t *out){
    assert(b==(void *)1 && c->device_address==0x3C && c->scl_speed_hz==100000);
    if(fail_add)return ESP_FAIL;
    *out=(void *)2;return ESP_OK;
}
esp_err_t i2c_master_bus_rm_device(i2c_master_dev_handle_t d){assert(d==(void *)2);removed++;return ESP_OK;}
esp_err_t i2c_del_master_bus(i2c_master_bus_handle_t b){assert(b==(void *)1);deleted++;return ESP_OK;}
esp_err_t i2c_master_transmit(i2c_master_dev_handle_t d,const uint8_t *p,size_t n,int ms){
    assert(d==(void *)2 && n>=2 && n<=129 && ms==100);
    ++tx_count;if((int)tx_count==fail_tx)return ESP_FAIL;
    if(p[0]==0x40){
        ++data_count;
        for(size_t i=1;i<n;i++){assert(page<8 && column<128);ram[page*128+column]=p[i];if(++column==128){column=0;page=(page+1)%8;}}
        return ESP_OK;
    }
    assert(p[0]==0);
    for(size_t i=1;i<n;i++){
        uint8_t op=p[i];
        if(op==0x21){assert(i+2<n && p[i+2]==127);column=p[++i];i++;}
        else if(op==0x22){assert(i+2<n && p[i+2]==7);page=p[++i];i++;}
        else if(op==0x8D){assert(++i<n && p[i]==0x14);}
        else if(op==0x20){assert(++i<n && p[i]==0);}
        else if(op==0xD5 || op==0xA8 || op==0xD3 || op==0xDA || op==0x81 || op==0xD9 || op==0xDB){assert(++i<n);}
        else if(op==0xAF){for(unsigned j=0;j<1024;j++)assert(ram[j]==0);on++;}
        else assert(op==0xAE || op==0x40 || op==0xA1 || op==0xA0 || op==0xC8 || op==0xC0 || op==0xA4 || op==0xA6);
    }
    return ESP_OK;
}
static void reset(void){
    assert(!bus && !display);memset(ram,0xA5,sizeof(ram));
    column=page=tx_count=data_count=removed=deleted=on=0;
    fail_bus=fail_probe=fail_add=0;fail_tx=-1;
}
int main(void){
    reset();assert(init_display()==ESP_OK);assert(on==1 && data_count==8);
    uint8_t frame[1024];for(unsigned i=0;i<1024;i++)frame[i]=(uint8_t)(i*17);
    assert(refresh(frame)==ESP_OK && !memcmp(ram,frame,1024));
    memset(frame,0,1024);frame[0]=0x80;frame[1023]=1;
    assert(refresh(frame)==ESP_OK && !memcmp(ram,frame,1024));
    fail_tx=(int)tx_count+3;assert(refresh(frame)==ESP_FAIL);release_bus();
    assert(removed==1 && deleted==1);release_bus();assert(removed==1 && deleted==1);
    reset();fail_probe=1;assert(init_display()==ESP_FAIL && !bus && !display && deleted==1);
    reset();fail_add=1;assert(init_display()==ESP_FAIL && !bus && !display && deleted==1);
    reset();fail_bus=1;assert(init_display()==ESP_FAIL && !bus && !display && deleted==0);
    for(unsigned n=1;n<=11;n++){
        reset();fail_tx=(int)n;assert(init_display()==ESP_FAIL && !bus && !display);
        fail_tx=-1;assert(init_display()==ESP_OK);release_bus();
    }
    delay_ms(1);assert(last_delay==1);
    puts("SSD1306 addressing, full refresh, cleanup and retry checks passed.");return 0;
}
