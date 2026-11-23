#include "emg_adc.h"
#include <stddef.h>

bool emg_adc_decimate_16x(const uint16_t *raw_samples, uint32_t raw_count,
                          uint16_t out_codes[TR_BLOCK], uint32_t *clip_count) {
    if (!raw_samples || !out_codes || raw_count != EMG_ADC_FRAME_SAMPLES) {
        return false;
    }
    uint32_t clips = 0;
    for (uint32_t i = 0; i < TR_BLOCK; ++i) {
        uint32_t sum = 0;
        const uint32_t base = i * EMG_ADC_OSR;
        for (uint32_t j = 0; j < EMG_ADC_OSR; ++j) {
            uint16_t code = (uint16_t)(raw_samples[base + j] & 0x0FFFU);
            if (code == EMG_ADC_SAT_LOW || code >= EMG_ADC_SAT_HIGH) {
                clips++;
            }
            sum += code;
        }
        out_codes[i] = (uint16_t)((sum + (EMG_ADC_OSR / 2U)) >> 4);
    }
    if (clip_count) {
        *clip_count = clips;
    }
    return true;
}

#ifdef ESP_PLATFORM
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_adc/adc_continuous.h"
#include "esp_attr.h"
#include "esp_idf_version.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "soc/soc_caps.h"

#define EMG_ADC_UNIT        ADC_UNIT_1
#define EMG_ADC_CHANNEL     ADC_CHANNEL_6 /* GPIO34 on ESP32-WROOM-32E */
#define EMG_ADC_ATTEN       ADC_ATTEN_DB_12
#define EMG_ADC_BITWIDTH    ADC_BITWIDTH_12
#define EMG_ADC_FRAME_BYTES (EMG_ADC_FRAME_SAMPLES * SOC_ADC_DIGI_RESULT_BYTES)
#define EMG_ADC_POOL_BYTES  (EMG_ADC_FRAME_BYTES * 4U)
#define EMG_ADC_CLIP_LOG_US 2000000LL

static const char *TAG = "emg_adc";

static adc_continuous_handle_t s_handle = NULL;
static adc_cali_handle_t s_cali_handle = NULL;
static TaskHandle_t s_notify_task = NULL;
static volatile bool s_pool_overflow = false;
static bool s_initialized = false;
static bool s_running = false;
static bool s_calibrated = false;
static float s_cali_lut_mv[65];
static float s_cali_uv_per_count = TR_ADC_DEFAULT_SCALE_UV;
static char s_cali_ref[64] = "ESP32 ADC1 GPIO34 (nominal 805.86 uV/count) + INA333/MCP601";
static uint32_t s_clip_total = 0;
static int64_t s_last_clip_log_us = 0;

/* Owned exclusively by the emg_engine task (single-owner architecture). */
static uint8_t s_dma_buf[EMG_ADC_FRAME_BYTES];
static uint16_t s_raw_buf[EMG_ADC_FRAME_SAMPLES];

static bool IRAM_ATTR adc_on_conv_done(adc_continuous_handle_t handle,
                                       const adc_continuous_evt_data_t *edata,
                                       void *user_data) {
    (void)handle;
    (void)edata;
    (void)user_data;
    BaseType_t woken = pdFALSE;
    TaskHandle_t task = s_notify_task;
    if (task) {
        vTaskNotifyGiveFromISR(task, &woken);
    }
    return woken == pdTRUE;
}

static bool IRAM_ATTR adc_on_pool_ovf(adc_continuous_handle_t handle,
                                      const adc_continuous_evt_data_t *edata,
                                      void *user_data) {
    (void)handle;
    (void)edata;
    (void)user_data;
    s_pool_overflow = true;
    BaseType_t woken = pdFALSE;
    TaskHandle_t task = s_notify_task;
    if (task) {
        vTaskNotifyGiveFromISR(task, &woken);
    }
    return woken == pdTRUE;
}

