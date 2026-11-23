#pragma once
#include "emg_ui.h"
#define EMG_OLED_FRAME_BYTES 1024
/* now_ms drives tiny expressions; state_age_ms limits completion celebration. */
void emg_oled_render(const emg_ui_snapshot_t *s, bool wifi,
    uint32_t now_ms, uint32_t state_age_ms, uint8_t frame[EMG_OLED_FRAME_BYTES]);
