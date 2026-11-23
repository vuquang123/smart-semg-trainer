const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32Update(crc: number, chunk: Uint8Array): number {
  let c = crc >>> 0;
  for (let i = 0; i < chunk.length; i++) {
    c = CRC_TABLE[(c ^ chunk[i]!) & 0xff]! ^ (c >>> 8);
  }
  return c >>> 0;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function deflateRawStream(chunks: Uint8Array[]): Promise<{ data: Uint8Array; compressed: boolean }> {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  if (total === 0 || typeof CompressionStream !== 'function') {
    return { data: concatBytes(chunks), compressed: false };
  }
  try {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();
    const outChunks: Uint8Array[] = [];

    const readPromise = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) outChunks.push(value);
      }
    })();

    const writePromise = (async () => {
      for (const c of chunks) {
        if (c.byteLength > 0) {
          await writer.write(c as BufferSource);
        }
      }
      await writer.close();
    })();

    await Promise.all([writePromise, readPromise]);
    return { data: concatBytes(outChunks), compressed: true };
  } catch {
    return { data: concatBytes(chunks), compressed: false };
  }
}

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const mins = date.getMinutes();
  const secs = Math.floor(date.getSeconds() / 2);
  return {
    dosTime: ((hours & 0x1f) << 11) | ((mins & 0x3f) << 5) | (secs & 0x1f),
    dosDate: (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f),
  };
}

type ZipRecord = {
  nameBytes: Uint8Array;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  dosTime: number;
  dosDate: number;
  localOffset: number;
  localHeader: Uint8Array;
  payload: Uint8Array;
};

export class ZipWriter {
  private encoder = new TextEncoder();
  private records: ZipRecord[] = [];
  private offset = 0;

  async addEntry(
    name: string,
    content: string | Uint8Array | Uint8Array[],
    modifiedAt = new Date()
  ): Promise<void> {
    const cleanName = name.replace(/^\/+/, '');
    const nameBytes = this.encoder.encode(cleanName);
    const chunks =
      typeof content === 'string'
        ? [this.encoder.encode(content)]
        : content instanceof Uint8Array
          ? [content]
          : content;

    let crc = 0xffffffff;
    let uncompressedSize = 0;
    for (const c of chunks) {
      if (c.byteLength > 0) {
        crc = crc32Update(crc, c);
        uncompressedSize += c.byteLength;
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;

    const { data: payload, compressed } = await deflateRawStream(chunks);
    const method = compressed ? 8 : 0;
    const { dosTime, dosDate } = toDosDateTime(modifiedAt);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true); // PKZIP 2.0
    view.setUint16(6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(8, method, true);
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, payload.byteLength, true);
    view.setUint32(22, uncompressedSize, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const localOffset = this.offset;
    this.offset += localHeader.byteLength + payload.byteLength;

    this.records.push({
      nameBytes,
      crc32: crc,
      compressedSize: payload.byteLength,
      uncompressedSize,
      method,
      dosTime,
      dosDate,
      localOffset,
      localHeader,
      payload,
    });
  }

  build(): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const rec of this.records) {
      parts.push(rec.localHeader, rec.payload);
    }

    const centralStart = this.offset;
    let centralSize = 0;
    for (const rec of this.records) {
      const cd = new Uint8Array(46 + rec.nameBytes.length);
      const view = new DataView(cd.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true); // version made by
      view.setUint16(6, 20, true); // version needed
      view.setUint16(8, 0x0800, true); // UTF-8 flag
      view.setUint16(10, rec.method, true);
      view.setUint16(12, rec.dosTime, true);
      view.setUint16(14, rec.dosDate, true);
      view.setUint32(16, rec.crc32, true);
      view.setUint32(20, rec.compressedSize, true);
      view.setUint32(24, rec.uncompressedSize, true);
      view.setUint16(28, rec.nameBytes.length, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, 0, true);
      view.setUint32(42, rec.localOffset, true);
      cd.set(rec.nameBytes, 46);
      parts.push(cd);
      centralSize += cd.byteLength;
    }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, this.records.length, true);
    ev.setUint16(10, this.records.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralStart, true);
    ev.setUint16(20, 0, true);
    parts.push(eocd);

    return concatBytes(parts);
  }
}
