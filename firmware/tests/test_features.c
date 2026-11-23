#include "trainer.h"
#include "emg_adc.h"
#include "ws_aead.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
static tr_engine_t t;
static char ack[TR_MESSAGE_BYTES],wire[TR_WEB_BYTES];
static void aead_checks(const char *snapshot_json) {
    uint8_t key[TINYJAMBU_128_KEY_SIZE], wrong_key[TINYJAMBU_128_KEY_SIZE], nonce[TINYJAMBU_NONCE_SIZE];
    assert(emg_ws_aead_parse_key(EMG_WS_AEAD_DEFAULT_KEY_HEX, key));
    assert(emg_ws_aead_parse_key("semg-custom-passphrase", wrong_key));
    assert(memcmp(key, wrong_key, sizeof(key)) != 0);

    /* Official NIST LWC TinyJAMBU-128 KAT Count = 1 (empty PT, empty AD) -> ED7B37CC6E9BDC7B */
    static const uint8_t kat_nonce[12] = {0,1,2,3,4,5,6,7,8,9,10,11};
    static const uint8_t kat_expected[8] = {0xED,0x7B,0x37,0xCC,0x6E,0x9B,0xDC,0x7B};
    uint8_t kat_ct[8] = {0}; size_t kat_clen = 0;
    tinyjambu_128_aead_encrypt(kat_ct, &kat_clen, NULL, 0, NULL, 0, kat_nonce, key);
    assert(kat_clen == 8 && memcmp(kat_ct, kat_expected, 8) == 0);

    /* Encrypt and authenticate full WebSocket snapshot */
    size_t enc_len = 0;
    char *enc = emg_ws_aead_encrypt_alloc(snapshot_json, strlen(snapshot_json),
                                          EMG_WS_AEAD_AD_S2C, 0x53454D47U, 1, key, &enc_len);
    assert(enc && enc_len > strlen(snapshot_json));
    assert(strstr(enc, "\"type\":\"aead\"") && strstr(enc, "\"alg\":\"tinyjambu-128\""));

    static char decrypted[TR_WEB_BYTES];
    assert(emg_ws_aead_decrypt(enc, enc_len, EMG_WS_AEAD_AD_S2C, key, decrypted, sizeof(decrypted)));
    assert(strcmp(decrypted, snapshot_json) == 0);

    /* Reject wrong direction AD (reflection attack protection) */
    assert(!emg_ws_aead_decrypt(enc, enc_len, EMG_WS_AEAD_AD_C2S, key, decrypted, sizeof(decrypted)));

    /* Reject wrong key */
    assert(!emg_ws_aead_decrypt(enc, enc_len, EMG_WS_AEAD_AD_S2C, wrong_key, decrypted, sizeof(decrypted)));

    /* Reject tampered ciphertext/tag */
    enc[enc_len - 3] = (enc[enc_len - 3] == 'a') ? 'b' : 'a';
    assert(!emg_ws_aead_decrypt(enc, enc_len, EMG_WS_AEAD_AD_S2C, key, decrypted, sizeof(decrypted)));
    free(enc);

    /* Verify nonce uniqueness */
    uint8_t n2[TINYJAMBU_NONCE_SIZE];
    emg_ws_aead_make_nonce(0x12345678U, 1, nonce);
    emg_ws_aead_make_nonce(0x12345678U, 2, n2);
    assert(memcmp(nonce, n2, sizeof(nonce)) != 0);
}
static void setup(bool zone) {
    tr_init(&t);tr_config_t c=t.config;c.fs_hz=1024;c.kind=TR_ENVELOPE;c.highpass_hz=0;c.lowpass_hz=10;
    c.rms_ms=62.5f;c.on_ms=c.off_ms=125;c.target_reps=100;c.reference_rms=100;c.zone_enabled=zone;c.hold_ms=500;
    assert(tr_reset(&t,&c));strcpy(t.boot_id,"11111111-1111-4111-8111-111111111111");
    t.state=TR_RUNNING;t.channel[0].filter_count=0;t.channel[0].state=TR_REST;t.channel[0].on=20;t.channel[0].off=15;
}
static void samples(float value,unsigned blocks) {
    while(blocks--){tr_block_t b={.frames=TR_BLOCK,.channels=1,.first_sample=t.samples};for(unsigned i=0;i<TR_BLOCK;i++)b.sample[i][0]=value;assert(tr_process_block(&t,&b));}
}
static void adc_and_timing_checks(void) {
    /* 1. Verify 16x oversampling decimation and saturation counter. */
    uint16_t raw[EMG_ADC_FRAME_SAMPLES];
    uint16_t dec[TR_BLOCK];
    for(unsigned i=0;i<EMG_ADC_FRAME_SAMPLES;i++) raw[i]=2048;
    /* Group 1: alternating 2040 / 2056 -> exact mean 2048 */
    for(unsigned j=0;j<EMG_ADC_OSR;j++) raw[EMG_ADC_OSR+j]=(j&1)?2056:2040;
    /* Group 2: 8 samples at 0 + 8 samples at 4095 -> 16 saturated samples, rounded mean 2048 */
    for(unsigned j=0;j<EMG_ADC_OSR;j++) raw[2*EMG_ADC_OSR+j]=(j&1)?4095:0;
    uint32_t clips=0;
    assert(emg_adc_decimate_16x(raw,EMG_ADC_FRAME_SAMPLES,dec,&clips));
    assert(clips==16 && dec[0]==2048 && dec[1]==2048 && dec[2]==2048 && dec[63]==2048);
    assert(!emg_adc_decimate_16x(raw,EMG_ADC_FRAME_SAMPLES-1,dec,&clips));

    /* 2. Verify INA333+MCP601 ADC conversion (V_Ref = 1.65V -> code 2048, G_total = 400, uV)
     * and semg_v2 snapshot output with conversion + timing_v1 + oled_sequence. */
    tr_init(&t);
    tr_config_t c=t.config;
    c.source=TR_ADC; c.fs_hz=2048; c.channels=1; c.exercise_channel=0;
    assert(fabsf(c.input_scale[0]-805.86f)<0.01f && fabsf(c.input_gain[0]-400.0f)<0.01f && !strcmp(c.adc_unit,"uV"));
    assert(tr_reset(&t,&c));
    strcpy(t.boot_id,"33333333-3333-4333-8333-333333333333");
    t.state=TR_CALIBRATING; t.run_after_calibration=true;

    uint16_t rest_codes[TR_BLOCK], active_codes[TR_BLOCK];
    for(unsigned i=0;i<TR_BLOCK;i++) {
        /* 1.65V baseline + tiny 2-count noise at rest */
        rest_codes[i]=(uint16_t)(2048 + ((i&1)?2:-2));
        /* Strong sEMG burst (~80 Hz alternating +/-300 counts around 1.65V -> ~604 uV RTI peak) */
        float phase=2.0f*3.14159265f*80.0f*(float)i/2048.0f;
        active_codes[i]=(uint16_t)(2048 + (int)(300.0f*sinf(phase)));
    }
    tr_block_t b;
    /* Feed 5s calibration at 2048 Hz (160 blocks = 10240 samples; first 48 blocks = 1.5s DC cal) */
    for(unsigned blk=0;blk<160;blk++) {
        assert(tr_adc_block(&t.config,t.samples,rest_codes,TR_BLOCK,&b));
        assert(tr_process_block(&t,&b));
    }
    assert(t.channel[0].dc_calibrated);
    assert(fabsf(t.channel[0].dc_offset-(2048.0f*805.86f/400.0f))<1.0f);
    assert(t.state==TR_RUNNING);
    /* Feed contraction (>500 ms = 24 blocks = 750 ms) then release (16 blocks = 500 ms) */
    for(unsigned blk=0;blk<24;blk++) {
        assert(tr_adc_block(&t.config,t.samples,active_codes,TR_BLOCK,&b));
        assert(tr_process_block(&t,&b));
    }
    for(unsigned blk=0;blk<16;blk++) {
        assert(tr_adc_block(&t.config,t.samples,rest_codes,TR_BLOCK,&b));
        assert(tr_process_block(&t,&b));
    }
    assert(t.channel[0].reps==1 && t.channel[0].valid_reps==1);

    /* Populate timing_v1 + oled_sequence + nominal conversion snapshot */
    t.timing_valid=true; t.device_clock_ms=12345.678; t.sampled_at_device_ms=12340.123;
    t.oled_sequence_valid=true; t.oled_sequence=41;
    assert(tr_web_snapshot(&t,42,wire,sizeof(wire)));
    assert(strstr(wire,"\"source\":\"sensor\""));
    assert(strstr(wire,"\"unit\":\"uV\""));
    assert(strstr(wire,"\"conversion\":{"));
    assert(strstr(wire,"\"uV_per_unit\":2.01465"));
    assert(strstr(wire,"\"offset_uV\":0"));
    assert(strstr(wire,"\"bias\":0,\"scale\":805.86,\"gain\":400,\"calibrated\":false"));
    assert(strstr(wire,"\"timing_v1\""));
    assert(strstr(wire,"\"device_clock_ms\":12345.678"));
    assert(strstr(wire,"\"sampled_at_device_ms\":12340.123"));
    assert(strstr(wire,"\"oled_sequence\":41"));
    FILE *sf=fopen("validation/firmware_sensor_snapshot.json","wb");
    assert(sf); fputs(wire,sf); fclose(sf);

    /* Verify calibrated adc_cali metadata overrides scale and sets calibrated:true */
    t.adc_calibrated=true; t.adc_cali_scale_uv=812.0f;
    strcpy(t.adc_cali_ref,"ESP32 ADC1 GPIO34 (eFuse Vref) + INA333/MCP601");
    assert(tr_web_snapshot(&t,43,wire,sizeof(wire)));
    assert(strstr(wire,"\"uV_per_unit\":2.03"));
    assert(strstr(wire,"\"scale\":812,\"gain\":400,\"calibrated\":true"));
    assert(strstr(wire,"eFuse Vref"));

    /* Verify ADC raw-count mode snapshot */
    strcpy(t.config.adc_unit,"ADC");
    assert(tr_web_snapshot(&t,44,wire,sizeof(wire)));
    assert(strstr(wire,"\"source\":\"sensor\"") && strstr(wire,"\"unit\":\"ADC\""));

    /* 3. Verify timing_v1 ping/pong handler */
    char pong[256];
    assert(tr_handle_ping("{\"type\":\"ping\",\"protocol\":1,\"ping_id\":\"b14bfae5-0ac6-46d4-948d-8df07c1b1547\"}",
                          12500.125,12500.625,pong,sizeof(pong)));
    assert(!strcmp(pong,"{\"type\":\"pong\",\"protocol\":1,\"ping_id\":\"b14bfae5-0ac6-46d4-948d-8df07c1b1547\",\"device_rx_ms\":12500.125,\"device_tx_ms\":12500.625}"));
    /* Reject invalid protocol, non-UUID, extra fields, reversed clock, tiny buffer */
    assert(!tr_handle_ping("{\"type\":\"ping\",\"protocol\":2,\"ping_id\":\"b14bfae5-0ac6-46d4-948d-8df07c1b1547\"}",10,11,pong,sizeof(pong)));
    assert(!tr_handle_ping("{\"type\":\"ping\",\"protocol\":1,\"ping_id\":\"not-a-uuid\"}",10,11,pong,sizeof(pong)));
    assert(!tr_handle_ping("{\"type\":\"ping\",\"protocol\":1,\"ping_id\":\"b14bfae5-0ac6-46d4-948d-8df07c1b1547\",\"extra\":1}",10,11,pong,sizeof(pong)));
    assert(!tr_handle_ping("{\"type\":\"ping\",\"protocol\":1,\"ping_id\":\"b14bfae5-0ac6-46d4-948d-8df07c1b1547\"}",12,11,pong,sizeof(pong)));
    assert(!tr_handle_ping("{\"type\":\"ping\",\"protocol\":1,\"ping_id\":\"b14bfae5-0ac6-46d4-948d-8df07c1b1547\"}",10,11,pong,16));
}
static uint32_t g_raw_blocks_seen = 0;
static uint16_t g_last_raw_code0 = 0;
static bool g_raw_before_filter = false;
static void test_raw_hook(tr_engine_t *eng, const tr_block_t *blk) {
    g_raw_blocks_seen++;
    if (blk->has_raw_adc_codes) {
        g_last_raw_code0 = blk->raw_adc_codes[0][0];
    }
    /* Raw hook fires BEFORE DC offset removal/filtering in tr_process_block. */
    if (!eng->channel[0].dc_calibrated || eng->blocks == 0) {
        g_raw_before_filter = true;
    }
}
static void export_metadata_and_raw_checks(void) {
    /* A. Event details: start/end sample index, RMS mean/peak, failure reason_code */
    setup(false);
    t.config.hold_ms = 1000;
    samples(10, 4);
    samples(50, 6); /* < 1000 ms -> short_hold */
    samples(10, 4);
    assert(t.channel[0].reps == 1 && !t.channel[0].ledger[0].valid);
    assert(t.channel[0].ledger[0].reason_code == 1);
    assert(t.channel[0].ledger[0].end_sample > t.channel[0].ledger[0].start_sample);
    assert(t.channel[0].ledger[0].rms_mean > 0.0f && t.channel[0].ledger[0].rms_peak >= t.channel[0].ledger[0].rms_mean);
    assert(tr_web_snapshot(&t, 10, wire, sizeof(wire)));
    assert(strstr(wire, "\"reason_code\":\"short_hold\""));
    assert(strstr(wire, "\"label_source\":\"algorithm_predicted\""));
    assert(strstr(wire, "\"start_sample_index\":"));
    assert(strstr(wire, "\"rms_peak\":"));

    /* B. Incomplete contraction captured when stopped mid-contraction */
    setup(false);
    samples(10, 4);
    samples(50, 6); /* Now TR_ACTIVE */
    assert(t.channel[0].state == TR_ACTIVE);
    assert(tr_web_snapshot(&t, 11, wire, sizeof(wire)));
    assert(strstr(wire, "\"active_contraction\":{"));
    assert(tr_command(&t, "{\"v\":1,\"id\":50,\"cmd\":\"web_stop\",\"boot_id\":\"11111111-1111-4111-8111-111111111111\",\"session_id\":0}", ack, sizeof(ack)));
    assert(t.state == TR_STOPPED && t.channel[0].reps == 0 && t.incomplete_rep.present);
    assert(tr_web_snapshot(&t, 12, wire, sizeof(wire)));
    assert(strstr(wire, "\"incomplete_contraction\":{") && strstr(wire, "\"reason_code\":\"stopped_mid_contraction\""));

    /* C. Opt-in raw_record command & pre-DSP hook with raw ADC codes */
    tr_init(&t);
    tr_config_t adc = t.config;
    adc.source = TR_ADC; adc.fs_hz = 2048; adc.channels = 1;
    assert(tr_reset(&t, &adc));
    strcpy(t.boot_id, "44444444-4444-4444-8444-444444444444");
    t.on_raw_block = test_raw_hook;
    g_raw_blocks_seen = 0; g_last_raw_code0 = 0; g_raw_before_filter = false;
    assert(tr_command(&t, "{\"v\":1,\"id\":60,\"cmd\":\"web_reset\",\"boot_id\":\"44444444-4444-4444-8444-444444444444\",\"session_id\":0,\"raw_record\":1}", ack, sizeof(ack)));
    assert(t.raw_recording_enabled);
    t.state = TR_CALIBRATING;
    uint16_t raw_codes[TR_BLOCK];
    for (unsigned i = 0; i < TR_BLOCK; i++) raw_codes[i] = (uint16_t)(2048 + i);
    tr_block_t b;
    assert(tr_adc_block(&t.config, t.samples, raw_codes, TR_BLOCK, &b));
    assert(tr_process_block(&t, &b));
    assert(g_raw_blocks_seen == 1 && g_last_raw_code0 == 2048 && g_raw_before_filter);
    assert(tr_web_snapshot(&t, 13, wire, sizeof(wire)));
    assert(strstr(wire, "\"raw_recording\":true") && strstr(wire, "\"raw_stream_v1\""));

    /* D. Worst-case 128 repetitions fits cleanly inside TR_WEB_BYTES */
    setup(true);
    t.channel[0].reps = TR_MAX_REPS;
    for (unsigned i = 0; i < TR_MAX_REPS; i++) {
        t.channel[0].ledger[i] = (tr_rep_t){
            .ended_ms = 123456.78f, .hold_ms = 1234.56f, .rest_ms = 2345.67f, .in_zone_ms = 456.78f,
            .start_sample = 250000ULL + i * 2000ULL, .end_sample = 251500ULL + i * 2000ULL,
            .rms_mean = 145.67f, .rms_peak = 289.12f, .channel = 1, .reason_code = 2, .valid = false
        };
    }
    assert(tr_web_snapshot(&t, 999, wire, sizeof(wire)) > 0);
}
int main(void) {
    setup(false);samples(10,4);samples(50,1);samples(10,3);assert(t.channel[0].reps==0);
    samples(50,12);samples(10,1);assert(t.channel[0].reps==0);samples(10,1);
    tr_rep_t r=t.channel[0].ledger[0];assert(t.channel[0].reps==1 && r.valid);assert(fabsf(r.hold_ms-750)<.01);assert(fabsf(r.rest_ms-500)<.01);
    assert(tr_telemetry(&t,ack,sizeof(ack)));assert(strstr(ack,"last_rep") && strstr(ack,"rest_ms") && strstr(ack,"boot_id"));
    setup(true);samples(10,4);samples(50,4);samples(90,2);samples(50,4);samples(10,2);
    assert(t.channel[0].reps==1 && !t.channel[0].ledger[0].valid);assert(fabsf(t.channel[0].ledger[0].in_zone_ms-250)<.01);
    samples(50,8);samples(10,2);assert(t.channel[0].valid_reps==1);
    assert(tr_activation_level(29)[0]=='l');assert(!strcmp(tr_activation_level(30),"medium"));assert(!strcmp(tr_activation_level(70),"high"));
    assert(tr_command(&t,"{\"v\":1,\"id\":1,\"cmd\":\"web_pause\",\"boot_id\":\"11111111-1111-4111-8111-111111111111\",\"session_id\":0}",ack,sizeof(ack)));assert(!tr_is_acquiring(&t));
    assert(!tr_command(&t,"{\"v\":1,\"id\":2,\"cmd\":\"configure\",\"hold_ms\":100}",ack,sizeof(ack)));
    assert(!tr_command(&t,"{\"v\":1,\"id\":3,\"cmd\":\"web_stop\",\"boot_id\":\"11111111-1111-4111-8111-111111111111\",\"session_id\":9}",ack,sizeof(ack)));
    assert(tr_web_snapshot(&t,5,wire,sizeof(wire)));assert(strstr(wire,"semg_v2") && strstr(wire,"\"source\":\"simulation\"") && strstr(wire,"\"filtered\":") && !strstr(wire,"dc_offset_ch2"));
    aead_checks(wire);
    FILE *f=fopen("validation/firmware_snapshot.json","wb");assert(f);fputs(wire,f);fclose(f);
    t.channel[0].reps=TR_MAX_REPS;for(unsigned i=0;i<TR_MAX_REPS;i++)t.channel[0].ledger[i]=r;
    assert(tr_web_snapshot(&t,6,wire,sizeof(wire)));assert(!tr_web_snapshot(&t,7,wire,64));
    setup(false);t.state=TR_IDLE;
    const char *cal="{\"v\":1,\"id\":10,\"cmd\":\"web_calibrate\",\"request_id\":\"22222222-2222-4222-8222-222222222222\",\"boot_id\":\"11111111-1111-4111-8111-111111111111\",\"session_id\":0,\"target_reps\":3,\"hold_ms\":1000,\"exercise_channel\":0,\"mode\":\"training\",\"muscle\":\"forearm\",\"reference_rms\":400,\"zone_enabled\":1,\"zone_low_pct\":40,\"zone_high_pct\":70}";
    assert(tr_command(&t,cal,ack,sizeof(ack)));assert(t.config.reference_rms==400 && t.config.hold_ms==1000 && t.config.zone_enabled && t.state==TR_CALIBRATING && t.session_id==1);
    assert(tr_command(&t,cal,ack,sizeof(ack)));assert(t.session_id==1);
    setup(false);t.state=TR_IDLE;
    assert(!tr_command(&t,"{\"v\":1,\"id\":11,\"cmd\":\"web_calibrate\",\"boot_id\":\"11111111-1111-4111-8111-111111111111\",\"session_id\":0,\"hold_ms\":1000,\"reference_rms\":0,\"zone_enabled\":1}",ack,sizeof(ack)));
    assert(t.config.hold_ms==500 && t.config.reference_rms==100 && t.state==TR_IDLE);
    tr_init(&t);t.config.zone_enabled=true;assert(tr_reset(&t,&t.config));t.state=TR_CALIBRATING;t.run_after_calibration=true;
    for(unsigned i=0;i<4000 && tr_is_acquiring(&t);i++)assert(tr_step(&t));
    assert(t.state==TR_COMPLETED && t.channel[0].valid_reps==5);
    adc_and_timing_checks();
    export_metadata_and_raw_checks();
    puts("hysteresis, release timing, rest ledger, continuous target zone, ADC INA333+MCP601, timing_v1/oled_sequence and AEAD: PASS");
    return 0;
}
