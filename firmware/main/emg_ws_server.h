#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "trainer.h"
bool emg_ws_init(void);
void emg_ws_update(const tr_engine_t *t);
void emg_ws_push_raw(tr_engine_t *t, const tr_block_t *b);
void emg_ws_flush_raw(tr_engine_t *t);
uint64_t emg_ws_sequence(void);
bool emg_ws_process_one(tr_engine_t *t,char *ack,size_t cap);

bool emg_ws_server_start(void);
bool emg_ws_server_stop(void);
