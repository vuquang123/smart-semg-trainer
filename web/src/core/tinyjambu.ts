import { z } from 'zod';

export const TINYJAMBU_128_KEY_SIZE = 16;
export const TINYJAMBU_NONCE_SIZE = 12;
export const TINYJAMBU_TAG_SIZE = 8;

export const EMG_WS_AEAD_AD_S2C = 'semg_v2:s2c';
export const EMG_WS_AEAD_AD_C2S = 'semg_v2:c2s';
/** Public development/test key matching firmware default; override in production via device settings and emg_ui_secrets.h. */
export const DEFAULT_TINYJAMBU_KEY_HEX = '000102030405060708090a0b0c0d0e0f';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const aeadEnvelopeSchema = z.object({
  type: z.literal('aead'),
  alg: z.literal('tinyjambu-128'),
  protocol: z.literal(1),
  ad: z.string().min(1).max(64),
  nonce: z.string().regex(/^[0-9a-fA-F]{24}$/),
  ct: z.string().regex(/^[0-9a-fA-F]{16,}$/).refine(s => s.length % 2 === 0),
});

export type AeadEnvelope = z.infer<typeof aeadEnvelopeSchema>;

function leLoad16(buf: Uint8Array, offset: number): number {
  return buf[offset]! | (buf[offset + 1]! << 8);
}

function leLoad32(buf: Uint8Array, offset: number): number {
  return (
    buf[offset]! |
    (buf[offset + 1]! << 8) |
    (buf[offset + 2]! << 16) |
    (buf[offset + 3]! << 24)
  ) >>> 0;
}

function leStore32(buf: Uint8Array, offset: number, x: number): void {
  buf[offset] = x & 0xff;
  buf[offset + 1] = (x >>> 8) & 0xff;
  buf[offset + 2] = (x >>> 16) & 0xff;
  buf[offset + 3] = (x >>> 24) & 0xff;
}

function unpackKey(key: Uint8Array): Uint32Array {
  if (key.length !== TINYJAMBU_128_KEY_SIZE) {
    throw new Error('Khóa TinyJAMBU-128 phải đúng 16 byte (128-bit).');
  }
  const k = new Uint32Array(4);
  k[0] = (~leLoad32(key, 0)) >>> 0;
  k[1] = (~leLoad32(key, 4)) >>> 0;
  k[2] = (~leLoad32(key, 8)) >>> 0;
  k[3] = (~leLoad32(key, 12)) >>> 0;
  return k;
}

export function tinyjambuPermutation128(s: Uint32Array, k: Uint32Array, rounds: number): void {
  let s0 = s[0]! >>> 0;
  let s1 = s[1]! >>> 0;
  let s2 = s[2]! >>> 0;
  let s3 = s[3]! >>> 0;
  const k0 = k[0]! >>> 0;
  const k1 = k[1]! >>> 0;
  const k2 = k[2]! >>> 0;
  const k3 = k[3]! >>> 0;

  for (let r = 0; r < rounds; r++) {
    let t1 = (s1 >>> 15) | (s2 << 17);
    let t2 = (s2 >>> 6) | (s3 << 26);
    let t3 = (s2 >>> 21) | (s3 << 11);
    let t4 = (s2 >>> 27) | (s3 << 5);
    s0 = (s0 ^ t1 ^ (t2 & t3) ^ t4 ^ k0) >>> 0;

    t1 = (s2 >>> 15) | (s3 << 17);
    t2 = (s3 >>> 6) | (s0 << 26);
    t3 = (s3 >>> 21) | (s0 << 11);
    t4 = (s3 >>> 27) | (s0 << 5);
    s1 = (s1 ^ t1 ^ (t2 & t3) ^ t4 ^ k1) >>> 0;

    t1 = (s3 >>> 15) | (s0 << 17);
    t2 = (s0 >>> 6) | (s1 << 26);
    t3 = (s0 >>> 21) | (s1 << 11);
    t4 = (s0 >>> 27) | (s1 << 5);
    s2 = (s2 ^ t1 ^ (t2 & t3) ^ t4 ^ k2) >>> 0;

    t1 = (s0 >>> 15) | (s1 << 17);
    t2 = (s1 >>> 6) | (s2 << 26);
    t3 = (s1 >>> 21) | (s2 << 11);
    t4 = (s1 >>> 27) | (s2 << 5);
    s3 = (s3 ^ t1 ^ (t2 & t3) ^ t4 ^ k3) >>> 0;
  }

  s[0] = s0;
  s[1] = s1;
  s[2] = s2;
  s[3] = s3;
}

