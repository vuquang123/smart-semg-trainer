#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "tinyjambu/TinyJAMBU.h"

#define EMG_WS_AEAD_AD_S2C "semg_v2:s2c"
#define EMG_WS_AEAD_AD_C2S "semg_v2:c2s"
#define EMG_WS_AEAD_DEFAULT_KEY_HEX "000102030405060708090a0b0c0d0e0f"

/* Parses a 32-char hex key, or derives a 128-bit key from a passphrase using TinyJAMBU-128. */
bool emg_ws_aead_parse_key(const char *input, uint8_t key[TINYJAMBU_128_KEY_SIZE]);

/* Builds a 96-bit (12-byte) nonce from a 32-bit prefix and a 64-bit monotonic counter (little-endian). */
void emg_ws_aead_make_nonce(uint32_t prefix, uint64_t counter, uint8_t nonce[TINYJAMBU_NONCE_SIZE]);

/* Encrypts a UTF-8 JSON payload into a TinyJAMBU-128 AEAD JSON envelope.
 * Returns number of bytes written (excluding null terminator), or 0 on error/overflow. */
size_t emg_ws_aead_encrypt(const char *plaintext, size_t plen,
                           const char *ad, const uint8_t nonce[TINYJAMBU_NONCE_SIZE],
                           const uint8_t key[TINYJAMBU_128_KEY_SIZE],
                           char *out, size_t cap);

/* Allocates and returns a null-terminated AEAD JSON envelope string (caller must free). */
char *emg_ws_aead_encrypt_alloc(const char *plaintext, size_t plen,
                                const char *ad, uint32_t prefix, uint64_t counter,
                                const uint8_t key[TINYJAMBU_128_KEY_SIZE],
                                size_t *out_len);

/* Authenticates and decrypts a TinyJAMBU-128 AEAD JSON envelope into `out` (null-terminated).
 * Returns true if the envelope structure, associated data, and 64-bit TinyJAMBU tag are valid. */
bool emg_ws_aead_decrypt(const char *envelope, size_t env_len,
                         const char *expected_ad,
                         const uint8_t key[TINYJAMBU_128_KEY_SIZE],
                         char *out, size_t cap);
