import 'fake-indexeddb/auto';
import { PDFDocument } from 'pdf-lib';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExportModal } from '../src/components/ExportModal';
import { TrainingSettings } from '../src/components/TrainingSettings';
import { TrainerController } from '../src/core/controller';
import { SimulationEngine } from '../src/core/engine';
import { defaults, uid, type Frame, type RawChunk, type SessionRecord } from '../src/core/protocol';
import { buildExportFilename, buildExportModel } from '../src/storage/exportModel';
import { buildReportPdf, type PdfReportFonts } from '../src/storage/pdfReport';
import { Repository } from '../src/storage/repository';
import { buildResearchZip } from '../src/storage/researchExport';
import { buildReportXlsx } from '../src/storage/xlsxReport';
import { mapFirmwarePacket, mapFirmwareRawBatch } from '../src/transports/firmwareMapper';
import { MockTransport } from '../src/transports/mock';

let fonts: PdfReportFonts;

beforeAll(async () => {
  const fsModuleId = 'node:fs/promises';
  const fs = (await import(/* @vite-ignore */ fsModuleId)) as {
    readFile: (p: URL) => Promise<Uint8Array>;
  };
  const [reg, bold] = await Promise.all([
    fs.readFile(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url)),
    fs.readFile(new URL('../public/fonts/DejaVuSans-Bold.ttf', import.meta.url)),
  ]);
  fonts = {
    regular: new Uint8Array(reg),
    bold: new Uint8Array(bold),
  };
});

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  const readPromise = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) chunks.push(value);
    }
  })();
  await writer.write(compressed as BufferSource);
  await writer.close();
  await readPromise;
  const total = chunks.reduce((s, c) => s + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Independent PKZIP 2.0 parser + Web Streams raw inflate to verify genuine ZIP/XLSX archives. */
async function parseZipArchive(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  expect(eocdOffset).toBeGreaterThanOrEqual(0);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder('utf-8');
  const map = new Map<string, Uint8Array>();

  let ptr = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    expect(view.getUint32(ptr, true)).toBe(0x02014b50);
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const uncompSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const lhNameLen = view.getUint16(localOffset + 26, true);
    const lhExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compSize);
    const raw = method === 8 ? await inflateRawBytes(compressed) : new Uint8Array(compressed);
    expect(raw.byteLength).toBe(uncompSize);
    map.set(name, raw);
  }
  return map;
}

function makeTestRecord(overrides?: {
  frame?: Partial<Frame>;
  samples?: SessionRecord['samples'];
  gaps?: number;
  config_history?: SessionRecord['config_history'];
  raw_summary?: SessionRecord['raw_summary'];
}): SessionRecord {
  const e = new SimulationEngine(defaults, 1);
  const baseFrame: Frame = {
    ...e.snapshot(),
    state: 'stopped',
    phase: 'idle',
    duration_ms: 12000,
    t_ms: 14500,
    ...overrides?.frame,
  };
  return {
    id: baseFrame.session_id,
    snapshot: baseFrame,
    samples: overrides?.samples ?? [],
    gaps: overrides?.gaps ?? 0,
    updated_at: new Date().toISOString(),
    revision: baseFrame.sequence,
    sync: 'local',
    config_history: overrides?.config_history,
    raw_summary: overrides?.raw_summary,
  };
}

