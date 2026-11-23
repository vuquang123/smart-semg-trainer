import type { RawChunk, RawSummary } from '../core/protocol';
import type { ExportSessionModel } from './exportModel';
import type { Repository } from './repository';
import { ZipWriter } from './zipWriter';

export type ResearchZipResult = {
  bytes: Uint8Array;
  rawSampleCount: number;
  rawIncluded: boolean;
  processedIncluded: boolean;
  eventCount: number;
};

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function csvLine(cells: unknown[]): string {
  return `${cells.map(csvEscape).join(',')}\n`;
}

async function buildRawCsvChunks(
  model: ExportSessionModel,
  options: { repository?: Repository; rawChunks?: RawChunk[] }
): Promise<{
  csvChunks: Uint8Array[];
  sampleCount: number;
  chunkCount: number;
  encoding: RawChunk['encoding'] | null;
  fsHz: number | null;
  channelCount: 1 | 2 | null;
  missingSamples: number;
  gapEvents: number;
  hasVoltageCols: boolean;
}> {
  const encoder = new TextEncoder();
  const csvChunks: Uint8Array[] = [];
  let buffer = '';
  let sampleCount = 0;
  let chunkCount = 0;
  let encoding: RawChunk['encoding'] | null = null;
  let fsHz: number | null = model.fsHz;
  let channelCount: 1 | 2 | null = null;
  let expectedNextSample: number | null = null;
  let missingSamples = 0;
  let gapEvents = 0;
  let headerWritten = false;
  let hasVoltageCols = false;

  const conv = model.frame.conversion;
  const canConvertToUv =
    conv !== undefined &&
    Number.isFinite(conv.uV_per_unit) &&
    conv.uV_per_unit > 0 &&
    Number.isFinite(conv.offset_uV);

  const flushText = () => {
    if (buffer.length > 0) {
      csvChunks.push(encoder.encode(buffer));
      buffer = '';
    }
  };

  const handleChunk = (chunk: RawChunk) => {
    chunkCount++;
    if (!headerWritten) {
      encoding = chunk.encoding;
      fsHz = chunk.fs_hz;
      channelCount = 1;
      hasVoltageCols = encoding !== 'float32_uv' && canConvertToUv;

      const cols: string[] = ['sample_index', 'time_s'];
      if (encoding === 'float32_uv') {
        cols.push('ch1_uV');
      } else {
        cols.push('ch1_adc');
        if (hasVoltageCols) {
          cols.push('ch1_uV');
        }
      }
      buffer += csvLine(cols);
      headerWritten = true;
    }

    if (expectedNextSample !== null && chunk.first_sample_index > expectedNextSample) {
      missingSamples += chunk.first_sample_index - expectedNextSample;
      gapEvents++;
    }
    expectedNextSample = chunk.first_sample_index + chunk.sample_count;

    const effectiveFs = fsHz || chunk.fs_hz;
    const stride = Math.max(1, chunk.channels);
    const typed =
      chunk.encoding === 'float32_uv'
        ? new Float32Array(chunk.data)
        : chunk.encoding === 'int16_adc'
          ? new Int16Array(chunk.data)
          : new Uint16Array(chunk.data);

    const rowCount = Math.min(chunk.sample_count, Math.floor(typed.length / stride));
    for (let i = 0; i < rowCount; i++) {
      const sIdx = chunk.first_sample_index + i;
      const tStr = (sIdx / effectiveFs).toFixed(6);
      if (chunk.encoding === 'float32_uv') {
        const v1 = typed[i * stride]!;
        buffer += `${sIdx},${tStr},${v1.toFixed(4)}\n`;
      } else {
        const c1 = typed[i * stride]!;
        if (hasVoltageCols && conv) {
          const u1 = c1 * conv.uV_per_unit + conv.offset_uV;
          buffer += `${sIdx},${tStr},${c1},${u1.toFixed(4)}\n`;
        } else {
          buffer += `${sIdx},${tStr},${c1}\n`;
        }
      }
      sampleCount++;
      if (buffer.length >= 65536) flushText();
    }
  };

  if (options.rawChunks && options.rawChunks.length > 0) {
    const sorted = [...options.rawChunks].sort((a, b) => a.chunk_seq - b.chunk_seq);
    for (const c of sorted) handleChunk(c);
  } else if (options.repository) {
    await options.repository.iterateRawChunks(model.sessionId, c => handleChunk(c));
  }
  flushText();

  return {
    csvChunks,
    sampleCount,
    chunkCount,
    encoding,
    fsHz,
    channelCount,
    missingSamples,
    gapEvents,
    hasVoltageCols,
  };
}