function setup128(s: Uint32Array, k: Uint32Array, nonce: Uint8Array, domain: number): void {
  if (nonce.length !== TINYJAMBU_NONCE_SIZE) {
    throw new Error('Nonce TinyJAMBU-128 phải đúng 12 byte (96-bit).');
  }
  s[0] = 0;
  s[1] = 0;
  s[2] = 0;
  s[3] = 0;
  tinyjambuPermutation128(s, k, 8); // TINYJAMBU_ROUNDS(1024)
  for (let offset = 0; offset < 12; offset += 4) {
    s[1] = (s[1]! ^ domain) >>> 0;
    tinyjambuPermutation128(s, k, 5); // TINYJAMBU_ROUNDS(640)
    s[3] = (s[3]! ^ leLoad32(nonce, offset)) >>> 0;
  }
}

function absorb128(s: Uint32Array, k: Uint32Array, data: Uint8Array, domain: number, rounds: number): void {
  let offset = 0;
  let size = data.length;
  while (size >= 4) {
    s[1] = (s[1]! ^ domain) >>> 0;
    tinyjambuPermutation128(s, k, rounds);
    s[3] = (s[3]! ^ leLoad32(data, offset)) >>> 0;
    offset += 4;
    size -= 4;
  }
  if (size === 1) {
    s[1] = (s[1]! ^ domain) >>> 0;
    tinyjambuPermutation128(s, k, rounds);
    s[3] = (s[3]! ^ data[offset]!) >>> 0;
    s[1] = (s[1]! ^ 0x01) >>> 0;
  } else if (size === 2) {
    s[1] = (s[1]! ^ domain) >>> 0;
    tinyjambuPermutation128(s, k, rounds);
    s[3] = (s[3]! ^ leLoad16(data, offset)) >>> 0;
    s[1] = (s[1]! ^ 0x02) >>> 0;
  } else if (size === 3) {
    s[1] = (s[1]! ^ domain) >>> 0;
    tinyjambuPermutation128(s, k, rounds);
    s[3] = (s[3]! ^ (leLoad16(data, offset) | (data[offset + 2]! << 16))) >>> 0;
    s[1] = (s[1]! ^ 0x03) >>> 0;
  }
}

function generateTag128(s: Uint32Array, k: Uint32Array, out: Uint8Array, tagOffset: number): void {
  s[1] = (s[1]! ^ 0x70) >>> 0;
  tinyjambuPermutation128(s, k, 8); // TINYJAMBU_ROUNDS(1024)
  leStore32(out, tagOffset, s[2]!);
  s[1] = (s[1]! ^ 0x70) >>> 0;
  tinyjambuPermutation128(s, k, 5); // TINYJAMBU_ROUNDS(640)
  leStore32(out, tagOffset + 4, s[2]!);
}

