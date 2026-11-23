#pragma once
#include "trainer.h"

typedef struct {
    float value, on, off, baseline, hold_ms, hold_now_ms;
    uint32_t reps, valid_reps;
    tr_muscle_t muscle;
    float rest_now_ms, in_zone_ms, longest_in_zone_ms;
} emg_ui_channel_t;

/* Small immutable copy; UI tasks never read/mutate the live DSP engine. */
typedef struct {
    tr_config_t config;
    tr_session_t state;
    tr_phase_t phase;          /* same tr_phase() as the web snapshot */
    uint64_t session_id;
    uint64_t sequence;         /* latest WebSocket snapshot sequence for OLED sync */
    emg_ui_channel_t ch[TR_MAX_CHANNELS];
    double elapsed_s;          /* training time, equals web duration_ms/1000 */
    float progress, calibration_progress;
    /* Exercise channel ledger summary (used by the free-count result page). */
    float avg_hold_ms, avg_rest_ms, longest_hold_ms, reps_per_min;
    bool signal_ready;
    bool paused;
    uint32_t discontinuities, tx_dropped, backlog_ticks, max_dsp_us;
    uint32_t revision;
    unsigned oled_page;
    char unit[16], fault[48], last_ack[160];
} emg_ui_snapshot_t;

typedef enum { EMG_UI_IGNORED, EMG_UI_OK, EMG_UI_REJECTED } emg_ui_result_t;

/* Pure internal control-sync functions used by local UI controls and host tests. */
void emg_ui_capture(const tr_engine_t *t, emg_ui_snapshot_t *s);
emg_ui_result_t emg_ui_execute(tr_engine_t *t, const char *name,
    const char *value, uint32_t id, unsigned *oled_page, char *ack, size_t cap);

/* ESP-IDF UI/OLED/Wi-Fi API. Init before creating the engine task. */
bool emg_ui_init(void);
bool emg_ui_start(void);
bool emg_ui_process_one(tr_engine_t *t, char *ack, size_t cap);
bool emg_ui_submit_control(const char *name, const char *value);
void emg_ui_update(const tr_engine_t *t);
bool emg_ui_read_snapshot(emg_ui_snapshot_t *s);
void emg_ui_link_state(bool *wifi);
void emg_oled_task(void *arg);
/* Returns the latest snapshot sequence successfully flushed to SSD1306 over I2C. */
uint64_t emg_oled_last_sequence(bool *valid);