function buildEventsCsv(model: ExportSessionModel): string {
  const header = [
    'event_id',
    'channel',
    'muscle',
    'start_sample_index',
    'end_sample_index',
    'start_time_s',
    'end_time_s',
    'duration_ms',
    'rest_before_ms',
    'in_zone_ms',
    'rms_mean',
    'rms_peak',
    'rms_unit',
    'evaluation_result',
    'failure_reason_code',
    'label_source',
  ];
  let out = csvLine(header);
  for (const ev of model.events) {
    out += csvLine([
      ev.eventId,
      'CH1',
      ev.muscle,
      ev.startSampleIndex,
      ev.endSampleIndex,
      ev.startTimeS.toFixed(3),
      ev.endTimeS.toFixed(3),
      ev.durationMs.toFixed(2),
      ev.restBeforeMs !== null ? ev.restBeforeMs.toFixed(2) : '',
      ev.inZoneMs !== null ? ev.inZoneMs.toFixed(2) : '',
      ev.rmsMean !== null ? ev.rmsMean.toFixed(4) : '',
      ev.rmsPeak !== null ? ev.rmsPeak.toFixed(4) : '',
      ev.rmsMean !== null ? model.unit : '',
      ev.status,
      ev.reasonCode ?? '',
      ev.labelSource,
    ]);
  }
  return out;
}

function buildProcessedCsvChunks(model: ExportSessionModel): { chunks: Uint8Array[]; rowCount: number; hasFiltered: boolean } {
  const encoder = new TextEncoder();
  const hasFiltered = model.samples.some(
    s => s.filtered !== undefined && s.filtered !== null && Number.isFinite(s.filtered)
  );
  const header = [
    'processed_index',
    'time_s',
    'time_ms',
    'sample_index',
    'channel',
    'electrode_muscle',
    'ch1_filtered',
    'ch1_rms_envelope',
    'on_threshold',
    'off_threshold',
    'activation_pct',
    'target_zone',
  ];
  const chunks: Uint8Array[] = [];
  let buf = csvLine(header);
  let rowCount = 0;

  for (let i = 0; i < model.samples.length; i++) {
    const s = model.samples[i]!;
    const row: unknown[] = [
      i,
      (s.t_ms / 1000).toFixed(4),
      s.t_ms,
      s.sample_index ?? (model.fsHz ? Math.round((s.t_ms * model.fsHz) / 1000) : ''),
      'CH1',
      model.muscle,
      s.filtered !== null && s.filtered !== undefined && Number.isFinite(s.filtered) ? s.filtered : '',
      s.rms !== null && Number.isFinite(s.rms) ? s.rms : '',
      s.on_threshold,
      s.off_threshold,
      s.activation_pct !== null && s.activation_pct !== undefined && Number.isFinite(s.activation_pct)
        ? s.activation_pct.toFixed(2)
        : '',
      s.target_zone ?? '',
    ];
    buf += csvLine(row);
    rowCount++;
    if (buf.length >= 65536) {
      chunks.push(encoder.encode(buf));
      buf = '';
    }
  }
  if (buf.length > 0) chunks.push(encoder.encode(buf));
  return { chunks, rowCount, hasFiltered };
}