export function tinyjambu128Encrypt(
  plaintext: Uint8Array,
  ad: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array,
): Uint8Array {
  const k = unpackKey(key);
  const s = new Uint32Array(4);
  setup128(s, k, nonce, 0x10);
  absorb128(s, k, ad, 0x30, 5);

  const out = new Uint8Array(plaintext.length + TINYJAMBU_TAG_SIZE);
  let offset = 0;
  let mlen = plaintext.length;

  while (mlen >= 4) {
    s[1] = (s[1]! ^ 0x50) >>> 0;
    tinyjambuPermutation128(s, k, 8);
    const mword = leLoad32(plaintext, offset);
    s[3] = (s[3]! ^ mword) >>> 0;
    const cword = (mword ^ s[2]!) >>> 0;
    leStore32(out, offset, cword);
    offset += 4;
    mlen -= 4;
  }

  if (mlen === 1) {
    s[1] = (s[1]! ^ 0x50) >>> 0;
    tinyjambuPermutation128(s, k, 8);
    const data = plaintext[offset]!;
    s[3] = (s[3]! ^ data) >>> 0;
    s[1] = (s[1]! ^ 0x01) >>> 0;
    out[offset] = (s[2]! ^ data) & 0xff;
  } else if (mlen === 2) {
    s[1] = (s[1]! ^ 0x50) >>> 0;
    tinyjambuPermutation128(s, k, 8);
    let data = leLoad16(plaintext, offset);
    s[3] = (s[3]! ^ data) >>> 0;
    s[1] = (s[1]! ^ 0x02) >>> 0;
    data = (data ^ s[2]!) >>> 0;
    out[offset] = data & 0xff;
    out[offset + 1] = (data >>> 8) & 0xff;
  } else if (mlen === 3) {
    s[1] = (s[1]! ^ 0x50) >>> 0;
    tinyjambuPermutation128(s, k, 8);
    let data = leLoad16(plaintext, offset) | (plaintext[offset + 2]! << 16);
    s[3] = (s[3]! ^ data) >>> 0;
    s[1] = (s[1]! ^ 0x03) >>> 0;
    data = (data ^ s[2]!) >>> 0;
    out[offset] = data & 0xff;
    out[offset + 1] = (data >>> 8) & 0xff;
    out[offset + 2] = (data >>> 16) & 0xff;
  }

  generateTag128(s, k, out, plaintext.length);
  return out;
}

