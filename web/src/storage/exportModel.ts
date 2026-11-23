import {
  isActive,
  isFreeMode,
  modeLabel,
  muscleLabel,
  stateLabels,
  type ConfigHistoryEntry,
  type Frame,
  type LabelSource,
  type RawSummary,
  type ReasonCode,
  type Sample,
  type SessionRecord,
} from '../core/protocol';
import { channelText } from '../core/channelMap';

export type ExportEventStatus = 'valid' | 'invalid' | 'incomplete';

export type ExportEvent = {
  eventId: number;
  repetitionId: string | null;
  channel: 1 | 2;
  muscle: 'forearm' | 'biceps';
  channelMuscleLabel: string;
  startMs: number;
  endMs: number;
  startTimeS: number;
  endTimeS: number;
  durationMs: number;
  restBeforeMs: number | null;
  inZoneMs: number | null;
  startSampleIndex: number | null;
  endSampleIndex: number | null;
  rmsMean: number | null;
  rmsPeak: number | null;
  status: ExportEventStatus;
  statusVi: 'Đạt' | 'Chưa đạt' | 'Chưa hoàn tất';
  reasonCode: ReasonCode | null;
  reasonVi: string;
  labelSource: LabelSource;
  isComplete: boolean;
};

export type ThresholdPoint = {
  tMs: number;
  timeS: number;
  channel: 1 | 2;
  onThreshold: number;
  offThreshold: number;
  event: string;
};

export type ExportSessionModel = {
  record: SessionRecord;
  frame: Frame;
  exportedAt: Date;
  exportedAtIso: string;
  startedAtDate: Date;
  startedAtIsoWithTz: string;
  startedAtDisplayVi: string;
  startedAtEstimated: boolean;
  sessionId: string;
  sessionShortId: string;
  isInProgress: boolean;
  isFreeMode: boolean;
  modeCode: 'training' | 'free';
  modeLabelVi: string;
  sourceCode: 'simulation' | 'replay' | 'sensor';
  sourceLabelVi: string;
  isSynthetic: boolean;
  sourceWarningVi: string | null;
  sessionStateCode: Frame['state'];
  sessionStateLabelVi: string;
  channel: 1 | 2;
  channelCount: 1 | 2;
  muscle: 'forearm' | 'biceps';
  muscleLabelVi: string;
  channelMuscleLabelVi: string;
  unit: 'uV' | 'ADC' | 'a.u.';
  unitLabelVi: string;
  signalKind: 'RAW' | 'ENVELOPE' | null;
  fsHz: number | null;
  durationMs: number;
  durationDisplay: string;
  target: number | null;
  totalCount: number;
  validCount: number;
  invalidCount: number;
  incompleteCount: number;
  goalCompletionRatio: number | null;
  goalCompletionPct: number | null;
  goalProgressBarPct: number;
  goalMet: boolean;
  goalStatusVi: string;
  validRateRatio: number | null;
  validRatePct: number | null;
  validRateDisplayVi: string;
  minHoldMs: number;
  onThreshold: number | null;
  offThreshold: number | null;
  zoneEnabled: boolean;
  referenceRms: number | null;
  zoneLowPct: number | null;
  zoneHighPct: number | null;
  zoneLowValue: number | null;
  zoneHighValue: number | null;
  evaluationConditionsVi: string[];
  events: ExportEvent[];
  samples: Sample[];
  hasSignalSeries: boolean;
  hasEventDetails: boolean;
  missingEventDetails: boolean;
  missingDataNotes: string[];
  gapsCount: number;
  thresholdHistory: ThresholdPoint[];
  configHistory: ConfigHistoryEntry[];
  rawSummary: RawSummary;
  appVersion: string;
};

