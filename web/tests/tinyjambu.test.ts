import { describe, expect, it } from 'vitest';
import rawSnapshot from './fixtures/firmware_snapshot.json';
import {
  DEFAULT_TINYJAMBU_KEY_HEX,
  EMG_WS_AEAD_AD_C2S,
  EMG_WS_AEAD_AD_S2C,
  bytesToHex,
  decryptWsEnvelope,
  encryptWsEnvelope,
  hexToBytes,
  parseTinyJambuKey,
  tinyjambu128Decrypt,
  tinyjambu128Encrypt,
} from '../src/core/tinyjambu';

const KAT_VECTORS = [
  // Count = 1: empty PT, empty AD
  {
    key: '000102030405060708090A0B0C0D0E0F',
    nonce: '000102030405060708090A0B',
    pt: '',
    ad: '',
    ct: 'ED7B37CC6E9BDC7B',
  },
  // Count = 2: empty PT, 1-byte AD
  {
    key: '000102030405060708090A0B0C0D0E0F',
    nonce: '000102030405060708090A0B',
    pt: '',
    ad: '00',
    ct: 'A168945516A77E7E',
  },
  // Count = 37: 1-byte PT, 3-byte AD
  {
    key: '000102030405060708090A0B0C0D0E0F',
    nonce: '000102030405060708090A0B',
    pt: '00',
    ad: '000102',
    ct: '140AC086AE90052F4E',
  },
  // Count = 149: 4-byte PT, 16-byte AD
  {
    key: '000102030405060708090A0B0C0D0E0F',
    nonce: '000102030405060708090A0B',
    pt: '00010203',
    ad: '000102030405060708090A0B0C0D0E0F',
    ct: '30DB0E18ECC2BC513508511B',
  },
  // Count = 250: 7-byte PT (4+3 remainder), 18-byte AD (16+2 remainder)
  {
    key: '000102030405060708090A0B0C0D0E0F',
    nonce: '000102030405060708090A0B',
    pt: '00010203040506',
    ad: '000102030405060708090A0B0C0D0E0F1011',
    ct: 'A34CCF0C62436E96B1C90B9B170C1F',
  },
];

describe('TinyJAMBU-128 AEAD NIST LWC compliance & WebSocket envelope security', () => {
  it('matches official NIST Lightweight Cryptography Known Answer Test (KAT) vectors bit-for-bit', () => {
    for (const v of KAT_VECTORS) {
      const key = hexToBytes(v.key);
      const nonce = hexToBytes(v.nonce);
      const pt = hexToBytes(v.pt);
      const ad = hexToBytes(v.ad);

      const encrypted = tinyjambu128Encrypt(pt, ad, nonce, key);
      expect(bytesToHex(encrypted).toUpperCase()).toBe(v.ct);

      const decrypted = tinyjambu128Decrypt(encrypted, ad, nonce, key);
      expect(decrypted).not.toBeNull();
      expect(bytesToHex(decrypted!).toUpperCase()).toBe(v.pt);
    }
  });

  it('encrypts and authenticates semg_v2 firmware snapshots and commands over WebSocket envelopes', () => {
    const key = parseTinyJambuKey(DEFAULT_TINYJAMBU_KEY_HEX);
    const snapshotJson = JSON.stringify(rawSnapshot);

    const s2cEnvelope = encryptWsEnvelope(snapshotJson, key, 0x53454d47, 1n, EMG_WS_AEAD_AD_S2C);
    const parsedEnvelope = JSON.parse(s2cEnvelope) as Record<string, unknown>;
    expect(parsedEnvelope.type).toBe('aead');
    expect(parsedEnvelope.alg).toBe('tinyjambu-128');
    expect(parsedEnvelope.ad).toBe(EMG_WS_AEAD_AD_S2C);

    const recovered = decryptWsEnvelope(s2cEnvelope, key, EMG_WS_AEAD_AD_S2C);
    expect(JSON.parse(recovered)).toEqual(rawSnapshot);
  });

  it('rejects wrong keys, tampered ciphertexts, and cross-direction reflection attacks', () => {
    const key = parseTinyJambuKey(DEFAULT_TINYJAMBU_KEY_HEX);
    const wrongKey = parseTinyJambuKey('semg-wrong-passphrase');
    const cmdJson = JSON.stringify({
      v: 1,
      id: 42,
      cmd: 'web_start',
      request_id: '22222222-2222-4222-8222-222222222222',
      boot_id: rawSnapshot.boot_id,
      session_id: rawSnapshot.session_id,
    });

    const c2sEnvelope = encryptWsEnvelope(cmdJson, key, 0x12345678, 7n, EMG_WS_AEAD_AD_C2S);

    // Reject wrong key
    expect(() => decryptWsEnvelope(c2sEnvelope, wrongKey, EMG_WS_AEAD_AD_C2S)).toThrow(/TinyJAMBU-128 AEAD/);

    // Reject cross-direction reflection (C2S packet replayed as S2C)
    expect(() => decryptWsEnvelope(c2sEnvelope, key, EMG_WS_AEAD_AD_S2C)).toThrow(/AD/);

    // Reject single-bit tampering in ciphertext/tag
    const envObj = JSON.parse(c2sEnvelope) as { ct: string };
    const lastChar = envObj.ct.slice(-1);
    const tamperedCt = envObj.ct.slice(0, -1) + (lastChar === 'a' ? 'b' : 'a');
    const tamperedEnvelope = JSON.stringify({ ...envObj, ct: tamperedCt });
    expect(() => decryptWsEnvelope(tamperedEnvelope, key, EMG_WS_AEAD_AD_C2S)).toThrow(/TinyJAMBU-128 AEAD/);
  });
});