function buildMetadataJson(
  model: ExportSessionModel,
  rawInfo: Awaited<ReturnType<typeof buildRawCsvChunks>>,
  processedInfo: { rowCount: number; hasFiltered: boolean } | null
): Record<string, unknown> {
  const f = model.frame;
  const rawSummary: RawSummary = model.rawSummary;
  const rawAvailable = rawInfo.sampleCount > 0;
  const effectiveFsHz = rawInfo.fsHz ?? model.fsHz;
  const missingSamples = Math.max(rawInfo.missingSamples, rawSummary.missing_samples_detected ?? 0);
  const gapEvents = Math.max(rawInfo.gapEvents, rawSummary.gap_events ?? 0);
  const trackingSupported = rawSummary.tracking_method === 'source_sample_index';

  const ch1 = f.channels.find(c => c.id === 1) ?? f.channels[0];
  const channelsMeta = [
    {
      channel_id: 1,
      channel_name: 'CH1',
      electrode_muscle: model.muscle,
      electrode_muscle_vi: model.muscleLabelVi,
      muscle: model.muscle,
      role_in_session: 'single_channel_ch1',
      final_on_threshold: ch1?.on_threshold ?? null,
      final_off_threshold: ch1?.off_threshold ?? null,
      threshold_unit: model.unit,
    },
  ];

  const adcCfg = f.adc_config;
  const dspCfg = f.dsp_config;
  const conv = f.conversion;
  const normalizedSamplingMode =
    adcCfg?.sampling_mode === 'simulated_synchronous'
      ? 'simulated_single_channel'
      : (adcCfg?.sampling_mode ?? 'single_channel');

  return {
    schema_version: '1.0.0',
    dataset_format_note:
      'Gói dữ liệu nghiên cứu Smart sEMG Trainer (CSV + JSON). Không phải định dạng PhysioNet/WFDB.',
    session_id: model.sessionId,
    device_id: f.device_id,
    device_name: f.device_name,
    boot_id: f.boot_id,
    started_at_iso: model.startedAtIsoWithTz,
    started_at_utc: f.started_at,
    started_at_estimated: model.startedAtEstimated,
    exported_at_iso: model.exportedAtIso,
    duration_ms: model.durationMs,
    session_state: model.sessionStateCode,
    session_state_vi: model.sessionStateLabelVi,
    session_in_progress: model.isInProgress,
    source: model.sourceCode,
    source_label_vi: model.sourceLabelVi,
    is_synthetic: model.isSynthetic,
    software: {
      app_name: 'Smart sEMG Trainer',
      app_version: model.appVersion,
      firmware_version: f.firmware_version ?? null,
    },
    electrode_placement: {
      channel: 'CH1',
      muscle: model.muscle,
      muscle_label_vi: model.muscleLabelVi,
      note: 'Vùng cơ là thông tin vị trí đặt điện cực của phiên đo trên 1 kênh CH1, không phải kênh đo độc lập.',
    },
    sampling: {
      configured_fs_hz: effectiveFsHz,
      measured_fs_hz: rawSummary.measured_fs_hz ?? null,
      measured_fs_note:
        rawSummary.measured_fs_hz !== null && rawSummary.measured_fs_hz !== undefined
          ? 'Ước tính từ số mẫu thực nhận và chênh lệch thời gian đồng hồ trình duyệt (chịu ảnh hưởng jitter đường truyền).'
          : 'Không đủ dữ liệu thời gian nhận liên tục để ước tính tần số thực đo.',
      time_s_origin: effectiveFsHz ? 'derived_from_sample_index_and_configured_fs_hz' : null,
      time_s_note: effectiveFsHz
        ? 'Cột time_s được suy ra từ sample_index / configured_fs_hz theo clock lấy mẫu cấu hình, không bù mẫu giả qua đoạn mất dữ liệu.'
        : 'Không xác định được tần số lấy mẫu (fs_hz) của phiên.',
      raw_available: rawAvailable,
      raw_unavailable_reason: rawAvailable ? null : (rawSummary.unavailable_reason ?? 'Không có dữ liệu RAW được lưu cho phiên này.'),
      raw_sample_count: rawInfo.sampleCount,
      raw_encoding: rawInfo.encoding,
      channel_count: 1,
      active_counting_channel: 1,
      channels: channelsMeta,
      signal_representations_on_ch1: {
        note: 'RAW (signal_raw.csv), tín hiệu lọc số (ch1_filtered) và RMS/envelope (ch1_rms_envelope) là các dạng dữ liệu ở những bước xử lý khác nhau của cùng 1 kênh CH1, không phải các kênh độc lập.',
        raw_signal: {
          file: rawAvailable ? 'signal_raw.csv' : null,
          column: rawInfo.encoding === 'float32_uv' ? 'ch1_uV' : 'ch1_adc',
          fs_hz: effectiveFsHz,
        },
        filtered_signal: {
          file: processedInfo ? 'signal_processed.csv' : null,
          column: 'ch1_filtered',
          unit: model.unit,
          present: processedInfo ? processedInfo.hasFiltered : false,
        },
        rms_envelope: {
          file: processedInfo ? 'signal_processed.csv' : null,
          column: 'ch1_rms_envelope',
          unit: model.unit,
        },
      },
      sampling_mode: normalizedSamplingMode,
      sampling_mode_note:
        normalizedSamplingMode === 'single_channel_dma'
          ? 'Thu 1 kênh CH1 bằng ADC1 DMA trên ESP32.'
          : normalizedSamplingMode === 'single_channel_replay'
            ? 'Phát lại tín hiệu 1 kênh từ tập mẫu chuẩn bị sẵn trên 1 kênh CH1.'
            : normalizedSamplingMode === 'simulated_single_channel'
              ? 'Mô phỏng tạo mẫu trên 1 kênh CH1.'
              : 'Thu thập trên 1 kênh CH1.',
    },
    analog_and_adc: {
      signal_stage_note:
        'Dữ liệu RAW (signal_raw.csv) là dữ liệu trước các bước xử lý số (loại DC offset số, lọc thông dải/notch, chỉnh lưu, tính RMS/envelope). Với cảm biến thật, tín hiệu vẫn đã đi qua mạch tiền khuếch đại analog (AFE).',
      adc_resolution_bits: adcCfg?.resolution_bits ?? null,
      adc_attenuation_db: adcCfg?.atten_db ?? null,
      adc_hw_oversampling_hz: adcCfg?.hw_sample_rate_hz ?? null,
      adc_oversampling_ratio: adcCfg?.oversampling_ratio ?? null,
      adc_gpio: adcCfg?.gpio ?? null,
      analog_frontend: adcCfg?.analog_frontend ?? null,
      analog_gain: adcCfg?.analog_gain ?? conv?.gain ?? null,
      analog_bandpass_hz: adcCfg?.analog_bandpass_hz ?? null,
      calibration: conv
        ? {
            uV_per_unit: conv.uV_per_unit,
            offset_uV: conv.offset_uV,
            reference: conv.reference,
            bias: conv.bias ?? null,
            scale: conv.scale ?? null,
            gain: conv.gain ?? null,
            calibrated: conv.calibrated ?? null,
            formula_adc_to_uV: 'uV = adc * uV_per_unit + offset_uV',
          }
        : null,
      unknown_fields_note:
        'Các trường phần cứng/hiệu chuẩn không đo hoặc không truyền về từ thiết bị được giữ nguyên giá trị null, không tự điền mặc định.',
    },
    digital_processing: {
      mode: model.modeCode,
      signal_kind_for_counting: model.signalKind,
      processed_unit: model.unit,
      target_reps: model.target,
      min_hold_ms: model.minHoldMs,
      reference_rms: model.referenceRms,
      zone_enabled: model.zoneEnabled,
      zone_low_pct: model.zoneLowPct,
      zone_high_pct: model.zoneHighPct,
      highpass_hz: dspCfg?.highpass_hz ?? null,
      lowpass_hz: dspCfg?.lowpass_hz ?? null,
      notch_hz: dspCfg?.notch_hz ?? null,
      notch_q: dspCfg?.notch_q ?? null,
      rms_window_ms: dspCfg?.rms_ms ?? null,
      calibration_window_ms: dspCfg?.cal_ms ?? null,
      settle_window_ms: dspCfg?.settle_ms ?? null,
      on_debounce_ms: dspCfg?.on_ms ?? null,
      off_debounce_ms: dspCfg?.off_ms ?? null,
      on_factor: dspCfg?.on_factor ?? null,
      off_factor: dspCfg?.off_factor ?? null,
      on_sd: dspCfg?.on_sd ?? null,
      off_sd: dspCfg?.off_sd ?? null,
      dc_offset_ch1: dspCfg?.dc_offset_ch1 ?? null,
      config_history: model.configHistory,
      threshold_change_points: model.thresholdHistory,
    },
    data_integrity: {
      raw_loss_tracking: trackingSupported ? 'tracked_by_source_sample_index' : 'not_tracked',
      raw_loss_tracking_note: !trackingSupported
        ? 'Phiên này không có cơ chế theo dõi chỉ số mẫu gốc (sample_index) từ nguồn để phát hiện mẫu mất.'
        : missingSamples > 0
          ? `Hệ thống theo dõi chỉ số mẫu gốc và phát hiện ${missingSamples} mẫu mất qua ${gapEvents} lần gián đoạn.`
          : 'Hệ thống có theo dõi chỉ số mẫu gốc (sample_index) và không phát hiện mẫu mất trong các batch RAW đã nhận.',
      raw_missing_samples: trackingSupported ? missingSamples : null,
      raw_gap_events: trackingSupported ? gapEvents : null,
      raw_overflow_events: trackingSupported ? (rawSummary.overflow_events ?? 0) : null,
      adc_clip_count: adcCfg?.clip_count ?? null,
      processed_stream_gaps: model.gapsCount,
      firmware_health: f.health ?? null,
      raw_truncated_due_to_limit: Boolean(rawSummary.truncated),
    },
    events_convention: {
      end_sample_index_inclusive: false,
      interval_notation: '[start_sample_index, end_sample_index)',
      label_source_note:
        'Các nhãn trong events.csv được sinh tự động bởi thuật toán nhận diện trên thiết bị/mô phỏng (algorithm_predicted), không phải nhãn chuẩn vàng (ground truth).',
      summary_counts: {
        target: model.target,
        total_recorded: model.totalCount,
        valid: model.validCount,
        invalid: model.invalidCount,
        incomplete: model.incompleteCount,
        goal_completion_pct: model.goalCompletionPct,
        valid_rate_pct: model.validRatePct,
      },
    },
    replay_source:
      model.sourceCode === 'replay'
        ? (f.replay_info ?? {
            dataset_name: 'GRABMyo',
            dataset_version: '1.1.0',
            doi: '10.13026/89dm-f662',
            channel_name: 'F1',
            segment_description: null,
            total_samples: null,
            license: 'CC BY 4.0',
          })
        : null,
    files: [
      ...(rawAvailable
        ? [
            {
              filename: 'signal_raw.csv',
              rows: rawInfo.sampleCount,
              fs_hz: effectiveFsHz,
              encoding: rawInfo.encoding,
              has_converted_uV_columns: rawInfo.hasVoltageCols,
              description: 'Tín hiệu RAW gốc trước xử lý số theo từng mẫu',
            },
          ]
        : []),
      {
        filename: 'events.csv',
        rows: model.events.length,
        description: 'Danh sách các lần co cơ và sự kiện chưa hoàn tất (nhãn thuật toán dự đoán)',
      },
      {
        filename: 'metadata.json',
        description: 'Siêu dữ liệu đầy đủ về cấu hình thu thập, DSP, hiệu chuẩn và tính toàn vẹn dữ liệu',
      },
      {
        filename: 'README.txt',
        description: 'Tài liệu hướng dẫn tiếng Việt và ví dụ đọc dữ liệu bằng Python/MATLAB',
      },
      ...(processedInfo
        ? [
            {
              filename: 'signal_processed.csv',
              rows: processedInfo.rowCount,
              update_rate_note: 'Theo nhịp khung hiển thị WebSocket/mô phỏng (thường ~100–200 ms/mẫu), tách riêng khỏi tần số lấy mẫu RAW.',
              description: 'Chuỗi tín hiệu lọc số (ch1_filtered), RMS/envelope (ch1_rms_envelope) và ngưỡng của kênh CH1 theo thời gian phục vụ đối chiếu',
            },
          ]
        : []),
    ],
  };
}