export function formatDurationClock(ms: number): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const totalSec = Math.floor(safe / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatIsoWithLocalOffset(date: Date): string {
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString();
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
  const mm = String(absMin % 60).padStart(2, '0');
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}${sign}${hh}:${mm}`;
}

export function formatLocalDateTimeVi(date: Date): string {
  if (Number.isNaN(date.getTime())) return 'Không xác định';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function reasonCodeToVi(code: ReasonCode | null, f: Frame): string {
  if (!code) return '';
  switch (code) {
    case 'short_hold':
      return `Giữ chưa đủ ${(f.settings.min_hold_ms / 1000).toLocaleString('vi-VN')} s`;
    case 'insufficient_in_zone':
      return `Chưa giữ đủ ${(f.settings.min_hold_ms / 1000).toLocaleString('vi-VN')} s liên tục trong vùng ${f.settings.zone_low_pct ?? 40}–${f.settings.zone_high_pct ?? 70}%`;
    case 'stopped_mid_contraction':
      return 'Phiên dừng giữa lần co cơ (chưa thả lỏng hoàn tất)';
    case 'session_in_progress':
      return 'Đang co cơ tại thời điểm chụp dữ liệu (phiên chưa kết thúc)';
  }
}

function sourceLabel(source: Frame['source']): string {
  if (source === 'sensor') return 'Đo thực tế (ADC)';
  if (source === 'replay') return 'Phát lại (GRABMyo)';
  return 'Mô phỏng';
}

function unitDisplay(unit: Frame['unit']): string {
  return unit === 'uV' ? 'µV' : unit;
}

function computeSampleWindowRms(samples: Sample[], startMs: number, endMs: number): { mean: number | null; peak: number | null } {
  if (!samples.length) return { mean: null, peak: null };
  let sum = 0;
  let count = 0;
  let peak = -Infinity;
  for (const s of samples) {
    if (s.t_ms >= startMs - 1e-6 && s.t_ms <= endMs + 1e-6 && s.rms !== null && Number.isFinite(s.rms)) {
      sum += s.rms;
      count++;
      if (s.rms > peak) peak = s.rms;
    }
  }
  if (!count) return { mean: null, peak: null };
  return {
    mean: Math.round((sum / count) * 100) / 100,
    peak: Math.round(peak * 100) / 100,
  };
}

function extractThresholdHistory(samples: Sample[], configHistory: ConfigHistoryEntry[], activeChannel: 1 | 2): ThresholdPoint[] {
  const points: ThresholdPoint[] = [];
  for (const ch of configHistory) {
    if (ch.event === 'session_start' || ch.event === 'calibrated' || ch.event === 'threshold_change' || ch.event === 'settings_change') {
      const last = points.at(-1);
      if (!last || last.onThreshold !== ch.on_threshold || last.offThreshold !== ch.off_threshold) {
        points.push({
          tMs: ch.t_ms,
          timeS: Math.round((ch.t_ms / 1000) * 1000) / 1000,
          channel: ch.channel,
          onThreshold: ch.on_threshold,
          offThreshold: ch.off_threshold,
          event: ch.event,
        });
      }
    }
  }
  for (const s of samples) {
    const last = points.at(-1);
    if (!last || Math.abs(last.onThreshold - s.on_threshold) > 1e-6 || Math.abs(last.offThreshold - s.off_threshold) > 1e-6) {
      if (last && s.t_ms <= last.tMs) continue;
      points.push({
        tMs: s.t_ms,
        timeS: Math.round((s.t_ms / 1000) * 1000) / 1000,
        channel: activeChannel,
        onThreshold: s.on_threshold,
        offThreshold: s.off_threshold,
        event: points.length === 0 ? 'initial_sample' : 'threshold_change',
      });
    }
  }
  return points;
}

export function buildExportFilename(model: ExportSessionModel, kind: 'pdf' | 'xlsx' | 'zip'): string {
  const d = model.startedAtDate;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const datePart = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const timePart = `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  const suffix = kind === 'zip' ? 'research' : 'report';
  return `sEMG_${datePart}_${timePart}_${model.sessionShortId}_${suffix}.${kind}`;
}

