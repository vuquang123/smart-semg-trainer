#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define TR_MAX_CHANNELS 2
#define TR_BLOCK 64
#define TR_MAX_WINDOW 4096
#define TR_MAX_REPS 128
#define TR_DC_CAL_MS 1500
#define TR_COMMAND_BYTES 1024
#define TR_MESSAGE_BYTES 2048
#define TR_PROTOCOL 1
#define TR_VERSION "0.3.0"
#define TR_ADC_DEFAULT_SCALE_UV 805.86f
#define TR_ADC_DEFAULT_GAIN     400.0f

typedef enum { TR_SIMULATION, TR_REPLAY, TR_ADC } tr_source_t;
typedef enum { TR_RAW, TR_ENVELOPE } tr_kind_t;
typedef enum { TR_IDLE, TR_CALIBRATING, TR_READY, TR_RUNNING,
               TR_STOPPED, TR_COMPLETED, TR_EOF, TR_ERROR } tr_session_t;
typedef enum { TR_CAL, TR_REST, TR_ACTIVE } tr_muscle_t;
/* Coaching phase shared by web and OLED; derived only by tr_phase(). */
typedef enum { TR_PHASE_IDLE, TR_PHASE_RELAX, TR_PHASE_CONTRACT,
               TR_PHASE_HOLD, TR_PHASE_RELEASE, TR_PHASE_COMPLETE } tr_phase_t;

/* Input samples are in `unit` at the processing boundary, after conversion.
 * gain/bias belong to the ADC adapter; simulation/replay are already uV. */
typedef struct {
    tr_source_t source;
    tr_kind_t kind;
    uint32_t fs_hz, channels;
    float highpass_hz, lowpass_hz, notch_hz, notch_q;
    float rms_ms, cal_ms, settle_ms, on_ms, off_ms;
    float on_factor, off_factor, on_sd, off_sd, threshold_floor, threshold_gap;
    float input_bias[TR_MAX_CHANNELS], input_scale[TR_MAX_CHANNELS], input_gain[TR_MAX_CHANNELS];
    char adc_unit[16];
    uint32_t target_reps, hold_ms, exercise_channel;
    float reference_rms, zone_low_pct, zone_high_pct;
    bool zone_enabled, free_mode, biceps;
} tr_config_t;

/* Sample-clock results, recorded once at the confirmed release edge. */
typedef struct {
    float ended_ms, hold_ms, rest_ms, in_zone_ms;
    uint64_t start_sample, end_sample; /* half-open [start_sample, end_sample) */
    float rms_mean, rms_peak;
    uint8_t channel; /* 1-based */
    uint8_t reason_code; /* 0=valid, 1=short_hold, 2=insufficient_in_zone */
    bool valid;
} tr_rep_t;

typedef struct {
    bool present;
    uint8_t channel;
    uint64_t start_sample, end_sample;
    float started_ms, ended_ms, hold_ms, in_zone_ms, rms_mean, rms_peak;
} tr_incomplete_rep_t;

typedef struct { float b0,b1,b2,a1,a2,z1,z2; } tr_biquad_t;
typedef struct {
    tr_biquad_t filter[3];
    unsigned filter_count, pos, filled;
    double square[TR_MAX_WINDOW], sum, mean, m2;
    double dc_sum;
    uint32_t dc_count;
    float dc_offset;
    bool dc_calibrated;
    uint32_t cal_count, above, below, active_frames, reps, valid_reps;
    float value, filtered, on, off, last_hold_ms;
    tr_muscle_t state;
    /* Min/max pairs for the latest 8 blocks, aggregated, not raw samples. */
    float trace[16];
    unsigned trace_pairs;
    uint64_t rest_started, contraction_started;
    uint32_t zone_frames, zone_longest, onset_zone_frames;
    float last_rest_ms, last_in_zone_ms;
    double active_rms_sum;
    float active_rms_peak;
    uint32_t active_rms_count;
    tr_rep_t ledger[TR_MAX_REPS];
} tr_channel_t;