function buildReadmeTxt(
  model: ExportSessionModel,
  rawInfo: Awaited<ReturnType<typeof buildRawCsvChunks>>,
  processedInfo: { rowCount: number; hasFiltered: boolean } | null
): string {
  const rawAvailable = rawInfo.sampleCount > 0;
  const fsText = rawInfo.fsHz ?? model.fsHz ?? 'không xác định';
  const lines: string[] = [
    '====================================================================',
    'SMART sEMG TRAINER — GÓI DỮ LIỆU NGHIÊN CỨU',
    '====================================================================',
    '',
    `Mã phiên (session_id): ${model.sessionId}`,
    `Thời gian bắt đầu: ${model.startedAtIsoWithTz}${model.startedAtEstimated ? ' (ước lượng)' : ''}`,
    `Thời lượng phiên: ${(model.durationMs / 1000).toFixed(3)} giây`,
    `Nguồn dữ liệu: ${model.sourceLabelVi} (${model.sourceCode})`,
    `Chế độ: ${model.modeLabelVi} | Kênh đo: CH1 | Vị trí đặt điện cực: ${model.muscleLabelVi}`,
    `Trạng thái phiên tại thời điểm xuất: ${model.sessionStateLabelVi}`,
    '',
    '1. QUY ƯỚC ĐỊNH DẠNG CSV',
    '- Bảng mã: UTF-8 (không BOM).',
    '- Dấu phân cách cột: dấu phẩy (,).',
    '- Dấu thập phân: dấu chấm (.).',
    '- Ký tự xuống dòng: LF (\\n).',
    '- Giá trị không xác định hoặc khoảng trống dữ liệu: ô rỗng trong CSV / null trong metadata.json.',
    '',
    '2. DANH SÁCH FILE TRONG GÓI ZIP',
  ];

  if (rawAvailable) {
    lines.push(
      `- signal_raw.csv (${rawInfo.sampleCount} mẫu, 1 kênh CH1, Fs = ${fsText} Hz, encoding = ${rawInfo.encoding}):`,
      '  + sample_index: chỉ số mẫu gốc liên tục từ nguồn thu (dùng để phát hiện mẫu mất nếu chỉ số nhảy cóc).',
      '  + time_s: thời gian tương đối tính từ đầu phiên (giây), được suy ra theo công thức sample_index / fs_hz.',
      rawInfo.encoding === 'float32_uv'
        ? '  + ch1_uV: biên độ tín hiệu tiền xử lý trên kênh CH1 (µV) trước bước lọc số/RMS.'
        : '  + ch1_adc: giá trị mã ADC thô của kênh CH1 trước loại DC offset số, lọc số, chỉnh lưu và RMS/envelope.',
      ...(rawInfo.hasVoltageCols
        ? ['  + ch1_uV: điện áp quy đổi của kênh CH1 theo thông số hiệu chuẩn (chỉ có khi đủ metadata hiệu chuẩn).']
        : ['  + Không có cột điện áp quy đổi (uV) vì thiếu hệ số hiệu chuẩn hợp lệ hoặc đã ở đơn vị µV.'])
    );
  } else {
    lines.push(
      '- KHÔNG CÓ signal_raw.csv trong gói này.',
      `  Lý do: ${model.rawSummary.unavailable_reason ?? 'Chưa bật ghi RAW hoặc phiên không có luồng RAW.'}`
    );
  }

  lines.push(
    `- events.csv (${model.events.length} sự kiện):`,
    '  + event_id, channel, muscle: số thứ tự sự kiện, kênh đo (CH1) và vùng cơ (vị trí đặt điện cực của phiên).',
    '  + start_sample_index, end_sample_index: khoảng chỉ số mẫu nửa mở [start_sample_index, end_sample_index) — KHÔNG bao gồm mẫu end_sample_index.',
    '  + start_time_s, end_time_s, duration_ms, rest_before_ms, in_zone_ms: thời điểm và thời lượng (giây / mili-giây).',
    '  + rms_mean, rms_peak, rms_unit: RMS trung bình và cực đại trong sự kiện nếu dữ liệu thực sự có.',
    '  + evaluation_result: valid (đạt), invalid (chưa đạt), incomplete (chưa hoàn tất khi dừng/xuất giữa chừng).',
    '  + failure_reason_code: mã lý do (short_hold, insufficient_in_zone, stopped_mid_contraction, session_in_progress).',
    '  + label_source: nguồn nhãn (algorithm_predicted = nhãn do thuật toán phát hiện, KHÔNG phải ground truth).',
    '- metadata.json: thông số phần cứng, ADC, hiệu chuẩn, bộ lọc DSP, lịch sử thay đổi ngưỡng và thống kê mất mẫu.',
    '- README.txt: tài liệu hướng dẫn này.'
  );

  if (processedInfo) {
    lines.push(
      `- signal_processed.csv (${processedInfo.rowCount} dòng):`,
      '  + channel (CH1), electrode_muscle: thông tin kênh đo duy nhất và vị trí đặt điện cực của phiên.',
      '  + ch1_filtered: mẫu tín hiệu CH1 sau lọc thông dải/notch & loại DC offset tại khung hiển thị (nếu nguồn có cung cấp; để trống nếu không có).',
      '  + ch1_rms_envelope: biên độ RMS/envelope của CH1 theo nhịp gói hiển thị (~100–200 ms, tách riêng khỏi signal_raw.csv vì tốc độ cập nhật khác với Fs lấy mẫu gốc).'
    );
  }

  lines.push(
    '',
    '3. QUY ĐỔI ADC SANG VI-VÔN (µV)',
    model.frame.conversion
      ? `- Phiên có metadata hiệu chuẩn: "${model.frame.conversion.reference}". Công thức: uV = adc * ${model.frame.conversion.uV_per_unit} + (${model.frame.conversion.offset_uV}).`
      : '- Phiên chưa có thông số hiệu chuẩn ADC sang µV đáng tin cậy (hoặc đang ở chế độ mô phỏng không hiệu chuẩn phần cứng). Không tự ý quy đổi nếu thiếu hệ số thực đo.',
    '',
    '4. PHÂN BIỆT CÁC DẠNG DỮ LIỆU TRÊN KÊNH CH1 VÀ NHÃN THUẬT TOÁN',
    '- Hệ thống chỉ thu và phân tích 1 kênh CH1 duy nhất; vùng cơ (electrode_muscle) là thông tin vị trí đặt điện cực của phiên, không phải kênh đo độc lập.',
    '- RAW (ch1_adc/ch1_uV), tín hiệu đã lọc số (ch1_filtered) và biên độ RMS/envelope (ch1_rms_envelope) là ba dạng biểu diễn ở các giai đoạn xử lý khác nhau của cùng một kênh CH1, không phải những kênh độc lập.',
    '- Tín hiệu trong signal_raw.csv (nếu có) là dữ liệu trước các bước xử lý số (loại DC offset số, lọc số thông dải/notch, chỉnh lưu và RMS/envelope). Lưu ý với phần cứng thật, tín hiệu vẫn đã đi qua mạch tiền khuếch đại analog (AFE).',
    '- Dữ liệu trong signal_processed.csv (ch1_filtered, ch1_rms_envelope) được lấy theo chu kỳ khung hiển thị (~100–200 ms), không thay thế cho signal_raw.csv.',
    '- Nhãn trong events.csv là nhãn dự đoán của thuật toán (algorithm_predicted), không được coi là ground truth.',
    '- Gói dữ liệu này được tổ chức theo cấu trúc nghiên cứu nội bộ của Smart sEMG Trainer, không phải định dạng WFDB/PhysioNet.',
    '',
    '5. VÍ DỤ ĐỌC NHANH BẰNG PYTHON VÀ MATLAB',
    '--- Python ---',
    'import json, pandas as pd',
    'meta = json.load(open("metadata.json", encoding="utf-8"))',
    'events = pd.read_csv("events.csv")',
    ...(rawAvailable
      ? ['raw = pd.read_csv("signal_raw.csv")', 'print(raw.head())']
      : ['# signal_raw.csv không có trong phiên này']),
    '',
    '--- MATLAB ---',
    'meta = jsondecode(fileread("metadata.json"));',
    'events = readtable("events.csv");',
    ...(rawAvailable
      ? ['raw = readtable("signal_raw.csv");', 'plot(raw.time_s, raw.ch1_adc);']
      : ['% signal_raw.csv không có trong phiên này']),
    '',
    '6. GIỚI HẠN CỦA PHIÊN DỮ LIỆU',
    ...(model.sourceWarningVi ? [`- ${model.sourceWarningVi}`] : []),
    ...(model.isInProgress ? ['- Phiên chưa kết thúc tại thời điểm xuất.'] : []),
    ...(model.missingDataNotes.length ? model.missingDataNotes.map(n => `- ${n}`) : ['- Không ghi nhận cảnh báo thiếu dữ liệu hiển thị.']),
    ...(model.sourceCode === 'replay' && model.frame.replay_info
      ? [
          `- Nguồn phát lại: ${model.frame.replay_info.dataset_name} ${model.frame.replay_info.dataset_version ?? ''} (DOI: ${model.frame.replay_info.doi ?? ''}, kênh ${model.frame.replay_info.channel_name ?? 'F1'}).`,
        ]
      : []),
    ''
  );

  return lines.join('\n');
}

