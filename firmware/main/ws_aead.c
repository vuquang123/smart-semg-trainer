#include "ws_aead.h"
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int hex_nibble(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static void hex_encode(const uint8_t *in, size_t len, char *out) {
    static const char digits[] = "0123456789abcdef";
    for (size_t i = 0; i < len; ++i) {
        out[i * 2]     = digits[(in[i] >> 4) & 0x0FU];
        out[i * 2 + 1] = digits[in[i] & 0x0FU];
    }
    out[len * 2] = '\0';
}

static bool hex_decode(const char *in, size_t hex_len, uint8_t *out) {
    if (hex_len % 2 != 0) return false;
    for (size_t i = 0; i < hex_len; i += 2) {
        int hi = hex_nibble(in[i]);
        int lo = hex_nibble(in[i + 1]);
        if (hi < 0 || lo < 0) return false;
        out[i / 2] = (uint8_t)((hi << 4) | lo);
    }
    return true;
}

bool emg_ws_aead_parse_key(const char *input, uint8_t key[TINYJAMBU_128_KEY_SIZE]) {
    if (!key) return false;
    static const uint8_t default_key[TINYJAMBU_128_KEY_SIZE] = {
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f
    };
    if (!input) {
        memcpy(key, default_key, TINYJAMBU_128_KEY_SIZE);
        return true;
    }
    while (*input && isspace((unsigned char)*input)) ++input;
    size_t len = strlen(input);
    while (len > 0 && isspace((unsigned char)input[len - 1])) --len;
    if (len == 0) {
        memcpy(key, default_key, TINYJAMBU_128_KEY_SIZE);
        return true;
    }
    if (len == 32 && hex_decode(input, 32, key)) {
        return true;
    }
    /* Derive a 128-bit key deterministically from arbitrary passphrase using TinyJAMBU-128 */
    static const uint8_t kdf_nonce[TINYJAMBU_NONCE_SIZE] = {
        'S', 'E', 'M', 'G', '-', 'K', 'D', 'F', '-', '1', '2', '8'
    };
    static const uint8_t zeros[8] = {0};
    size_t clen = 0;
    tinyjambu_128_aead_encrypt(key, &clen, zeros, sizeof(zeros),
                               (const uint8_t *)input, len,
                               kdf_nonce, default_key);
    return clen == TINYJAMBU_128_KEY_SIZE;
}

void emg_ws_aead_make_nonce(uint32_t prefix, uint64_t counter, uint8_t nonce[TINYJAMBU_NONCE_SIZE]) {
    nonce[0] = (uint8_t)(prefix & 0xFFU);
    nonce[1] = (uint8_t)((prefix >> 8) & 0xFFU);
    nonce[2] = (uint8_t)((prefix >> 16) & 0xFFU);
    nonce[3] = (uint8_t)((prefix >> 24) & 0xFFU);
    for (unsigned i = 0; i < 8; ++i) {
        nonce[4 + i] = (uint8_t)((counter >> (i * 8)) & 0xFFU);
    }
}

size_t emg_ws_aead_encrypt(const char *plaintext, size_t plen,
                           const char *ad, const uint8_t nonce[TINYJAMBU_NONCE_SIZE],
                           const uint8_t key[TINYJAMBU_128_KEY_SIZE],
                           char *out, size_t cap) {
    if (!plaintext || !ad || !nonce || !key || !out || cap == 0) return 0;
    size_t ad_len = strlen(ad);
    size_t ct_bytes_len = plen + TINYJAMBU_TAG_SIZE;
    size_t ct_hex_len = ct_bytes_len * 2;
    size_t needed = 96 + ad_len + (TINYJAMBU_NONCE_SIZE * 2) + ct_hex_len;
    if (needed >= cap) {
        out[0] = '\0';
        return 0;
    }

    uint8_t stack_buf[1536];
    uint8_t *ct_buf = ct_bytes_len <= sizeof(stack_buf) ? stack_buf : (uint8_t *)malloc(ct_bytes_len);
    if (!ct_buf) {
        out[0] = '\0';
        return 0;
    }

    size_t actual_clen = 0;
    tinyjambu_128_aead_encrypt(ct_buf, &actual_clen,
                               (const uint8_t *)plaintext, plen,
                               (const uint8_t *)ad, ad_len,
                               nonce, key);

    char nonce_hex[TINYJAMBU_NONCE_SIZE * 2 + 1];
    hex_encode(nonce, TINYJAMBU_NONCE_SIZE, nonce_hex);

    int prefix_len = snprintf(out, cap,
        "{\"type\":\"aead\",\"alg\":\"tinyjambu-128\",\"protocol\":1,\"ad\":\"%s\",\"nonce\":\"%s\",\"ct\":\"",
        ad, nonce_hex);
    if (prefix_len < 0 || (size_t)prefix_len + ct_hex_len + 3 > cap) {
        if (ct_buf != stack_buf) free(ct_buf);
        out[0] = '\0';
        return 0;
    }

    hex_encode(ct_buf, actual_clen, out + prefix_len);
    if (ct_buf != stack_buf) free(ct_buf);

    size_t total = (size_t)prefix_len + actual_clen * 2;
    out[total++] = '"';
    out[total++] = '}';
    out[total] = '\0';
    return total;
}

char *emg_ws_aead_encrypt_alloc(const char *plaintext, size_t plen,
                                const char *ad, uint32_t prefix, uint64_t counter,
                                const uint8_t key[TINYJAMBU_128_KEY_SIZE],
                                size_t *out_len) {
    if (out_len) *out_len = 0;
    if (!plaintext || !ad || !key) return NULL;
    size_t cap = 128 + strlen(ad) + (plen + TINYJAMBU_TAG_SIZE) * 2;
    char *buf = (char *)malloc(cap);
    if (!buf) return NULL;
    uint8_t nonce[TINYJAMBU_NONCE_SIZE];
    emg_ws_aead_make_nonce(prefix, counter, nonce);
    size_t written = emg_ws_aead_encrypt(plaintext, plen, ad, nonce, key, buf, cap);
    if (!written) {
        free(buf);
        return NULL;
    }
    if (out_len) *out_len = written;
    return buf;
}

static bool extract_json_str(const char *json, size_t env_len, const char *field,
                             const char **val_out, size_t *len_out) {
    char pattern[32];
    int pat_len = snprintf(pattern, sizeof(pattern), "\"%s\"", field);
    if (pat_len <= 0 || (size_t)pat_len >= sizeof(pattern)) return false;

    const char *end = json + env_len;
    const char *p = json;
    while (p + pat_len < end) {
        const char *match = strstr(p, pattern);
        if (!match || match + pat_len >= end) return false;
        const char *q = match + pat_len;
        while (q < end && (*q == ' ' || *q == '\t' || *q == '\r' || *q == '\n')) ++q;
        if (q < end && *q == ':') {
            ++q;
            while (q < end && (*q == ' ' || *q == '\t' || *q == '\r' || *q == '\n')) ++q;
            if (q < end && *q == '"') {
                ++q;
                const char *start = q;
                while (q < end && *q != '"') {
                    unsigned char c = (unsigned char)*q;
                    if (c < 32 || c >= 127 || c == '\\') return false;
                    ++q;
                }
                if (q < end && *q == '"') {
                    *val_out = start;
                    *len_out = (size_t)(q - start);
                    return true;
                }
            }
            return false;
        }
        p = match + 1;
    }
    return false;
}

bool emg_ws_aead_decrypt(const char *envelope, size_t env_len,
                         const char *expected_ad,
                         const uint8_t key[TINYJAMBU_128_KEY_SIZE],
                         char *out, size_t cap) {
    if (out && cap > 0) out[0] = '\0';
    if (!envelope || !key || !out || cap == 0) return false;
    if (env_len == 0) env_len = strlen(envelope);

    const char *type_val = NULL, *alg_val = NULL, *ad_val = NULL, *nonce_val = NULL, *ct_val = NULL;
    size_t type_len = 0, alg_len = 0, ad_len = 0, nonce_len = 0, ct_len = 0;

    if (!extract_json_str(envelope, env_len, "type", &type_val, &type_len) ||
        type_len != 4 || memcmp(type_val, "aead", 4) != 0) {
        return false;
    }
    if (!extract_json_str(envelope, env_len, "alg", &alg_val, &alg_len) ||
        alg_len != 13 || memcmp(alg_val, "tinyjambu-128", 13) != 0) {
        return false;
    }
    if (!extract_json_str(envelope, env_len, "ad", &ad_val, &ad_len)) {
        return false;
    }
    if (expected_ad) {
        size_t exp_len = strlen(expected_ad);
        if (ad_len != exp_len || memcmp(ad_val, expected_ad, exp_len) != 0) {
            return false;
        }
    }
    if (!extract_json_str(envelope, env_len, "nonce", &nonce_val, &nonce_len) ||
        nonce_len != TINYJAMBU_NONCE_SIZE * 2) {
        return false;
    }
    if (!extract_json_str(envelope, env_len, "ct", &ct_val, &ct_len) ||
        ct_len < TINYJAMBU_TAG_SIZE * 2 || (ct_len % 2) != 0) {
        return false;
    }

    size_t ct_bytes_len = ct_len / 2;
    size_t plen = ct_bytes_len - TINYJAMBU_TAG_SIZE;
    if (plen + 1 > cap) return false;

    uint8_t nonce[TINYJAMBU_NONCE_SIZE];
    if (!hex_decode(nonce_val, nonce_len, nonce)) return false;

    uint8_t stack_buf[1536];
    uint8_t *ct_buf = ct_bytes_len <= sizeof(stack_buf) ? stack_buf : (uint8_t *)malloc(ct_bytes_len);
    if (!ct_buf) return false;

    if (!hex_decode(ct_val, ct_len, ct_buf)) {
        if (ct_buf != stack_buf) free(ct_buf);
        return false;
    }

    size_t mlen = 0;
    int rc = tinyjambu_128_aead_decrypt((uint8_t *)out, &mlen,
                                        ct_buf, ct_bytes_len,
                                        (const uint8_t *)ad_val, ad_len,
                                        nonce, key);
    if (ct_buf != stack_buf) free(ct_buf);

    if (rc != 0) {
        out[0] = '\0';
        return false;
    }
    out[mlen] = '\0';
    return true;
}