static void init_calibration(void) {
    s_calibrated = false;
    s_cali_uv_per_count = TR_ADC_DEFAULT_SCALE_UV;
    snprintf(s_cali_ref, sizeof(s_cali_ref),
             "ESP32 ADC1 GPIO34 (nominal 805.86 uV/count) + INA333/MCP601");

#if ADC_CALI_SCHEME_LINE_FITTING_SUPPORTED
#if CONFIG_IDF_TARGET_ESP32
    adc_cali_line_fitting_efuse_val_t efuse_val = ADC_CALI_LINE_FITTING_EFUSE_VAL_DEFAULT_VREF;
    esp_err_t efuse_err = adc_cali_scheme_line_fitting_check_efuse(&efuse_val);
    if (efuse_err != ESP_OK || efuse_val == ADC_CALI_LINE_FITTING_EFUSE_VAL_DEFAULT_VREF) {
        ESP_LOGW(TAG, "ADC1 eFuse calibration not burnt; falling back to nominal %.2f uV/count",
                 (double)TR_ADC_DEFAULT_SCALE_UV);
        return;
    }
#endif
    adc_cali_line_fitting_config_t cali_cfg = {
        .unit_id = EMG_ADC_UNIT,
        .atten = EMG_ADC_ATTEN,
        .bitwidth = EMG_ADC_BITWIDTH,
    };
    esp_err_t err = adc_cali_create_scheme_line_fitting(&cali_cfg, &s_cali_handle);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "adc_cali_create_scheme_line_fitting failed (%s); falling back to nominal %.2f uV/count",
                 esp_err_to_name(err), (double)TR_ADC_DEFAULT_SCALE_UV);
        s_cali_handle = NULL;
        return;
    }

    for (unsigned i = 0; i < 65U; ++i) {
        int raw = (i < 64U) ? (int)(i * 64U) : 4095;
        int mv = 0;
        if (adc_cali_raw_to_voltage(s_cali_handle, raw, &mv) == ESP_OK) {
            s_cali_lut_mv[i] = (float)mv;
        } else {
            s_cali_lut_mv[i] = (float)raw * (TR_ADC_DEFAULT_SCALE_UV / 1000.0f);
        }
    }

    /* Effective linear slope around V_Ref = 1.65 V operating region [512..2560]. */
    float slope = (s_cali_lut_mv[40] - s_cali_lut_mv[8]) * 1000.0f / (float)(2560 - 512);
    if (isfinite(slope) && slope > 100.0f && slope < 2000.0f) {
        s_cali_uv_per_count = slope;
    }
    s_calibrated = true;
#if CONFIG_IDF_TARGET_ESP32
    snprintf(s_cali_ref, sizeof(s_cali_ref),
             "ESP32 ADC1 GPIO34 (eFuse %s) + INA333/MCP601",
             efuse_val == ADC_CALI_LINE_FITTING_EFUSE_VAL_EFUSE_TP ? "TP" : "Vref");
#else
    snprintf(s_cali_ref, sizeof(s_cali_ref),
             "ESP32 ADC1 GPIO34 (Line Fitting) + INA333/MCP601");
#endif
    ESP_LOGI(TAG, "ADC1 calibrated (%s): %.2f uV/count", s_cali_ref, (double)s_cali_uv_per_count);
#else
    ESP_LOGW(TAG, "Line Fitting scheme unsupported on this target; using nominal %.2f uV/count",
             (double)TR_ADC_DEFAULT_SCALE_UV);
#endif
}

static float code_to_pin_uv_calibrated(uint16_t code) {
    if (code > 4095U) {
        code = 4095U;
    }
    unsigned idx = code >> 6;  /* 0..63 */
    unsigned rem = code & 63U; /* 0..63 */
    float step = (idx == 63U) ? 63.0f : 64.0f;
    float mv = s_cali_lut_mv[idx] + (s_cali_lut_mv[idx + 1] - s_cali_lut_mv[idx]) * ((float)rem / step);
    return mv * 1000.0f;
}

void emg_adc_sync_meta(tr_engine_t *t) {
    if (!t) return;
    t->adc_calibrated = s_calibrated;
    t->adc_cali_scale_uv = s_calibrated ? s_cali_uv_per_count : 0.0f;
    snprintf(t->adc_cali_ref, sizeof(t->adc_cali_ref), "%s", s_cali_ref);
    t->adc_clip_count = s_clip_total;
}