describe('Training Report & Research RAW Export Upgrade', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles zero contractions and target = 0 without NaN or Infinity across model, PDF, Excel, and ZIP', async () => {
    const rec = makeTestRecord({
      frame: {
        settings: { ...defaults, target: 0 as unknown as number },
        total_count: 0,
        valid_count: 0,
        repetitions: [],
        state: 'stopped',
      },
    });
    const model = buildExportModel(rec);
    expect(model.target).toBe(0);
    expect(model.goalCompletionRatio).toBeNull();
    expect(model.goalCompletionPct).toBeNull();
    expect(model.validRateRatio).toBeNull();
    expect(model.validRatePct).toBeNull();
    expect(model.goalStatusVi).toContain('mục tiêu = 0');

    const pdfBytes = await buildReportPdf(model, fonts);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    expect(pdfDoc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(new TextDecoder().decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');

    const xlsxBytes = await buildReportXlsx(model);
    const xlsxEntries = await parseZipArchive(xlsxBytes);
    expect(xlsxEntries.has('xl/worksheets/sheet1.xml')).toBe(true);
    expect(xlsxEntries.has('xl/worksheets/sheet2.xml')).toBe(true);
    expect(xlsxEntries.has('xl/worksheets/sheet3.xml')).toBe(false); // No signal series -> no fake chart sheet
    const wbXml = new TextDecoder().decode(xlsxEntries.get('xl/workbook.xml')!);
    expect(wbXml).toContain('Tổng kết');
    expect(wbXml).toContain('Từng lần co cơ');
    expect(wbXml).not.toContain('Dữ liệu biểu đồ');
    const sheet1 = new TextDecoder().decode(xlsxEntries.get('xl/worksheets/sheet1.xml')!);
    expect(sheet1).not.toContain('NaN');
    expect(sheet1).not.toContain('Infinity');
    expect(sheet1).toContain('Không xác định (mẫu số = 0)');

    const zipRes = await buildResearchZip(model);
    const zipEntries = await parseZipArchive(zipRes.bytes);
    const meta = JSON.parse(new TextDecoder().decode(zipEntries.get('metadata.json')!));
    expect(meta.events_convention.summary_counts.goal_completion_pct).toBeNull();
    expect(meta.events_convention.summary_counts.valid_rate_pct).toBeNull();
    expect(meta.sampling.raw_available).toBe(false);
  });

  it('distinguishes goal completion vs valid rate and never marks completed replay EOF below target as goal met', () => {
    // Goal exceeded: 7 valid out of target 5, total 10 -> goal = 140% (bar capped at 100%), valid rate = 70%
    const reps7of10 = Array.from({ length: 10 }, (_, i) => ({
      id: uid(),
      ordinal: i + 1,
      ended_ms: (i + 1) * 2000,
      hold_ms: i < 7 ? 800 : 250,
      rest_ms: 900,
      in_zone_ms: 0,
      valid: i < 7,
    }));
    const exceeded = buildExportModel(
      makeTestRecord({
        frame: {
          settings: { ...defaults, target: 5 },
          valid_count: 7,
          total_count: 10,
          repetitions: reps7of10,
          state: 'completed',
        },
      })
    );
    expect(exceeded.goalCompletionPct).toBeCloseTo(140, 2);
    expect(exceeded.goalProgressBarPct).toBe(100);
    expect(exceeded.validRatePct).toBeCloseTo(70, 2);
    expect(exceeded.goalMet).toBe(true);
    expect(exceeded.goalStatusVi).toBe('Vượt mục tiêu');

    // Replay ended with state='completed' (EOF) while valid_count=1 < target=5 -> MUST NOT say Đạt mục tiêu!
    const replayEof = buildExportModel(
      makeTestRecord({
        frame: {
          source: 'replay',
          fs_hz: 2048,
          settings: { ...defaults, target: 5 },
          valid_count: 1,
          total_count: 2,
          repetitions: [
            { id: uid(), ordinal: 1, ended_ms: 6000, hold_ms: 900, rest_ms: 500, in_zone_ms: 0, valid: true },
            { id: uid(), ordinal: 2, ended_ms: 11000, hold_ms: 200, rest_ms: 1000, in_zone_ms: 0, valid: false },
          ],
          state: 'completed',
        },
      })
    );
    expect(replayEof.goalMet).toBe(false);
    expect(replayEof.goalStatusVi).toBe('Chưa đạt mục tiêu');
    expect(replayEof.goalCompletionPct).toBeCloseTo(20, 2);
    expect(replayEof.validRatePct).toBeCloseTo(50, 2);
  });

  it('captures incomplete contraction when stopped mid-contraction without inflating confirmed counts', async () => {
    const e = new SimulationEngine({ ...defaults, target: 5, min_hold_ms: 1000 }, 1);
    e.execute({ type: 'command', protocol: 1, command_id: uid(), session_id: e.frame.session_id, action: 'calibrate', settings: { ...defaults, target: 5, min_hold_ms: 1000 } });
    e.advance(2500);
    e.execute({ type: 'command', protocol: 1, command_id: uid(), session_id: e.frame.session_id, action: 'start', settings: { ...defaults, target: 5, min_hold_ms: 1000 } });
    // Advance until right inside a contraction (t=1000..1500ms of training cycle)
    e.advance(1400);
    expect(e.frame.phase).toBe('hold');
    const stopAck = e.execute({ type: 'command', protocol: 1, command_id: uid(), session_id: e.frame.session_id, action: 'stop' });
    expect(stopAck.snapshot.state).toBe('stopped');
    expect(stopAck.snapshot.total_count).toBe(0);
    expect(stopAck.snapshot.valid_count).toBe(0);
    expect(stopAck.snapshot.incomplete_contraction).toBeTruthy();
    expect(stopAck.snapshot.incomplete_contraction?.reason_code).toBe('stopped_mid_contraction');

    const model = buildExportModel(makeTestRecord({ frame: stopAck.snapshot }));
    expect(model.totalCount).toBe(0);
    expect(model.incompleteCount).toBe(1);
    expect(model.events).toHaveLength(1);
    expect(model.events[0]!.status).toBe('incomplete');
    expect(model.events[0]!.statusVi).toBe('Chưa hoàn tất');
    expect(model.events[0]!.reasonCode).toBe('stopped_mid_contraction');

    const zipRes = await buildResearchZip(model);
    const entries = await parseZipArchive(zipRes.bytes);
    const eventsCsv = new TextDecoder().decode(entries.get('events.csv')!);
    expect(eventsCsv).toContain('incomplete,stopped_mid_contraction,algorithm_predicted');
  });

  it('exports a consistent frozen snapshot for an in-progress session with clear warning', async () => {
    const e = new SimulationEngine(defaults, 1);
    e.execute({ type: 'command', protocol: 1, command_id: uid(), session_id: e.frame.session_id, action: 'calibrate', settings: defaults });
    e.advance(2500);
    e.execute({ type: 'command', protocol: 1, command_id: uid(), session_id: e.frame.session_id, action: 'start', settings: defaults });
    e.advance(2500);
    const rec = makeTestRecord({
      frame: e.snapshot(),
      samples: [{ t_ms: 2600, rms: 32, on_threshold: 140, off_threshold: 85 }],
    });
    const model = buildExportModel(rec);
    expect(model.isInProgress).toBe(true);
    expect(model.sessionStateLabelVi).toContain('Phiên chưa kết thúc');

    const xlsx = await buildReportXlsx(model);
    const sheet1 = new TextDecoder().decode((await parseZipArchive(xlsx)).get('xl/worksheets/sheet1.xml')!);
    expect(sheet1).toContain('Phiên chưa kết thúc');
  });

  it('supports legacy summary-only sessions without generating fake chart or fake events', async () => {
    const legacy = makeTestRecord({
      frame: {
        total_count: 6,
        valid_count: 4,
        repetitions: [],
        state: 'stopped',
        started_at_estimated: true,
      },
      samples: [],
    });
    // Force summary-only scenario where total_count > 0 even without repetition ledger
    const model = buildExportModel(legacy);
    expect(model.hasSignalSeries).toBe(false);
    expect(model.missingEventDetails).toBe(true);
    expect(model.missingDataNotes.length).toBeGreaterThanOrEqual(2);

    const xlsx = await buildReportXlsx(model);
    const xlsxMap = await parseZipArchive(xlsx);
    expect(xlsxMap.has('xl/worksheets/sheet3.xml')).toBe(false);

    const pdf = await buildReportPdf(model, fonts);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);

    const zip = await buildResearchZip(model, { includeProcessed: true });
    const zipMap = await parseZipArchive(zip.bytes);
    expect(zipMap.has('signal_raw.csv')).toBe(false);
    expect(zipMap.has('signal_processed.csv')).toBe(false);
    expect(zipMap.has('events.csv')).toBe(true);
    expect(zipMap.has('metadata.json')).toBe(true);
    expect(zipMap.has('README.txt')).toBe(true);
  });

  it('exports 1CH vs 2CH raw data, ADC calibration vs uncalibrated nulls, and replay metadata honestly', async () => {
    // 1. 1CH real sensor (calibrated) via firmwareMapper
    const fwSnap = mapFirmwarePacket({
      type: 'snapshot',
      protocol: 1,
      format: 'semg_v2',
      firmware_version: '0.3.0',
      boot_id: '33333333-3333-4333-8333-333333333333',
      session_id: 7,
      sequence: 20,
      t_ms: 5000,
      duration_ms: 2500,
      state: 'stopped',
      phase: 'idle',
      paused: false,
      raw_recording: true,
      source: 'sensor',
      signal_kind: 'RAW',
      fs_hz: 2048,
      unit: 'uV',
      conversion: {
        uV_per_unit: 2.01465,
        offset_uV: 0,
        reference: 'ESP32 ADC1 GPIO34 (eFuse TP) + INA333/MCP601',
        bias: 0,
        scale: 805.86,
        gain: 400,
        calibrated: true,
      },
      adc_config: {
        resolution_bits: 12,
        atten_db: 12,
        hw_sample_rate_hz: 32768,
        oversampling_ratio: 16,
        sampling_mode: 'single_channel_dma',
        gpio: 34,
        analog_frontend: 'INA333/MCP601 AFE',
        analog_gain: 400,
        analog_bandpass_hz: null,
        clip_count: 0,
      },
      dsp_config: {
        highpass_hz: 20,
        lowpass_hz: 450,
        notch_hz: 0,
        notch_q: 30,
        rms_ms: 100.1,
        cal_ms: 5000,
        settle_ms: 500,
        on_ms: 125,
        off_ms: 218.75,
        dc_offset_ch1: 4125.5,
      },
      health: {
        discontinuities: 0,
        tx_dropped: 0,
        backlog_ticks: 0,
        max_dsp_us: 420,
        raw_dropped_samples: 0,
        raw_overflow_events: 0,
        tracking_supported: true,
      },
      settings: { ...defaults, channel: 1, muscle: 'forearm' },
      channels: [{ id: 1, rms: 45, filtered: -18.5, on_threshold: 120, off_threshold: 70 }],
      valid_count: 1,
      total_count: 1,
      current_hold_ms: 0,
      last_hold_ms: 750,
      current_rest_ms: 400,
      current_in_zone_ms: 0,
      longest_in_zone_ms: 0,
      calibration_progress: 1,
      activation_pct: 15,
      activation_level: 'low',
      target_zone: 'unavailable',
      fault: '',
      repetitions: [
        {
          ordinal: 1,
          channel: 1,
          started_ms: 3500,
          ended_ms: 4250,
          hold_ms: 750,
          rest_ms: 1000,
          in_zone_ms: 0,
          start_sample_index: 7168,
          end_sample_index: 8704,
          rms_mean: 165.4,
          rms_peak: 212.8,
          reason_code: null,
          label_source: 'algorithm_predicted',
          valid: true,
        },
      ],
    });

    const adcCodes = new Uint16Array([2048, 2100, 1996, 2050]);
    const rawBatchB64 = bytesToBase64(new Uint8Array(adcCodes.buffer));
    const mappedBatch = mapFirmwareRawBatch({
      type: 'raw_batch',
      protocol: 1,
      boot_id: '33333333-3333-4333-8333-333333333333',
      session_id: 7,
      first_sample: 0,
      frames: 4,
      channels: 1,
      fs_hz: 2048,
      encoding: 'uint16_adc',
      dropped_before: 0,
      data_b64: rawBatchB64,
    });
    expect(mappedBatch).not.toBeNull();
    expect(mappedBatch!.session_id).toBe(fwSnap.session_id);

    const chunk1Ch: RawChunk = {
      key: `${fwSnap.session_id}/0000000000`,
      session_id: fwSnap.session_id,
      chunk_seq: 0,
      first_sample_index: 0,
      sample_count: 4,
      channels: 1,
      fs_hz: 2048,
      encoding: 'uint16_adc',
      data: adcCodes.buffer.slice(0),
    };
    const model1Ch = buildExportModel(
      makeTestRecord({
        frame: fwSnap,
        samples: [
          { t_ms: 3600, rms: 160, filtered: -42.5, on_threshold: 120, off_threshold: 70 },
          { t_ms: 4000, rms: 212.8, filtered: 88.2, on_threshold: 120, off_threshold: 70 },
        ],
      })
    );
    const zip1Ch = await parseZipArchive((await buildResearchZip(model1Ch, { rawChunks: [chunk1Ch], includeProcessed: true })).bytes);
    const rawCsv1 = new TextDecoder().decode(zip1Ch.get('signal_raw.csv')!);
    expect(rawCsv1.split('\n')[0]).toBe('sample_index,time_s,ch1_adc,ch1_uV');
    expect(rawCsv1).not.toContain('ch2_');
    const procCsv1 = new TextDecoder().decode(zip1Ch.get('signal_processed.csv')!);
    expect(procCsv1.split('\n')[0]).toBe('processed_index,time_s,time_ms,sample_index,channel,electrode_muscle,ch1_filtered,ch1_rms_envelope,on_threshold,off_threshold,activation_pct,target_zone');
    expect(procCsv1).toContain(',CH1,forearm,-42.5,160,');
    const meta1 = JSON.parse(new TextDecoder().decode(zip1Ch.get('metadata.json')!));
    expect(meta1.analog_and_adc.analog_bandpass_hz).toBeNull();
    expect(meta1.analog_and_adc.calibration.formula_adc_to_uV).toContain('uV_per_unit');
    expect(meta1.software.firmware_version).toBe('0.3.0');
    expect(meta1.data_integrity.raw_loss_tracking).toBe('tracked_by_source_sample_index');
    expect(meta1.sampling.channel_count).toBe(1);
    expect(meta1.sampling.signal_representations_on_ch1.filtered_signal.column).toBe('ch1_filtered');
    expect(meta1.sampling.signal_representations_on_ch1.rms_envelope.column).toBe('ch1_rms_envelope');

    // 2. 1CH uncalibrated ADC (unit='ADC', no conversion) -> MUST NOT fabricate ch1_uV!
    const uncalFrame: Frame = { ...fwSnap, unit: 'ADC', conversion: undefined };
    const zipUncal = await parseZipArchive((await buildResearchZip(buildExportModel(makeTestRecord({ frame: uncalFrame })), { rawChunks: [chunk1Ch] })).bytes);
    const rawCsvUncal = new TextDecoder().decode(zipUncal.get('signal_raw.csv')!);
    expect(rawCsvUncal.split('\n')[0]).toBe('sample_index,time_s,ch1_adc');
    const metaUncal = JSON.parse(new TextDecoder().decode(zipUncal.get('metadata.json')!));
    expect(metaUncal.analog_and_adc.calibration).toBeNull();

    // 3. 1CH simulation + missing RAW gap detection (sample_index jumps from 1 to 150 -> 148 missing)
    const sim1 = new SimulationEngine(defaults).snapshot();
    const ch1CodesA = new Uint16Array([2048, 2055]); // 2 frames * 1 ch
    const ch1CodesB = new Uint16Array([2100, 2110]); // jumps to first_sample_index=150
    const model1Sim = buildExportModel(makeTestRecord({ frame: { ...sim1, raw_recording: true } }));
    const zipSim = await parseZipArchive(
      (
        await buildResearchZip(model1Sim, {
          rawChunks: [
            { key: `${sim1.session_id}/0`, session_id: sim1.session_id, chunk_seq: 0, first_sample_index: 0, sample_count: 2, channels: 1, fs_hz: 1000, encoding: 'uint16_adc', data: ch1CodesA.buffer.slice(0) },
            { key: `${sim1.session_id}/1`, session_id: sim1.session_id, chunk_seq: 1, first_sample_index: 150, sample_count: 2, channels: 1, fs_hz: 1000, encoding: 'uint16_adc', data: ch1CodesB.buffer.slice(0) },
          ],
        })
      ).bytes
    );
    const rawCsv2 = new TextDecoder().decode(zipSim.get('signal_raw.csv')!);
    const lines2 = rawCsv2.trim().split('\n');
    expect(lines2[0]).toBe('sample_index,time_s,ch1_adc');
    expect(rawCsv2).not.toContain('ch2_');
    expect(lines2).toHaveLength(5); // header + 4 real rows; NO fabricated rows between 1 and 150!
    expect(lines2[2]!.startsWith('1,')).toBe(true);
    expect(lines2[3]!.startsWith('150,0.150000,')).toBe(true);
    const meta2 = JSON.parse(new TextDecoder().decode(zipSim.get('metadata.json')!));
    expect(meta2.sampling.channel_count).toBe(1);
    expect(meta2.electrode_placement.muscle).toBe('forearm');
    expect(meta2.data_integrity.raw_missing_samples).toBe(148);
    expect(meta2.data_integrity.raw_gap_events).toBe(1);

    // 4. Replay metadata provenance
    const replayFrame: Frame = {
      ...fwSnap,
      source: 'replay',
      conversion: undefined,
      adc_config: { sampling_mode: 'single_channel_replay', hw_sample_rate_hz: 2048, oversampling_ratio: 1, resolution_bits: null, atten_db: null, gpio: null, analog_frontend: null, analog_gain: null, analog_bandpass_hz: null, clip_count: 0 },
      replay_info: {
        dataset_name: 'GRABMyo',
        dataset_version: '1.1.0',
        doi: '10.13026/89dm-f662',
        channel_name: 'F1',
        segment_description: 'rest (5s) -> active (5s) -> rest (5s), 30720 samples @ 2048 Hz',
        total_samples: 30720,
        license: 'CC BY 4.0',
      },
    };
    const zipReplay = await parseZipArchive((await buildResearchZip(buildExportModel(makeTestRecord({ frame: replayFrame })))).bytes);
    const metaReplay = JSON.parse(new TextDecoder().decode(zipReplay.get('metadata.json')!));
    expect(metaReplay.source).toBe('replay');
    expect(metaReplay.replay_source.dataset_name).toBe('GRABMyo');
    expect(metaReplay.replay_source.channel_name).toBe('F1');
  });

  it('records threshold changes mid-session and verifies cross-file consistency across PDF, Excel, and Research ZIP', async () => {
    const samples: SessionRecord['samples'] = [
      { t_ms: 500, rms: 30, filtered: -12.4, on_threshold: 140, off_threshold: 85, activation_pct: 10, target_zone: 'below' },
      { t_ms: 1500, rms: 220, filtered: 145.6, on_threshold: 140, off_threshold: 85, activation_pct: 73, target_zone: 'above' },
      { t_ms: 2500, rms: 28, filtered: 9.1, on_threshold: 165, off_threshold: 95, activation_pct: 9, target_zone: 'below' },
      { t_ms: 2501, rms: null, filtered: null, on_threshold: 165, off_threshold: 95 },
      { t_ms: 3500, rms: 195, filtered: -88.7, on_threshold: 165, off_threshold: 95, activation_pct: 65, target_zone: 'inside' },
    ];
    const rec = makeTestRecord({
      frame: {
        duration_ms: 3500,
        valid_count: 1,
        total_count: 1,
        channels: [{ id: 1, rms: 195, on_threshold: 165, off_threshold: 95 }],
        repetitions: [
          { id: uid(), ordinal: 1, channel: 1, started_ms: 1200, ended_ms: 2100, hold_ms: 900, rest_ms: 500, in_zone_ms: 0, start_sample_index: 1200, end_sample_index: 2100, rms_mean: 220, rms_peak: 220, reason_code: null, label_source: 'algorithm_predicted', valid: true },
        ],
      },
      samples,
      gaps: 1,
      config_history: [
        { t_ms: 0, recorded_at: new Date().toISOString(), event: 'session_start', channel: 1, on_threshold: 140, off_threshold: 85, min_hold_ms: 500, target: 5, zone_enabled: false },
        { t_ms: 2500, recorded_at: new Date().toISOString(), event: 'threshold_change', channel: 1, on_threshold: 165, off_threshold: 95, min_hold_ms: 500, target: 5, zone_enabled: false },
      ],
    });
    const model = buildExportModel(rec);
    expect(model.thresholdHistory).toHaveLength(2);
    expect(model.thresholdHistory[1]!.onThreshold).toBe(165);

    const filenamePdf = buildExportFilename(model, 'pdf');
    const filenameXlsx = buildExportFilename(model, 'xlsx');
    const filenameZip = buildExportFilename(model, 'zip');
    expect(filenamePdf).toMatch(/^sEMG_\d{4}-\d{2}-\d{2}_\d{6}_[a-zA-Z0-9]+_report\.pdf$/);
    expect(filenameXlsx).toMatch(/^sEMG_\d{4}-\d{2}-\d{2}_\d{6}_[a-zA-Z0-9]+_report\.xlsx$/);
    expect(filenameZip).toMatch(/^sEMG_\d{4}-\d{2}-\d{2}_\d{6}_[a-zA-Z0-9]+_research\.zip$/);

    // Excel 3 sheets + numeric cells + freeze + autofilter + cols + Vietnamese
    const xlsxMap = await parseZipArchive(await buildReportXlsx(model));
    expect(xlsxMap.has('xl/worksheets/sheet3.xml')).toBe(true);
    const sheet2 = new TextDecoder().decode(xlsxMap.get('xl/worksheets/sheet2.xml')!);
    const sheet3 = new TextDecoder().decode(xlsxMap.get('xl/worksheets/sheet3.xml')!);
    expect(sheet2).toContain('<pane ySplit="1"');
    expect(sheet2).toContain('<autoFilter ');
    expect(sheet2).toContain('<cols>');
    expect(sheet2).toContain('t="n"');
    const sheet1 = new TextDecoder().decode(xlsxMap.get('xl/worksheets/sheet1.xml')!);
    expect(sheet3).toContain('Tín hiệu lọc CH1');
    expect(sheet3).toContain('RMS / Envelope CH1');
    expect(sheet1).not.toContain('CH2');
    expect(sheet2).not.toContain('CH2');
    expect(sheet3).not.toContain('CH2');
    expect(sheet3).toContain('<row r="5"><c r="A5"');
    expect(sheet3).not.toContain('r="E5"'); // null gap row 5 omits filtered & RMS numeric cells cleanly (no >null<)
    expect(sheet3).not.toContain('r="F5"');
    expect(sheet3).not.toContain('>null<');

    // PDF valid + Vietnamese diacritics + multi-page table pagination check (40 events)
    const manyReps = Array.from({ length: 40 }, (_, i) => ({
      id: uid(),
      ordinal: i + 1,
      channel: 1 as const,
      started_ms: i * 1500 + 200,
      ended_ms: i * 1500 + 1000,
      hold_ms: i % 3 === 0 ? 300 : 800,
      rest_ms: 500,
      in_zone_ms: 0,
      start_sample_index: (i * 1500 + 200) * 2,
      end_sample_index: (i * 1500 + 1000) * 2,
      rms_mean: 180,
      rms_peak: 240,
      reason_code: (i % 3 === 0 ? 'short_hold' : null) as 'short_hold' | null,
      label_source: 'algorithm_predicted' as const,
      valid: i % 3 !== 0,
    }));
    const multiPageModel = buildExportModel(
      makeTestRecord({
        frame: {
          duration_ms: 60000,
          valid_count: manyReps.filter(r => r.valid).length,
          total_count: manyReps.length,
          repetitions: manyReps,
        },
        samples,
      })
    );
    const pdfBytes = await buildReportPdf(multiPageModel, fonts);
    const loadedPdf = await PDFDocument.load(pdfBytes);
    expect(loadedPdf.getPageCount()).toBeGreaterThanOrEqual(2);
    // Verify DejaVuSans embeds Vietnamese characters without encoding errors
    const probeDoc = await PDFDocument.create();
    probeDoc.registerFontkit((await import('@pdf-lib/fontkit')).default);
    const fnt = await probeDoc.embedFont(fonts.regular, { subset: true });
    expect(() => fnt.encodeText('ăâđêôơưĂÂĐÊÔƠƯ ệộử µV – — ≥ ≤')).not.toThrow();

    // Research ZIP consistency
    const zipMap = await parseZipArchive((await buildResearchZip(model, { includeProcessed: true })).bytes);
    const eventsLines = new TextDecoder().decode(zipMap.get('events.csv')!).trim().split('\n');
    const procLines = new TextDecoder().decode(zipMap.get('signal_processed.csv')!).trim().split('\n');
    const meta = JSON.parse(new TextDecoder().decode(zipMap.get('metadata.json')!));
    const eventsText = new TextDecoder().decode(zipMap.get('events.csv')!);
    const procText = new TextDecoder().decode(zipMap.get('signal_processed.csv')!);
    expect(eventsLines).toHaveLength(1 + model.events.length);
    expect(procLines).toHaveLength(1 + samples.length);
    expect(eventsText).not.toContain('CH2');
    expect(procText).not.toContain('ch2_');
    expect(procLines[0]).toContain('ch1_filtered,ch1_rms_envelope');
    expect(meta.digital_processing.threshold_change_points).toHaveLength(2);
    expect(meta.events_convention.summary_counts.valid).toBe(1);
    expect(meta.events_convention.summary_counts.total_recorded).toBe(1);
    const readme = new TextDecoder().decode(zipMap.get('README.txt')!);
    expect(readme).toContain('algorithm_predicted');
    expect(readme).toContain('readtable');
    expect(readme).toContain('pd.read_csv');
    expect(readme).toContain('cùng một kênh CH1');
    expect(readme).not.toContain('CH2');
    expect(readme).not.toContain('ch2_');
  });

  it('handles a long 60s @ 2048 Hz (122,880 samples) session cleanly via chunked IndexedDB and streaming ZIP', async () => {
    const repo = new Repository(uid());
    const sessionId = uid();
    const fsHz = 2048;
    const totalSamples = 60 * fsHz; // 122,880 samples
    const chunkSize = 1024;
    const chunks: RawChunk[] = [];
    for (let offset = 0, seq = 0; offset < totalSamples; offset += chunkSize, seq++) {
      const count = Math.min(chunkSize, totalSamples - offset);
      const arr = new Uint16Array(count);
      for (let i = 0; i < count; i++) arr[i] = 2048 + ((offset + i) % 100) - 50;
      chunks.push({
        key: `${sessionId}/${String(seq).padStart(10, '0')}`,
        session_id: sessionId,
        chunk_seq: seq,
        first_sample_index: offset,
        sample_count: count,
        channels: 1,
        fs_hz: fsHz,
        encoding: 'uint16_adc',
        data: arr.buffer,
      });
    }
    await repo.appendRawChunks(chunks);

    const rec = makeTestRecord({
      frame: {
        session_id: sessionId,
        source: 'sensor',
        unit: 'ADC',
        fs_hz: fsHz,
        duration_ms: 60000,
        raw_recording: true,
      },
      raw_summary: {
        enabled: true,
        available: true,
        encoding: 'uint16_adc',
        fs_hz: fsHz,
        channel_count: 1,
        sample_count: totalSamples,
        chunk_count: chunks.length,
        bytes_stored: totalSamples * 2,
        tracking_method: 'source_sample_index',
        missing_samples_detected: 0,
        gap_events: 0,
        overflow_events: 0,
      },
    });
    await repo.save(rec);

    const zipRes = await buildResearchZip(buildExportModel(rec), { repository: repo });
    expect(zipRes.rawIncluded).toBe(true);
    expect(zipRes.rawSampleCount).toBe(totalSamples);
    const zipMap = await parseZipArchive(zipRes.bytes);
    const rawLines = new TextDecoder().decode(zipMap.get('signal_raw.csv')!).trim().split('\n');
    expect(rawLines).toHaveLength(1 + totalSamples);
    expect(rawLines.at(-1)!).toMatch(/^122879,/);
  });

  it('captures raw chunks end-to-end through TrainerController and MockTransport when opt-in is enabled', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const repo = new Repository(uid());
    const ctrl = new TrainerController(repo, true);
    const mock = new MockTransport(1, defaults);
    const pConn = ctrl.connect(mock);
    await vi.advanceTimersByTimeAsync(200);
    await pConn;

    const pCal = ctrl.command('calibrate', defaults);
    await vi.advanceTimersByTimeAsync(200);
    await pCal;
    await vi.advanceTimersByTimeAsync(2600);

    const pStart = ctrl.command('start', defaults);
    await vi.advanceTimersByTimeAsync(200);
    await pStart;
    await vi.advanceTimersByTimeAsync(4000);

    const pStop = ctrl.command('stop');
    await vi.advanceTimersByTimeAsync(200);
    await pStop;
    await ctrl.flush();

    const stored = (await repo.all())[0]!;
    expect(stored.raw_summary?.enabled).toBe(true);
    expect(stored.raw_summary?.available).toBe(true);
    expect(stored.raw_summary?.sample_count).toBeGreaterThan(5000);
    const storedChunks = await repo.getRawChunks(stored.id);
    expect(storedChunks.length).toBeGreaterThan(0);

    ctrl.destroy();
  });

  it('renders ExportModal and raw opt-in toggle cleanly in Vietnamese', () => {
    const rec = makeTestRecord({
      frame: { source: 'simulation', state: 'completed', valid_count: 5, total_count: 6 },
    });
    const modalHtml = renderToStaticMarkup(
      <ExportModal record={rec} mobile={true} onClose={() => {}} />
    );
    expect(modalHtml).toContain('Xuất dữ liệu');
    expect(modalHtml).toContain('Báo cáo buổi tập');
    expect(modalHtml).toContain('Dữ liệu nghiên cứu — RAW');
    expect(modalHtml).toContain('Xem kết quả, số lần co cơ và mức hoàn thành mục tiêu.');
    expect(modalHtml).toContain('Tải tín hiệu gốc, thông số thu và sự kiện để phân tích bằng MATLAB/Python.');
    expect(modalHtml).toContain('PDF (.pdf)');
    expect(modalHtml).toContain('Excel (.xlsx)');
    expect(modalHtml).toContain('Không có dữ liệu RAW');

    const settingsHtml = renderToStaticMarkup(
      <TrainingSettings
        settings={defaults}
        onChange={() => {}}
        state="idle"
        pending={false}
        connected
        onCalibrate={() => {}}
        rawRecording={false}
        onRawRecordingChange={() => {}}
      />
    );
    expect(settingsHtml).toContain('Ghi dữ liệu RAW cho nghiên cứu');
    expect(settingsHtml).toContain('không thể xuất tín hiệu gốc');
  });
});