export function buildExportModel(
  inputRecord: SessionRecord,
  options?: { rawSummaryOverride?: RawSummary; exportedAt?: Date }
): ExportSessionModel {
  const record = structuredClone(inputRecord);
  const f = record.snapshot;
  const exportedAt = options?.exportedAt ?? new Date();
  const startedAtDate = new Date(f.started_at);
  const free = isFreeMode(f.settings);
  const inProgress = isActive(f.state);
  const sourceCode = f.source;
  const sourceLabelVi = sourceLabel(sourceCode);
  const isSynthetic = sourceCode !== 'sensor';
  const unit = f.unit;
  const unitStr = unitDisplay(unit);
  const chInfo = f.channels.find(c => c.id === 1) ?? f.channels[0];
  const onThreshold = chInfo ? chInfo.on_threshold : null;
  const offThreshold = chInfo ? chInfo.off_threshold : null;

  const target: number | null = free ? null : (Number.isFinite(f.settings.target) ? Math.max(0, f.settings.target) : 0);
  const totalCount = Math.max(0, f.total_count);
  const validCount = Math.max(0, f.valid_count);
  const invalidCount = Math.max(0, totalCount - validCount);

  const goalCompletionRatio = !free && target !== null && target > 0 ? validCount / target : null;
  const goalCompletionPct = goalCompletionRatio !== null ? goalCompletionRatio * 100 : null;
  const goalProgressBarPct = goalCompletionPct !== null ? Math.min(100, Math.max(0, goalCompletionPct)) : 0;
  const goalMet = !free && target !== null && target > 0 && validCount >= target;

  let goalStatusVi = 'Không đặt mục tiêu (Đếm tự do)';
  if (!free) {
    if (target === 0) goalStatusVi = 'Không áp dụng (mục tiêu = 0)';
    else if (validCount > target!) goalStatusVi = 'Vượt mục tiêu';
    else if (validCount === target!) goalStatusVi = 'Đạt mục tiêu';
    else goalStatusVi = 'Chưa đạt mục tiêu';
  }

  const validRateRatio = totalCount > 0 ? validCount / totalCount : null;
  const validRatePct = validRateRatio !== null ? validRateRatio * 100 : null;
  const validRateDisplayVi =
    validRatePct !== null
      ? `${validRatePct.toFixed(1).replace('.', ',')}% (${validCount}/${totalCount})`
      : 'Chưa có lần co nào được ghi nhận (0/0)';

  let sessionStateLabelVi = stateLabels[f.state];
  if (f.state === 'calibrating') sessionStateLabelVi = 'Phiên chưa kết thúc (đang hiệu chuẩn)';
  else if (f.state === 'training') sessionStateLabelVi = f.paused ? 'Phiên chưa kết thúc (đang tạm dừng)' : 'Phiên chưa kết thúc (đang tập)';
  else if (f.state === 'completed') sessionStateLabelVi = 'Hoàn tất';
  else if (f.state === 'stopped') sessionStateLabelVi = free ? 'Đã kết thúc' : 'Dừng sớm';

  const sourceWarningVi =
    sourceCode === 'simulation'
      ? 'Dữ liệu MÔ PHỎNG tổng hợp trên phần mềm (không phải tín hiệu cơ từ cảm biến gắn trên người).'
      : sourceCode === 'replay'
        ? 'Dữ liệu PHÁT LẠI từ tập mẫu GRABMyo v1.1.0 (không phải phép đo trực tiếp trong buổi tập mới).'
        : null;

  const zoneEnabled = Boolean(f.settings.zone_enabled && !free);
  const referenceRms = typeof f.settings.reference_rms === 'number' && f.settings.reference_rms > 0 ? f.settings.reference_rms : null;
  const zoneLowPct = zoneEnabled ? (f.settings.zone_low_pct ?? 40) : null;
  const zoneHighPct = zoneEnabled ? (f.settings.zone_high_pct ?? 70) : null;
  const zoneLowValue = zoneEnabled && referenceRms !== null && zoneLowPct !== null ? Math.round((referenceRms * zoneLowPct) / 100 * 100) / 100 : null;
  const zoneHighValue = zoneEnabled && referenceRms !== null && zoneHighPct !== null ? Math.round((referenceRms * zoneHighPct) / 100 * 100) / 100 : null;

  const evaluationConditionsVi: string[] = [];
  if (free) {
    evaluationConditionsVi.push('Chế độ Đếm tự do: mỗi chu kỳ vượt ngưỡng co rồi giảm dưới ngưỡng thả được ghi nhận 1 lần, không yêu cầu thời gian giữ tối thiểu.');
  } else {
    evaluationConditionsVi.push(`Thời gian giữ tối thiểu: ${(f.settings.min_hold_ms / 1000).toLocaleString('vi-VN')} s (${f.settings.min_hold_ms} ms).`);
  }
  if (onThreshold !== null && offThreshold !== null) {
    evaluationConditionsVi.push(`Ngưỡng trễ (hysteresis): ngưỡng co ≥ ${onThreshold.toFixed(1)} ${unitStr}, ngưỡng thả ≤ ${offThreshold.toFixed(1)} ${unitStr}.`);
  }
  if (f.dsp_config?.on_ms != null && f.dsp_config?.off_ms != null) {
    evaluationConditionsVi.push(`Xác nhận chuyển pha (debounce): co ${f.dsp_config.on_ms} ms, thả ${f.dsp_config.off_ms} ms.`);
  }
  if (zoneEnabled && referenceRms !== null && zoneLowPct !== null && zoneHighPct !== null) {
    evaluationConditionsVi.push(
      `Vùng mục tiêu: giữ liên tục trong khoảng ${zoneLowPct}–${zoneHighPct}% mốc tham chiếu ${referenceRms} ${unitStr} (${zoneLowValue}–${zoneHighValue} ${unitStr}).`
    );
  }

  const samples = record.samples ?? [];
  const fsHz = f.fs_hz ?? null;
  const sortedReps = [...f.repetitions].sort((a, b) => a.ordinal - b.ordinal);
  const events: ExportEvent[] = sortedReps.map((rep, idx) => {
    const repCh = 1 as const;
    const startMs = rep.started_ms ?? Math.max(0, rep.ended_ms - rep.hold_ms);
    const endMs = rep.ended_ms;
    const computedRms = computeSampleWindowRms(samples, startMs, endMs);
    const rmsMean = rep.rms_mean !== undefined && rep.rms_mean !== null ? rep.rms_mean : computedRms.mean;
    const rmsPeak = rep.rms_peak !== undefined && rep.rms_peak !== null ? rep.rms_peak : computedRms.peak;
    const startSampleIndex =
      rep.start_sample_index !== undefined
        ? rep.start_sample_index
        : fsHz
          ? Math.round((startMs * fsHz) / 1000)
          : null;
    const endSampleIndex =
      rep.end_sample_index !== undefined
        ? rep.end_sample_index
        : fsHz
          ? Math.round((endMs * fsHz) / 1000)
          : null;
    const status: ExportEventStatus = rep.valid ? 'valid' : 'invalid';
    const statusVi = rep.valid ? 'Đạt' : 'Chưa đạt';
    const reasonCode: ReasonCode | null = rep.valid
      ? null
      : (rep.reason_code ?? (zoneEnabled ? 'insufficient_in_zone' : 'short_hold'));
    return {
      eventId: idx + 1,
      repetitionId: rep.id,
      channel: repCh,
      muscle: f.settings.muscle,
      channelMuscleLabel: channelText(repCh, f.settings.muscle),
      startMs,
      endMs,
      startTimeS: Math.round((startMs / 1000) * 1000) / 1000,
      endTimeS: Math.round((endMs / 1000) * 1000) / 1000,
      durationMs: rep.hold_ms,
      restBeforeMs: rep.rest_ms ?? null,
      inZoneMs: rep.in_zone_ms ?? null,
      startSampleIndex,
      endSampleIndex,
      rmsMean,
      rmsPeak,
      status,
      statusVi,
      reasonCode,
      reasonVi: reasonCodeToVi(reasonCode, f),
      labelSource: rep.label_source ?? 'algorithm_predicted',
      isComplete: true,
    };
  });

  const pendingInc = f.incomplete_contraction ?? (inProgress ? f.active_contraction ?? null : null);
  let incompleteCount = 0;
  if (pendingInc) {
    incompleteCount = 1;
    const startMs = pendingInc.started_ms;
    const endMs = pendingInc.ended_ms;
    const computedRms = computeSampleWindowRms(samples, startMs, endMs);
    const reasonCode: ReasonCode = pendingInc.reason_code ?? (inProgress ? 'session_in_progress' : 'stopped_mid_contraction');
    events.push({
      eventId: events.length + 1,
      repetitionId: null,
      channel: 1 as const,
      muscle: f.settings.muscle,
      channelMuscleLabel: channelText(1, f.settings.muscle),
      startMs,
      endMs,
      startTimeS: Math.round((startMs / 1000) * 1000) / 1000,
      endTimeS: Math.round((endMs / 1000) * 1000) / 1000,
      durationMs: pendingInc.hold_ms,
      restBeforeMs: null,
      inZoneMs: pendingInc.in_zone_ms ?? null,
      startSampleIndex:
        pendingInc.start_sample_index ?? (fsHz ? Math.round((startMs * fsHz) / 1000) : null),
      endSampleIndex:
        pendingInc.end_sample_index ?? (fsHz ? Math.round((endMs * fsHz) / 1000) : null),
      rmsMean: pendingInc.rms_mean ?? computedRms.mean,
      rmsPeak: pendingInc.rms_peak ?? computedRms.peak,
      status: 'incomplete',
      statusVi: 'Chưa hoàn tất',
      reasonCode,
      reasonVi: reasonCodeToVi(reasonCode, f),
      labelSource: 'algorithm_predicted',
      isComplete: false,
    });
  }

  const hasSignalSeries = samples.some(s => s.rms !== null);
  const missingEventDetails = totalCount > 0 && f.repetitions.length === 0;
  const missingDataNotes: string[] = [];
  if (!hasSignalSeries) {
    missingDataNotes.push('Phiên này không có chuỗi tín hiệu RMS/envelope theo thời gian nên không thể vẽ biểu đồ hoặc xuất bảng dữ liệu biểu đồ.');
  }
  if (missingEventDetails) {
    missingDataNotes.push('Phiên cũ chỉ lưu tổng số lần co cơ, không có danh sách chi tiết từng lần co cơ.');
  }
  if (record.gaps > 0) {
    missingDataNotes.push(`Có ${record.gaps} khoảng gián đoạn mẫu RMS trên đường truyền hiển thị (được giữ nguyên khoảng trống, không nội suy).`);
  }
  if (f.started_at_estimated) {
    missingDataNotes.push('Thời gian bắt đầu phiên được ước lượng theo đồng hồ ứng dụng tại thời điểm nhận gói tin đầu tiên.');
  }

  const configHistory = record.config_history ?? [];
  const thresholdHistory = extractThresholdHistory(samples, configHistory, 1);

  const defaultRawSummary: RawSummary = {
    enabled: Boolean(f.raw_recording),
    available: false,
    unavailable_reason: f.raw_recording
      ? 'Chưa có chunk dữ liệu RAW nào được lưu cho phiên này.'
      : 'Phiên được ghi trước khi bật tùy chọn "Ghi dữ liệu RAW cho nghiên cứu" hoặc đây là phiên cũ.',
    fs_hz: fsHz ?? undefined,
    measured_fs_hz: null,
    channel_count: 1,
    sample_count: 0,
    chunk_count: 0,
    bytes_stored: 0,
    tracking_method: f.capabilities?.includes('raw_stream_v1') || f.health?.tracking_supported ? 'source_sample_index' : 'none',
    missing_samples_detected: f.health?.raw_dropped_samples ?? 0,
    gap_events: 0,
    overflow_events: f.health?.raw_overflow_events ?? 0,
  };
  const rawSummary = options?.rawSummaryOverride ?? record.raw_summary ?? defaultRawSummary;

  return {
    record,
    frame: f,
    exportedAt,
    exportedAtIso: formatIsoWithLocalOffset(exportedAt),
    startedAtDate,
    startedAtIsoWithTz: formatIsoWithLocalOffset(startedAtDate),
    startedAtDisplayVi: formatLocalDateTimeVi(startedAtDate),
    startedAtEstimated: Boolean(f.started_at_estimated),
    sessionId: record.id,
    sessionShortId: record.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'session',
    isInProgress: inProgress,
    isFreeMode: free,
    modeCode: free ? 'free' : 'training',
    modeLabelVi: modeLabel(f.settings.mode),
    sourceCode,
    sourceLabelVi,
    isSynthetic,
    sourceWarningVi,
    sessionStateCode: f.state,
    sessionStateLabelVi,
    channel: 1,
    channelCount: 1,
    muscle: f.settings.muscle,
    muscleLabelVi: muscleLabel(f.settings.muscle),
    channelMuscleLabelVi: channelText(1, f.settings.muscle),
    unit,
    unitLabelVi: unitStr,
    signalKind: f.signal_kind ?? null,
    fsHz,
    durationMs: f.duration_ms,
    durationDisplay: formatDurationClock(f.duration_ms),
    target,
    totalCount,
    validCount,
    invalidCount,
    incompleteCount,
    goalCompletionRatio,
    goalCompletionPct,
    goalProgressBarPct,
    goalMet,
    goalStatusVi,
    validRateRatio,
    validRatePct,
    validRateDisplayVi,
    minHoldMs: f.settings.min_hold_ms,
    onThreshold,
    offThreshold,
    zoneEnabled,
    referenceRms,
    zoneLowPct,
    zoneHighPct,
    zoneLowValue,
    zoneHighValue,
    evaluationConditionsVi,
    events,
    samples,
    hasSignalSeries,
    hasEventDetails: events.length > 0,
    missingEventDetails,
    missingDataNotes,
    gapsCount: record.gaps ?? 0,
    thresholdHistory,
    configHistory,
    rawSummary,
    appVersion: '1.2.0',
  };
}
