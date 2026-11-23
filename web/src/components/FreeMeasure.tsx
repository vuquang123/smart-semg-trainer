import { Activity, ArrowDownToLine, ArrowRight, CheckCircle2, Clock3, FlaskConical, Gauge, LoaderCircle, Pause, Play, Plus, RotateCcw, ShieldCheck, Square, Trophy } from 'lucide-react';
import { isActive, isTerminal, muscleLabel, type Frame, type Repetition, type Settings } from '../core/protocol';
import { channelText } from '../core/channelMap';
import { MuscleIllustration } from './MuscleIllustration';
import { SaveBadge, duration } from './UI';

export type FreeStats = {
  count: number;
  durationMs: number;
  ratePerMin: number;
  avgHoldMs: number;
  longestHoldMs: number;
  avgRestMs: number;
};

/** Derived strictly from the confirmed repetition ledger in the snapshot. */
export function computeFreeStats(f: Frame | null | undefined): FreeStats {
  const reps: Repetition[] = f?.repetitions ?? [];
  const count = f?.valid_count ?? reps.length;
  const durationMs = f?.duration_ms ?? 0;
  let holdSum = 0;
  let longestHoldMs = 0;
  let restSum = 0;
  let restCount = 0;
  for (let i = 0; i < reps.length; i++) {
    const r = reps[i];
    holdSum += r.hold_ms;
    if (r.hold_ms > longestHoldMs) longestHoldMs = r.hold_ms;
    if (i > 0 && r.rest_ms != null) {
      restSum += r.rest_ms;
      restCount++;
    }
  }
  return {
    count,
    durationMs,
    ratePerMin: durationMs >= 1000 ? (count * 60000) / durationMs : 0,
    avgHoldMs: reps.length ? holdSum / reps.length : 0,
    longestHoldMs,
    avgRestMs: restCount ? restSum / restCount : 0,
  };
}

const actLevels = { low: 'Thấp', medium: 'Vừa', high: 'Cao', unavailable: '' };

type Props = {
  frame: Frame | null;
  settings: Settings;
  connected: boolean;
  delayed: boolean;
  pending: string | null;
  connecting: boolean;
  countdown?: number | null;
  saved: boolean;
  hasRecord: boolean;
  phaseTitle: string;
  phaseDescription: string;
  onStart: () => void;
  onPauseResume: () => void;
  onResetCounter: () => void;
  onStop: () => void;
  onResult: () => void;
  onNewSession?: () => void;
  onExport?: () => void;
};