export function tinyjambu128Decrypt(
  ciphertextWithTag: Uint8Array,
  ad: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array,
): Uint8Array | null {
  if (ciphertextWithTag.length < TINYJAMBU_TAG_SIZE) {
    return null;
  }
  const k = unpackKey(key);
  const s = new Uint32Array(4);
  setup128(s, k, nonce, 0x10);
  absorb128(s, k, ad, 0x30, 5);

  const mlenTotal = ciphertextWithTag.length - TINYJAMBU_TAG_SIZE;
  const out = new Uint8Array(mlenTotal);
  let offset = 0;
  let clen = mlenTotal;

  while (clen >= 4) {
    s[1] = (s[1]! ^ 0x50) >>> 0;
    tinyjambuPermutation128(s, k, 8);
    const data = (leLoad32(ciphertextWithTag, offset) ^ s[2]!) >>> 0;
    s[3] = (s[3]! ^ data) >>> 0;
    leStore32(out, offset, data);
    offset += 4;
    clen -= 4;
  }

  if (clen === 1) {
    s[1] = (s[1]! ^ 0x50) >>> 0;
    tinyjambuPermutation128(s, k, 8);
    const data = (ciphertextWithTag[offset]! ^ s[2]!) & 0xff;
    s[3] = (s[3]! ^ data) >>> 0;
    s[1] = (s[1]! ^ 0x01) >>> 0;
    out[offset] = data;
    offset += 1;
  } else if (clen === 2) {
    s[1] = (s[1]! ^ 0x50) >>> 0;
    tinyjambuPermutation128(s, k, 8);
    const data = (leLoad16(ciphertextWithTag, offset) ^ s[2]!) & 0xffff;
    s[3] = (s[3]! ^ data) >>> 0;
    s[1] = (s[1]! ^ 0x02) >>> 0;
    out[offset] = data & 0xff;
    out[offset + 1] = (data >>> 8) & 0xff;
    offset += 2;
  } else if (clen === 3) {
    s[1] = (s[1]! ^ 0x50) >>> 0;
    tinyjambuPermutation128(s, k, 8);
    const cword = leLoad16(ciphertextWithTag, offset) | (ciphertextWithTag[offset + 2]! << 16);
    const data = (cword ^ s[2]!) & 0xffffff;
    s[3] = (s[3]! ^ data) >>> 0;
    s[1] = (s[1]! ^ 0x03) >>> 0;
    out[offset] = data & 0xff;
    out[offset + 1] = (data >>> 8) & 0xff;
    out[offset + 2] = (data >>> 16) & 0xff;
    offset += 3;
  }

  const computedTag = new Uint8Array(TINYJAMBU_TAG_SIZE);
  generateTag128(s, k, computedTag, 0);

  let diff = 0;
  for (let i = 0; i < TINYJAMBU_TAG_SIZE; i++) {
    diff |= computedTag[i]! ^ ciphertextWithTag[mlenTotal + i]!;
  }
  if (diff !== 0) {
    out.fill(0);
    return null;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('Chuỗi hex không hợp lệ.');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

const DEFAULT_KEY_BYTES = new Uint8Array([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
]);
const KDF_NONCE = encoder.encode('SEMG-KDF-128');
const KDF_ZEROS = new Uint8Array(8);

export function parseTinyJambuKey(input?: string): Uint8Array {
  const trimmed = (input ?? '').trim();
  if (!trimmed) {
    return new Uint8Array(DEFAULT_KEY_BYTES);
  }
  if (/^[0-9a-fA-F]{32}$/.test(trimmed)) {
    return hexToBytes(trimmed);
  }
  return tinyjambu128Encrypt(KDF_ZEROS, encoder.encode(trimmed), KDF_NONCE, DEFAULT_KEY_BYTES);
}

export function makeTinyJambuNonce(prefix: number, counter: bigint | number): Uint8Array {
  const nonce = new Uint8Array(TINYJAMBU_NONCE_SIZE);
  leStore32(nonce, 0, prefix >>> 0);
  let c = BigInt(counter);
  for (let i = 0; i < 8; i++) {
    nonce[4 + i] = Number(c & 0xffn);
    c >>= 8n;
  }
  return nonce;
}

export function encryptWsEnvelope(
  plainJson: string,
  key: Uint8Array,
  prefix: number,
  counter: bigint | number,
  ad: string = EMG_WS_AEAD_AD_C2S,
): string {
  const nonce = makeTinyJambuNonce(prefix, counter);
  const ct = tinyjambu128Encrypt(encoder.encode(plainJson), encoder.encode(ad), nonce, key);
  return JSON.stringify({
    type: 'aead',
    alg: 'tinyjambu-128',
    protocol: 1,
    ad,
    nonce: bytesToHex(nonce),
    ct: bytesToHex(ct),
  });
}

export function decryptWsEnvelope(
  rawText: string,
  key: Uint8Array,
  expectedAd?: string,
): string {
  const parsedJson: unknown = JSON.parse(rawText);
  const env = aeadEnvelopeSchema.safeParse(parsedJson);
  if (!env.success) {
    throw new Error('Gói tin WebSocket không đúng định dạng bảo mật TinyJAMBU-128 AEAD.');
  }
  if (expectedAd && env.data.ad !== expectedAd) {
    throw new Error('Dữ liệu liên kết (AD) của gói tin TinyJAMBU-128 không khớp chiều truyền.');
  }
  const nonce = hexToBytes(env.data.nonce);
  const ct = hexToBytes(env.data.ct);
  const plainBytes = tinyjambu128Decrypt(ct, encoder.encode(env.data.ad), nonce, key);
  if (!plainBytes) {
    throw new Error('Xác thực TinyJAMBU-128 AEAD thất bại. Kiểm tra khóa bảo mật thiết bị.');
  }
  return decoder.decode(plainBytes);
}
