#pragma once
#include <stdint.h>
#define REPLAY_SEGMENT_SAMPLES 10240U
#define REPLAY_TOTAL_SAMPLES (3U * REPLAY_SEGMENT_SAMPLES)
extern const float replay_rest_uv[REPLAY_SEGMENT_SAMPLES];
extern const float replay_active_uv[REPLAY_SEGMENT_SAMPLES];
static inline float replay_sample(uint32_t i) {
    if (i < REPLAY_SEGMENT_SAMPLES) return replay_rest_uv[i];
    if (i < 2U * REPLAY_SEGMENT_SAMPLES) return replay_active_uv[i-REPLAY_SEGMENT_SAMPLES];
    return replay_rest_uv[i-2U * REPLAY_SEGMENT_SAMPLES];
}