bool emg_adc_init(tr_engine_t *t) {
    if (s_initialized) {
        emg_adc_sync_meta(t);
        return true;
    }

    init_calibration();

    adc_continuous_handle_cfg_t hdl_cfg = {
        .max_store_buf_size = EMG_ADC_POOL_BYTES,
        .conv_frame_size = EMG_ADC_FRAME_BYTES,
        .flags = { .flush_pool = 0 },
    };
    esp_err_t err = adc_continuous_new_handle(&hdl_cfg, &s_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "adc_continuous_new_handle failed: %s", esp_err_to_name(err));
        s_handle = NULL;
        emg_adc_sync_meta(t);
        return false;
    }

    adc_digi_pattern_config_t pattern = {
        .atten = EMG_ADC_ATTEN,
        .channel = EMG_ADC_CHANNEL,
        .unit = EMG_ADC_UNIT,
        .bit_width = EMG_ADC_BITWIDTH,
    };
    adc_continuous_config_t dig_cfg = {
        .pattern_num = 1,
        .adc_pattern = &pattern,
        .sample_freq_hz = EMG_ADC_HW_FREQ_HZ,
        .conv_mode = ADC_CONV_SINGLE_UNIT_1,
#if ESP_IDF_VERSION < ESP_IDF_VERSION_VAL(6, 0, 0)
        .format = ADC_DIGI_OUTPUT_FORMAT_TYPE1,
#endif
    };
    err = adc_continuous_config(s_handle, &dig_cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "adc_continuous_config failed: %s", esp_err_to_name(err));
        (void)adc_continuous_deinit(s_handle);
        s_handle = NULL;
        emg_adc_sync_meta(t);
        return false;
    }

    adc_continuous_evt_cbs_t cbs = {
        .on_conv_done = adc_on_conv_done,
        .on_pool_ovf = adc_on_pool_ovf,
    };
    err = adc_continuous_register_event_callbacks(s_handle, &cbs, NULL);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "adc_continuous_register_event_callbacks failed: %s", esp_err_to_name(err));
        (void)adc_continuous_deinit(s_handle);
        s_handle = NULL;
        emg_adc_sync_meta(t);
        return false;
    }

    s_initialized = true;
    s_running = false;
    s_pool_overflow = false;
    emg_adc_sync_meta(t);
    ESP_LOGI(TAG, "ADC1 DMA ready on GPIO%d (CH%d): hw=%u Hz, osr=%ux, fs=%u Hz, frame=%u bytes",
             EMG_ADC_GPIO, (int)EMG_ADC_CHANNEL, (unsigned)EMG_ADC_HW_FREQ_HZ,
             (unsigned)EMG_ADC_OSR, (unsigned)EMG_ADC_FS_HZ, (unsigned)EMG_ADC_FRAME_BYTES);
    return true;
}

bool emg_adc_start(TaskHandle_t notify_task) {
    if (!s_initialized && !emg_adc_init(NULL)) {
        return false;
    }
    if (s_running) {
        return true;
    }
    s_notify_task = notify_task;
    s_pool_overflow = false;
    (void)adc_continuous_flush_pool(s_handle);
    esp_err_t err = adc_continuous_start(s_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "adc_continuous_start failed: %s", esp_err_to_name(err));
        return false;
    }
    s_running = true;
    return true;
}

void emg_adc_stop(void) {
    if (!s_initialized || !s_running) {
        return;
    }
    esp_err_t err = adc_continuous_stop(s_handle);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "adc_continuous_stop: %s", esp_err_to_name(err));
    }
    s_running = false;
    s_pool_overflow = false;
    (void)adc_continuous_flush_pool(s_handle);
}

bool emg_adc_is_running(void) {
    return s_running;
}