export async function buildResearchZip(
  model: ExportSessionModel,
  options: {
    repository?: Repository;
    rawChunks?: RawChunk[];
    includeProcessed?: boolean;
  } = {}
): Promise<ResearchZipResult> {
  const zip = new ZipWriter();

  const rawInfo = await buildRawCsvChunks(model, options);
  const rawIncluded = rawInfo.sampleCount > 0;

  let processedInfo: { rowCount: number; hasFiltered: boolean } | null = null;
  let processedChunks: Uint8Array[] | null = null;
  if (options.includeProcessed && model.hasSignalSeries) {
    const built = buildProcessedCsvChunks(model);
    processedChunks = built.chunks;
    processedInfo = { rowCount: built.rowCount, hasFiltered: built.hasFiltered };
  }

  const eventsCsv = buildEventsCsv(model);
  const metadata = buildMetadataJson(model, rawInfo, processedInfo);
  const readme = buildReadmeTxt(model, rawInfo, processedInfo);

  if (rawIncluded) {
    await zip.addEntry('signal_raw.csv', rawInfo.csvChunks, model.exportedAt);
  }
  await zip.addEntry('events.csv', eventsCsv, model.exportedAt);
  await zip.addEntry('metadata.json', JSON.stringify(metadata, null, 2), model.exportedAt);
  await zip.addEntry('README.txt', readme, model.exportedAt);
  if (processedChunks) {
    await zip.addEntry('signal_processed.csv', processedChunks, model.exportedAt);
  }

  return {
    bytes: zip.build(),
    rawSampleCount: rawInfo.sampleCount,
    rawIncluded,
    processedIncluded: processedChunks !== null,
    eventCount: model.events.length,
  };
}
