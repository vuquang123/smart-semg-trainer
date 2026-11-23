#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "trainer.h"

/* ESP32-WROOM-32E ADC1 DMA (GPIO34 = ADC_CHANNEL_6) + INA333/MCP601 AFE.
 * Classic ESP32 requires DMA sample_freq_hz >= 20000 Hz, so we oversample 16x
 * at 32768 Hz and decimate to 2048 Hz (1024 DMA samples -> 64 DSP frames / 31.25 ms). */
#define EMG_ADC_GPIO          34
#define EMG_ADC_OSR           16U
#define EMG_ADC_FS_HZ         2048U
#define EMG_ADC_HW_FREQ_HZ    (EMG_ADC_FS_HZ * EMG_ADC_OSR)
#define EMG_ADC_FRAME_SAMPLES (TR_BLOCK * EMG_ADC_OSR)
#define EMG_ADC_SAT_LOW       0U
#define EMG_ADC_SAT_HIGH      4095U

/* Pure 16x boxcar decimation + saturation counter; compiled on host and ESP32. */
bool emg_adc_decimate_16x(const uint16_t *raw_samples, uint32_t raw_count,
                          uint16_t out_codes[TR_BLOCK], uint32_t *clip_count);

#ifdef ESP_PLATFORM
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

bool emg_adc_init(tr_engine_t *t);
bool emg_adc_start(TaskHandle_t notify_task);
void emg_adc_stop(void);
bool emg_adc_is_running(void);
tr_read_t emg_adc_read_block(const tr_config_t *c, uint64_t first_sample, tr_block_t *b);
void emg_adc_sync_meta(tr_engine_t *t);
#endif