export function FreeMeasure({
  frame: f,
  settings,
  connected,
  delayed,
  pending,
  connecting,
  countdown = null,
  saved,
  hasRecord,
  phaseTitle,
  phaseDescription,
  onStart,
  onPauseResume,
  onResetCounter,
  onStop,
  onResult,
  onNewSession,
  onExport,
}: Props) {
  const active = isActive(f?.state) || countdown !== null;
  const terminal = isTerminal(f?.state);
  const measuring = connected && !delayed && f?.state === 'training' && !f?.paused;
  const contracting = measuring && f?.phase === 'contract';
  const chId = 1 as const;
  const ch = f?.channels.find(c => c.id === 1) ?? f?.channels[0];
  const rms = connected && !delayed && ch?.rms != null ? ch.rms : 0;
  const on = ch?.on_threshold ?? 0;
  const off = ch?.off_threshold ?? 0;
  // Same scale as the OLED bottom bar: contraction threshold sits at 50% width.
  const barPct = on > 0 ? Math.min(100, Math.max(0, (rms / (on * 2)) * 100)) : 0;
  const offPct = on > 0 ? Math.min(100, Math.max(0, (off / (on * 2)) * 100)) : 30;
  const actAvailable = measuring && f?.activation_pct != null && Number.isFinite(f.activation_pct);
  const stats = computeFreeStats(f);
  const reps = f?.repetitions ?? [];
  const last = reps.at(-1);
  const spanMs = Math.max(f?.t_ms ?? 0, last?.ended_ms ?? 0, 5000);
  const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const unitLabel = f?.unit === 'uV' ? 'µV' : f?.unit ?? 'µV';

  if (terminal) {
    return (
      <section className="card session-card free-measure-card session-complete compact-terminal-card" aria-label="Tổng kết phiên đếm tự do">
        <div className="card-heading">
          <span className="section-label"><CheckCircle2 size={15} />HOÀN THÀNH ĐẾM TỰ DO</span>
          <span className="status-pill"><CheckCircle2 size={13} />Đã kết thúc</span>
        </div>

        <div className="terminal-summary-grid">
          <div className="terminal-summary-primary">
            <span className="terminal-summary-label">Số lần co cơ đạt</span>
            <strong className="terminal-summary-value">{stats.count} <small>lần</small></strong>
          </div>
          <div className="terminal-summary-meta">
            <div>
              <span>Thời gian đo</span>
              <strong>{duration(stats.durationMs)}</strong>
            </div>
            <div>
              <span>Kênh & vị trí cơ</span>
              <strong>{channelText(chId, settings.muscle)}</strong>
            </div>
            {reps.length > 0 && (
              <>
                <div>
                  <span>Tần suất</span>
                  <strong>{stats.ratePerMin.toFixed(1)} /phút</strong>
                </div>
                <div>
                  <span>Thời gian giữ TB</span>
                  <strong>{sec(stats.avgHoldMs)}</strong>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="session-buttons terminal-buttons">
          <button className="button primary" onClick={onResult} disabled={!hasRecord}>
            <Trophy size={16} />Xem kết quả<ArrowRight size={16} />
          </button>
          {onExport && (
            <button type="button" className="button outline" onClick={onExport} disabled={!hasRecord}>
              <ArrowDownToLine size={16} />Xuất dữ liệu
            </button>
          )}
          <button
            className="button outline"
            onClick={onNewSession ?? onResetCounter}
            disabled={!!pending || !connected}
          >
            <Plus size={16} />Buổi mới
          </button>
        </div>

        {saved && (
          <div className="session-foot">
            <SaveBadge />
          </div>
        )}
      </section>
    );
  }

  if (!active) {
    return (
      <section className="card session-card free-measure-card compact-prestart-card" aria-label="Sẵn sàng đếm tự do">
        <div className="card-heading">
          <span className="section-label"><Gauge size={15} />ĐẾM TỰ DO</span>
          <span className="status-pill">
            <span className="status-dot" />
            {connected ? 'Sẵn sàng đo' : connecting ? 'Đang kết nối…' : 'Chưa kết nối'}
          </span>
        </div>

        {(!f || f.source === 'simulation') && (
          <div className="sim-notice-inline">
            <FlaskConical size={15} />
            <span>Đang dùng tín hiệu mô phỏng · Không cần gắn điện cực</span>
          </div>
        )}

        <div className="prestart-center">
          <MuscleIllustration muscle={settings.muscle} phase="relax" state="idle" connected={connected} />
          <div className="prestart-guide">
            <h2>{phaseTitle}</h2>
            <p>Mỗi chu kỳ <strong>Co cơ vượt ngưỡng → Thả lỏng</strong> được ghi nhận 1 lần. Không giới hạn số lượt và thời gian giữ.</p>
            <div className="prestart-live-tag">
              <Activity size={14} />
              <span>{channelText(chId, settings.muscle)}</span>
              {connected && ch?.rms != null && (
                <strong>· {ch.rms.toFixed(0)} {unitLabel}</strong>
              )}
            </div>
          </div>
        </div>

        <div className="session-buttons free-buttons">
          <button className="button primary full-width" onClick={onStart} disabled={!!pending || connecting}>
            {pending ? <LoaderCircle className="spin" size={16} /> : <Play size={16} fill="currentColor" />}
            {pending ? 'Đang gửi…' : 'Bắt đầu'}
            <ArrowRight size={16} />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={`card session-card free-measure-card ${contracting ? 'is-contracting' : ''}`} aria-label="Bảng đo tự do">
      <div className="card-heading">
        <span className="section-label"><Gauge size={14} />ĐO TỰ DO · ĐỒNG BỘ OLED</span>
        <span className={`status-pill ${active && !f?.paused ? 'status-live' : ''}`}>
          {active && connected && !f?.paused ? <span className="pulse-dot" /> : <span className="status-dot" />}
          {!connected && f ? 'Mất kết nối' : f?.state === 'calibrating' ? 'Đang hiệu chuẩn' : f?.state === 'training' ? (f.paused ? 'Tạm dừng' : contracting ? 'Đang co cơ' : 'Thả lỏng') : 'Sẵn sàng'}
        </span>
      </div>

      <div className="free-hero">
        <div className="free-counter-block">
          <div className="rep-number free-rep-number" aria-live="polite">
            <strong>{stats.count}</strong>
            <span>lần co đạt</span>
          </div>
          <div className="rep-caption">
            {muscleLabel(settings.muscle)} · Kênh {chId}
          </div>
        </div>
        <div className={`free-phase-beacon ${contracting ? 'contracting' : f?.paused ? 'paused' : 'relaxed'}`} role="status">
          <span className="beacon-ring" />
          <div>
            <strong>
              {!connected && f ? 'MẤT KẾT NỐI' : f?.state === 'calibrating' ? 'THA LONG' : f?.state === 'training' ? (f.paused ? 'TAM DUNG' : contracting ? `DANG CO ${((f.current_hold_ms ?? 0) / 1000).toFixed(1)}S` : 'THA LONG') : 'CHO DO'}
            </strong>
            <span>
              <Clock3 size={12} />
              {duration(stats.durationMs)}
            </span>
          </div>
        </div>
      </div>

      <div className="free-signal-meter" aria-label="Mức tín hiệu so với ngưỡng co">
        <div className="free-signal-head">
          <span><Activity size={13} />RMS trực tiếp (CH{chId})</span>
          <strong>
            {connected && ch?.rms != null ? `${ch.rms.toFixed(0)} ${unitLabel}` : 'Đang chờ mẫu'}
            {on > 0 && <small> / ngưỡng {on.toFixed(0)}</small>}
            {actAvailable && <small> · {f!.activation_pct!.toFixed(0)}% ({actLevels[f!.activation_level ?? 'unavailable']})</small>}
          </strong>
        </div>
        <div className="free-signal-track" role="meter" aria-valuemin={0} aria-valuemax={on > 0 ? Math.round(on * 2) : 200} aria-valuenow={Math.round(rms)}>
          <span className={`free-signal-fill ${contracting ? 'above' : ''}`} style={{ width: `${barPct}%` }} />
          {on > 0 && <i className="threshold-mark off" style={{ left: `${offPct}%` }} title={`Ngưỡng thả: ${off.toFixed(0)}`} />}
          {on > 0 && <i className="threshold-mark on" style={{ left: '50%' }} title={`Ngưỡng co: ${on.toFixed(0)}`} />}
        </div>
        <div className="free-signal-legend">
          <span>Thả &lt;{off.toFixed(0)}</span>
          <span>Ngưỡng co {on.toFixed(0)}</span>
          {measuring && f?.current_rest_ms != null ? (
            <span>Nghỉ: {sec(f.current_rest_ms)}</span>
          ) : null}
        </div>
      </div>

      {f?.state === 'calibrating' && (
        <div className="calibration">
          <span>Đang hiệu chuẩn mức nghỉ <strong>{Math.round(f.calibration_progress * 100)}%</strong></span>
          <div className="progress-track"><span style={{ width: `${f.calibration_progress * 100}%` }} /></div>
        </div>
      )}

      <div className="free-kpi-grid" aria-label="Thống kê phiên đo tự do">
        <div>
          <span>Tần suất</span>
          <strong>{stats.ratePerMin.toFixed(1)} <small>/phút</small></strong>
        </div>
        {reps.length > 0 && (
          <>
            <div>
              <span>Co TB</span>
              <strong>{sec(stats.avgHoldMs)}</strong>
            </div>
            <div>
              <span>Dài nhất</span>
              <strong>{sec(stats.longestHoldMs)}</strong>
            </div>
          </>
        )}
        {reps.length > 1 && (
          <div>
            <span>Nghỉ TB</span>
            <strong>{sec(stats.avgRestMs)}</strong>
          </div>
        )}
      </div>

      <div className="free-timeline" aria-label="Dòng thời gian các lần co cơ">
        <div className="free-timeline-head">
          <span>Nhịp co ({reps.length} lần)</span>
          {last ? <strong>Lần #{last.ordinal}: {sec(last.hold_ms)}</strong> : <span>{phaseTitle}</span>}
        </div>
        <div className="free-timeline-track">
          {reps.length === 0 ? (
            <span className="free-timeline-empty">{phaseDescription}</span>
          ) : (
            reps.map(r => {
              const startMs = Math.max(0, r.ended_ms - r.hold_ms);
              const left = Math.min(98, (startMs / spanMs) * 100);
              const width = Math.max(1.6, Math.min(100 - left, (r.hold_ms / spanMs) * 100));
              return (
                <i
                  key={r.id}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`Lần #${r.ordinal}: co ${(r.hold_ms / 1000).toFixed(2)}s`}
                />
              );
            })
          )}
        </div>
      </div>

      <div className="session-buttons free-buttons">
        <button className="button subtle" onClick={onPauseResume} disabled={f?.state !== 'training' || !!pending || !connected}>
          {f?.paused ? <Play size={15} fill="currentColor" /> : <Pause size={15} />}
          {f?.paused ? 'Tiếp tục' : 'Tạm dừng'}
        </button>
        <button
          className="button outline"
          onClick={onResetCounter}
          disabled={!!pending || !connected || f?.state !== 'training' || stats.count === 0}
        >
          <RotateCcw size={15} />Đặt lại
        </button>
        <button className="button danger" onClick={onStop} disabled={pending === 'stop' || !connected}>
          {pending === 'stop' ? <LoaderCircle className="spin" size={16} /> : <Square size={14} fill="currentColor" />}
          {pending === 'stop' ? 'Đang dừng…' : 'Kết thúc'}
        </button>
      </div>

      {onExport && hasRecord && (
        <div className="active-export-inline">
          <button type="button" className="text-button" onClick={onExport}>
            <ArrowDownToLine size={14} />Xuất dữ liệu (bản chụp đang chạy)
          </button>
        </div>
      )}

      <div className="session-foot">
        {saved ? <SaveBadge /> : <><ShieldCheck size={12} />Đồng bộ trực tiếp với màn hình OLED</>}
      </div>
    </section>
  );
}