tr_read_t emg_adc_read_block(const tr_config_t *c, uint64_t first_sample, tr_block_t *b) {
    if (!c || !b || !s_initialized || !s_running || c->source != TR_ADC || c->channels != 1) {
        return TR_SOURCE_NOT_READY;
    }

    if (s_pool_overflow) {
        s_pool_overflow = false;
        memset(b, 0, sizeof(*b));
        b->first_sample = first_sample;
        b->frames = TR_BLOCK;
        b->channels = c->channels;
        b->discontinuity = true;
        ESP_LOGW(TAG, "ADC DMA pool overflow detected; flagging data_discontinuity");
        return TR_SOURCE_OK;
    }

    uint32_t collected = 0;
    while (collected < EMG_ADC_FRAME_BYTES) {
        uint32_t out_len = 0;
        uint32_t timeout_ms = collected == 0 ? 5U : 25U;
        esp_err_t err = adc_continuous_read(s_handle, s_dma_buf + collected,
                                            EMG_ADC_FRAME_BYTES - collected,
                                            &out_len, timeout_ms);
        if (err == ESP_ERR_TIMEOUT) {
            if (collected == 0) {
                return TR_SOURCE_NOT_READY;
            }
            memset(b, 0, sizeof(*b));
            b->first_sample = first_sample;
            b->frames = TR_BLOCK;
            b->channels = c->channels;
            b->discontinuity = true;
            ESP_LOGW(TAG, "ADC partial DMA frame timeout (%u/%u bytes)",
                     (unsigned)collected, (unsigned)EMG_ADC_FRAME_BYTES);
            return TR_SOURCE_OK;
        }
        if (err != ESP_OK) {
            memset(b, 0, sizeof(*b));
            b->first_sample = first_sample;
            b->frames = TR_BLOCK;
            b->channels = c->channels;
            b->discontinuity = true;
            ESP_LOGW(TAG, "adc_continuous_read error: %s", esp_err_to_name(err));
            return TR_SOURCE_OK;
        }
        collected += out_len;
    }

    bool overflowed = false;
    if (s_pool_overflow) {
        s_pool_overflow = false;
        overflowed = true;
    }

    const adc_digi_output_data_t *items = (const adc_digi_output_data_t *)s_dma_buf;
    uint32_t valid_n = 0;
    for (uint32_t i = 0; i < EMG_ADC_FRAME_SAMPLES; ++i) {
#if CONFIG_IDF_TARGET_ESP32 || CONFIG_IDF_TARGET_ESP32S2
        if (items[i].type1.channel != EMG_ADC_CHANNEL) {
            continue;
        }
        s_raw_buf[valid_n++] = items[i].type1.data;
#else
        if (items[i].type2.channel != EMG_ADC_CHANNEL) {
            continue;
        }
        s_raw_buf[valid_n++] = (uint16_t)items[i].type2.data;
#endif
    }

    uint16_t codes[TR_BLOCK];
    uint32_t clip_in_block = 0;
    if (valid_n != EMG_ADC_FRAME_SAMPLES ||
        !emg_adc_decimate_16x(s_raw_buf, valid_n, codes, &clip_in_block)) {
        memset(b, 0, sizeof(*b));
        b->first_sample = first_sample;
        b->frames = TR_BLOCK;
        b->channels = c->channels;
        b->discontinuity = true;
        ESP_LOGW(TAG, "ADC channel mismatch (%u/%u valid CH%d samples)",
                 (unsigned)valid_n, (unsigned)EMG_ADC_FRAME_SAMPLES, (int)EMG_ADC_CHANNEL);
        return TR_SOURCE_OK;
    }

    if (clip_in_block > 0) {
        s_clip_total += clip_in_block;
        int64_t now_us = esp_timer_get_time();
        if (now_us - s_last_clip_log_us >= EMG_ADC_CLIP_LOG_US) {
            s_last_clip_log_us = now_us;
            ESP_LOGW(TAG, "ADC1 GPIO%d saturation/clipping detected: %u/%u samples in block (total=%u); check electrodes/trimmer R16",
                     EMG_ADC_GPIO, (unsigned)clip_in_block, (unsigned)EMG_ADC_FRAME_SAMPLES,
                     (unsigned)s_clip_total);
        }
    }

    if (!tr_adc_block(c, first_sample, codes, TR_BLOCK, b)) {
        return TR_SOURCE_NOT_READY;
    }
    for (uint32_t i = 0; i < TR_BLOCK; ++i) {
        b->raw_adc_codes[i][0] = codes[i];
    }
    b->has_raw_adc_codes = true;

    /* When eFuse Line Fitting calibration is active and unit is uV with default
     * nominal scale, apply the calibrated piecewise-linear LUT before gain division. */
    if (s_calibrated && !strcmp(c->adc_unit, "uV") &&
        fabsf(c->input_scale[0] - TR_ADC_DEFAULT_SCALE_UV) < 0.05f) {
        float bias_uv = c->input_bias[0] * s_cali_uv_per_count;
        for (uint32_t i = 0; i < TR_BLOCK; ++i) {
            b->sample[i][0] = (code_to_pin_uv_calibrated(codes[i]) - bias_uv) / c->input_gain[0];
        }
    }

    b->discontinuity = overflowed;
    return TR_SOURCE_OK;
}
#endif