typedef struct {
    uint64_t first_sample;
    uint32_t frames, channels;
    float sample[TR_BLOCK][TR_MAX_CHANNELS];
    uint16_t raw_adc_codes[TR_BLOCK][TR_MAX_CHANNELS];
    bool has_raw_adc_codes;
    bool discontinuity;
} tr_block_t;
typedef enum { TR_SOURCE_OK, TR_SOURCE_END, TR_SOURCE_NOT_READY } tr_read_t;
typedef struct { uint64_t cursor; uint32_t rng[2]; } tr_source_state_t;

typedef struct tr_engine {
    tr_config_t config;
    tr_channel_t channel[TR_MAX_CHANNELS];
    tr_source_state_t source;
    tr_session_t state;
    bool run_after_calibration;
    bool paused;
    uint32_t window, cal_samples, settle_samples, dc_cal_samples, on_samples, off_samples;
    uint64_t samples, session_id, seq;
    uint64_t training_started;
    char boot_id[37];
    uint32_t blocks, discontinuities, tx_dropped, backlog_ticks;
    uint32_t max_dsp_us;
    char fault[48];
    /* ADC calibration / saturation metadata (updated by emg_adc on ESP32). */
    bool adc_calibrated;
    float adc_cali_scale_uv;
    char adc_cali_ref[64];
    uint32_t adc_clip_count;
    /* Monotonic clock & OLED sync state (timing_v1 + oled_sequence). */
    bool timing_valid;
    double device_clock_ms;
    double sampled_at_device_ms;
    bool oled_sequence_valid;
    uint64_t oled_sequence;
    uint64_t snapshot_seq;
    /* Opt-in RAW streaming and incomplete contraction capture for export. */
    tr_incomplete_rep_t incomplete_rep;
    bool raw_recording_enabled;
    uint32_t raw_dropped_samples, raw_overflow_events;
    void (*on_raw_block)(struct tr_engine *t, const tr_block_t *b);
    /* Acks make retry safe: identical id/body returns the original reply. */
    char previous_command[TR_COMMAND_BYTES], previous_ack[TR_MESSAGE_BYTES];
    uint32_t previous_id;
    bool previous_valid, previous_ok;
} tr_engine_t;

tr_config_t tr_default_config(void);
bool tr_validate(const tr_config_t *c, char *error, size_t cap);
void tr_init(tr_engine_t *t);
bool tr_reset(tr_engine_t *t, const tr_config_t *c);
void tr_source_reset(tr_source_state_t *s);
tr_read_t tr_source_read(tr_source_state_t *s, const tr_config_t *c, tr_block_t *b);
/* Future DMA source: validate sequence and convert ADC codes with bias/scale. */
bool tr_adc_block(const tr_config_t *c, uint64_t first_sample,
                  const uint16_t *interleaved, uint32_t frames, tr_block_t *b);
bool tr_process_block(tr_engine_t *t, const tr_block_t *b);
bool tr_step(tr_engine_t *t);
void tr_fail(tr_engine_t *t, const char *code);
bool tr_is_acquiring(const tr_engine_t *t);
const char *tr_source_name(tr_source_t v);
const char *tr_session_name(tr_session_t v);
const char *tr_muscle_name(tr_muscle_t v);
/* Single source for display state. Every UI must use these, never re-derive. */
tr_phase_t tr_phase(const tr_engine_t *t);
const char *tr_phase_name(tr_phase_t v);
double tr_current_hold_ms(const tr_engine_t *t);
double tr_duration_ms(const tr_engine_t *t);
const char *tr_unit(const tr_engine_t *t);
float tr_activation(const tr_config_t *c, float rms);
const char *tr_activation_level(float pct);
const char *tr_target_zone(const tr_config_t *c, float pct);
/* Flat JSON commands; newline framing is handled by each transport. */
bool tr_command(tr_engine_t *t, const char *json, char *out, size_t cap);
size_t tr_telemetry(tr_engine_t *t, char *out, size_t cap);
size_t tr_status(const tr_engine_t *t, char *out, size_t cap);
#define TR_WEB_BYTES 49152
size_t tr_web_snapshot(const tr_engine_t *t, uint64_t sequence, char *out, size_t cap);
/* timing_v1 ping/pong handler: parses flat JSON ping and formats pong reply. */
bool tr_handle_ping(const char *json, double rx_ms, double tx_ms, char *out, size_t cap);
