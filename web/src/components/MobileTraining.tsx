import { useState, type KeyboardEvent } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, CheckCircle2, ChevronRight, Clock3, FlaskConical, Gauge, Leaf, LoaderCircle, Pause, Play, Plus, RefreshCw, RotateCcw, Settings2, ShieldCheck, Square, Target, Trophy, Wifi, WifiOff } from 'lucide-react';
import type { ViewState } from '../core/controller';
import { isActive, isFreeMode, isTerminal, modeLabel, stateLabels, type Settings, type TrainingMode } from '../core/protocol';
import { channelText } from '../core/channelMap';
import { MuscleIllustration } from './MuscleIllustration';
import { SignalChart } from './SignalChart';
import { Modal, SaveBadge, duration } from './UI';
import { ActivationFeedback } from './ActivationFeedback';
import { FreeMeasure } from './FreeMeasure';
import { TrainingSettings } from './TrainingSettings';

type Pane = 'coach' | 'signal';

type Props = {
  countdown?: number | null;
  view: ViewState;
  settings: Settings;
  onSettingsChange: (s: Settings) => void | Promise<boolean | void>;
  onModeChange: (m: TrainingMode) => void;
  phaseTitle: string;
  phaseDescription: string;
  onStart: () => void;
  onPauseResume: () => void;
  onResetCounter: () => void;
  onStop: () => void;
  onNewSession: () => void;
  onResult: () => void;
  onDevice: () => void;
  onCalibrate: () => void;
  onReconnect: () => void;
  rawRecording?: boolean;
  onRawRecordingChange?: (enabled: boolean) => void;
  onExport?: () => void;
};

export function MobileTraining({
  countdown = null,
  view,
  settings,
  onSettingsChange,
  onModeChange,
  phaseTitle,
  phaseDescription,
  onStart,
  onPauseResume,
  onResetCounter,
  onStop,
  onNewSession,
  onResult,
  onDevice,
  onCalibrate,
  onReconnect,
  rawRecording = false,
  onRawRecordingChange,
  onExport,
}: Props) {
  const [pane, setPane] = useState<Pane>('coach');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const f = view.frame;
  const active = isActive(f?.state) || countdown !== null;
  const terminal = isTerminal(f?.state);
  const delayed = isActive(f?.state) && (view.diagnostics.sample_age_ms ?? 0) > 500;
  const connected = view.connection === 'connected' && view.live;

  // Authoritative settings: locked to frame during active/terminal session, single CH1 channel always
  const current: Settings = active || terminal ? (f?.settings ?? settings) : settings;
  const activeChannel = 1 as const;
  const activeMuscle = current.muscle;
  const free = isFreeMode(current);
  const contracting = connected && !delayed && f?.state === 'training' && !f?.paused && (f?.phase === 'contract' || f?.phase === 'hold');
  const valid = f?.valid_count ?? 0;
  const total = f?.total_count ?? 0;
  const failedAttempts = Math.max(0, total - valid);
  const goal = current.target;
  const last = f?.repetitions.at(-1);
  const hasSaved = !!view.record && !!view.savedAt && !view.storageError;
  const isSimulation = !f || f.source === 'simulation';
  const chData = f?.channels.find(c => c.id === 1) ?? f?.channels[0];
  const unitLabel = f?.unit === 'uV' ? 'µV' : f?.unit ?? 'µV';

  const statusText = !connected && f
    ? 'Chưa xác nhận'
    : countdown !== null
      ? `Đếm ngược ${countdown}s`
      : free
        ? f?.state === 'calibrating'
          ? 'Đang hiệu chuẩn'
          : f?.state === 'training'
            ? f.paused
              ? 'Tạm dừng'
              : contracting
                ? 'Đang co cơ'
                : 'Thả lỏng'
            : terminal
              ? 'Đã kết thúc'
              : 'Sẵn sàng đo'
        : f
          ? f.paused
            ? 'Tạm dừng'
            : stateLabels[f.state]
          : 'Sẵn sàng';

  const summaryText = free
    ? `${channelText(activeChannel, activeMuscle)} · Đếm tự do`
    : `${channelText(activeChannel, activeMuscle)} · ${goal} lượt · Giữ ${(current.min_hold_ms / 1000).toLocaleString('vi-VN')} giây`;

  const stepState: 'contract' | 'hold' | 'release' | 'relax' =
    f?.state !== 'training' || f?.paused
      ? 'relax'
      : f.phase === 'release'
        ? 'release'
        : f.phase === 'hold'
          ? 'hold'
          : f.phase === 'contract'
            ? 'contract'
            : 'relax';

  const navigateTabs = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const next = e.key === 'Home' ? 'coach' : e.key === 'End' ? 'signal' : pane === 'coach' ? 'signal' : 'coach';
      setPane(next);
      document.getElementById(`mobile-tab-${next}`)?.focus();
    }
  };

  return (
    <section
      className={`mobile-trainer mobile-pane-${pane} ${active ? 'mobile-trainer-active' : terminal ? 'mobile-trainer-terminal' : 'mobile-trainer-idle'}`}
      aria-label="Buổi tập trên điện thoại"
    >
      <h1 className="sr-only">Tập luyện cơ</h1>

      {/* Top status & mode row (hidden during active session to save vertical space) */}
      {!active && (
        <div className="mobile-top-row">
          <button
            type="button"
            className={`mobile-connection ${connected ? 'connected' : ''}`}
            onClick={onDevice}
            aria-label={`Nguồn tín hiệu: ${isSimulation ? 'Mô phỏng' : 'Thiết bị thật'}, ${connected ? 'Đã kết nối' : 'Chưa kết nối'}. Chạm để mở Thiết bị.`}
          >
            {isSimulation ? <FlaskConical size={14} /> : connected ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span className="mobile-conn-label">
              {isSimulation ? 'Mô phỏng' : f?.source === 'replay' ? 'Phát lại' : 'Thiết bị'} ·{' '}
              {connected ? 'Sẵn sàng' : view.connection === 'connecting' ? 'Đang nối…' : 'Chưa nối'}
            </span>
            <ChevronRight size={13} />
          </button>

          <div className="segmented mobile-mode-switch" role="group" aria-label="Chế độ tập luyện">
            <button
              type="button"
              aria-pressed={!free}
              disabled={active || !!view.pending}
              onClick={() => onModeChange('training')}
            >
              <Target size={13} />Luyện tập
            </button>
            <button
              type="button"
              aria-pressed={free}
              disabled={active || !!view.pending}
              onClick={() => onModeChange('free')}
            >
              <Gauge size={13} />Đếm tự do
            </button>
          </div>
        </div>
      )}

      {/* Summary bar with Edit button */}
      <div className="mobile-summary-bar">
        <div className="mobile-summary-text" title={summaryText}>
          <strong>{summaryText}</strong>
        </div>
        <button
          type="button"
          className="mobile-edit-btn"
          aria-haspopup="dialog"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={15} />
          <span>Chỉnh</span>
        </button>
      </div>

      {/* Coach / Signal view switcher when active or when samples exist */}
      {(active || (view.record?.samples.length ?? 0) > 0) && !terminal && (
        <div className="mobile-view-tabs" role="tablist" aria-label="Chuyển đổi Hướng dẫn và Biểu đồ">
          <button
            id="mobile-tab-coach"
            type="button"
            role="tab"
            aria-selected={pane === 'coach'}
            aria-controls="mobile-coach-panel"
            tabIndex={pane === 'coach' ? 0 : -1}
            onKeyDown={navigateTabs}
            onClick={() => setPane('coach')}
          >
            <Leaf size={14} />{free ? 'Bộ đếm' : 'Hướng dẫn'}
          </button>
          <button
            id="mobile-tab-signal"
            type="button"
            role="tab"
            aria-selected={pane === 'signal'}
            aria-controls="mobile-signal-panel"
            tabIndex={pane === 'signal' ? 0 : -1}
            onKeyDown={navigateTabs}
            onClick={() => setPane('signal')}
          >
            <Activity size={14} />Biểu đồ
          </button>
        </div>
      )}

      {/* Main State-Specific Content */}
      <div className="mobile-training-stage">
        {pane === 'signal' && !terminal ? (
          <section id="mobile-signal-panel" role="tabpanel" aria-labelledby="mobile-tab-signal" className="mobile-signal-view">
            <div className="mobile-signal-summary">
              <span>
                <strong>{valid}</strong> {free ? 'lần co đạt' : `/ ${goal} lượt đạt`}
                {!free && total > 0 && <small> ({total} lần thử)</small>}
              </span>
              <span>{phaseTitle}</span>
            </div>
            <SignalChart
              samples={view.record?.samples ?? []}
              frame={f}
              live={connected && active && !f?.paused}
              delayed={delayed}
            />
          </section>
        ) : free ? (
            <FreeMeasure
            frame={f}
            settings={{ ...current, channel: activeChannel, muscle: activeMuscle }}
            connected={connected}
            delayed={delayed}
            pending={view.pending}
            connecting={view.connection === 'connecting'}
            countdown={countdown}
            saved={hasSaved}
            hasRecord={!!view.record}
            phaseTitle={phaseTitle}
            phaseDescription={phaseDescription}
            onStart={() => { setPane('coach'); onStart(); }}
            onPauseResume={onPauseResume}
            onResetCounter={onResetCounter}
            onStop={onStop}
            onResult={onResult}
            onNewSession={() => { setPane('coach'); onNewSession(); }}
            onExport={onExport}
          />
        ) : terminal ? (
          /* STATE C: HOÀN THÀNH / ĐÃ KẾT THÚC (Compact summary card, no stretching, no "—") */
          <section
            id="mobile-coach-panel"
            className={`card mobile-summary-card ${f?.state === 'completed' ? 'completed' : 'stopped'}`}
            aria-label="Tổng kết buổi tập"
          >
            <div className="mobile-summary-header">
              <div className="summary-badge-group">
                <span className="summary-icon">
                  {f?.state === 'completed' ? <Trophy size={20} /> : <CheckCircle2 size={20} />}
                </span>
                <div>
                  <h2>{f?.state === 'completed' ? 'Hoàn thành mục tiêu' : 'Buổi tập đã kết thúc'}</h2>
                  <p>{modeLabel(current.mode)} · {channelText(activeChannel, activeMuscle)}</p>
                </div>
              </div>
              <span className="status-pill">
                <CheckCircle2 size={13} />{f ? stateLabels[f.state] : 'Hoàn thành'}
              </span>
            </div>

            <div className="mobile-summary-metrics">
              <div className="summary-metric-box highlight">
                <span className="metric-label">Số lượt đạt mục tiêu</span>
                <strong className="metric-value">{valid} <small>/ {goal} lượt</small></strong>
                {total > 0 && (
                  <span className="metric-sub">
                    Tổng lần thử: {total} ({valid} đạt{failedAttempts > 0 ? `, ${failedAttempts} chưa đủ giữ` : ''})
                  </span>
                )}
              </div>
              <div className="summary-metric-row">
                <div className="summary-metric-box">
                  <span className="metric-label">Thời gian tập</span>
                  <strong className="metric-value-sm">{duration(f?.duration_ms ?? 0)}</strong>
                </div>
                <div className="summary-metric-box">
                  <span className="metric-label">Kênh & vị trí cơ</span>
                  <strong className="metric-value-sm">{channelText(activeChannel, activeMuscle)}</strong>
                </div>
              </div>
            </div>

            {hasSaved && (
              <div className="summary-saved-row">
                <SaveBadge />
              </div>
            )}

            <div className="mobile-result-actions">
              <button
                type="button"
                className="button primary"
                disabled={!view.record}
                onClick={onResult}
              >
                <Trophy size={16} />Xem kết quả<ArrowRight size={15} />
              </button>
              {onExport && (
                <button
                  type="button"
                  className="button outline"
                  disabled={!view.record}
                  onClick={onExport}
                >
                  <ArrowDownToLine size={16} />Xuất dữ liệu
                </button>
              )}
              <button
                type="button"
                className="button outline"
                disabled={!!view.pending || !connected}
                onClick={() => { setPane('coach'); onNewSession(); }}
              >
                <Plus size={16} />Buổi mới
              </button>
            </div>
          </section>
        ) : !active ? (
          /* STATE A: CHƯA BẮT ĐẦU (Pre-start card: signal source, illustration, short guide, Start button) */
          <section
            id="mobile-coach-panel"
            className="card mobile-prestart-card"
            aria-label="Chuẩn bị bắt đầu buổi tập"
          >
            <div className="prestart-status-row">
              <span className="prestart-source-tag">
                {isSimulation ? <FlaskConical size={14} /> : <ShieldCheck size={14} />}
                <span>
                  {isSimulation
                    ? 'Đang dùng tín hiệu mô phỏng · Không cần gắn điện cực'
                    : `Nguồn cảm biến thật · ${f?.device_name ?? 'ESP32 sEMG'}`}
                </span>
              </span>
            </div>

            <div className="prestart-visual-row">
              <MuscleIllustration
                muscle={activeMuscle}
                phase="relax"
                state={f?.state ?? 'idle'}
                connected={connected}
              />
              <div className="prestart-instructions">
                <h2>{channelText(activeChannel, activeMuscle)}</h2>
                <p className="prestart-short-guide">
                  <strong>Co cơ</strong> vượt ngưỡng → <strong>Giữ {(current.min_hold_ms / 1000).toLocaleString('vi-VN')}s</strong>{current.zone_enabled ? ' trong vùng' : ''} → <strong>Thả lỏng</strong> để tính 1 lượt đạt (mục tiêu {goal} lượt).
                </p>
                {connected && chData?.rms != null && (
                  <div className="prestart-live-rms">
                    <Activity size={13} />
                    <span>Tín hiệu CH{activeChannel}: <strong>{chData.rms.toFixed(0)} {unitLabel}</strong></span>
                  </div>
                )}
              </div>
            </div>

            <div className="prestart-action-row">
              <button
                type="button"
                className="button primary mobile-primary-action"
                disabled={!!view.pending || view.connection === 'connecting'}
                onClick={() => { setPane('coach'); onStart(); }}
              >
                {view.pending || view.connection === 'connecting' ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
                <span>
                  {view.pending ? 'Đang chuẩn bị…' : view.connection === 'connecting' ? 'Đang kết nối…' : 'Bắt đầu'}
                </span>
                <ArrowRight size={17} />
              </button>
            </div>
          </section>
        ) : (
          /* STATE B: ĐANG TẬP / ĐANG HIỆU CHUẨN (Active training card) */
          <section
            id="mobile-coach-panel"
            role="tabpanel"
            aria-labelledby="mobile-tab-coach"
            className="card mobile-active-card"
          >
            <div className="mobile-active-top">
              <div className="mobile-rep-block">
                <span className="rep-eyebrow">LƯỢT ĐẠT MỤC TIÊU</span>
                <div className="mobile-rep-count" aria-live="polite">
                  <strong>{valid}</strong>
                  <span>/ {goal}</span>
                </div>
                <div className="mobile-rep-sub">
                  <span><Clock3 size={12} /> {duration(f?.duration_ms ?? 0)}</span>
                  <span>· Tổng lần thử: <strong>{total}</strong>{failedAttempts > 0 ? ` (chưa đạt: ${failedAttempts})` : ''}</span>
                </div>
              </div>
              <span className={`status-pill ${contracting ? 'status-live' : ''}`}>
                {connected && active && !f?.paused ? <span className="pulse-dot" /> : <span className="status-dot" />}
                {statusText}
              </span>
            </div>

            <div
              className="mobile-goal-progress"
              role="progressbar"
              aria-label="Tiến độ lượt đạt mục tiêu"
              aria-valuenow={valid}
              aria-valuemin={0}
              aria-valuemax={goal}
            >
              <span style={{ width: `${Math.min(100, (valid / goal) * 100)}%` }} />
            </div>

            {/* Central area: Muscle illustration + Co - Giữ - Thả rhythm */}
            <div className="mobile-center-coach">
              <MuscleIllustration
                muscle={activeMuscle}
                phase={f?.phase}
                state={f?.state}
                paused={f?.paused}
                connected={connected && !delayed}
              />
              <div className="mobile-cues-box">
                <div className="rhythm-pills" aria-label="Nhịp tập Co – Giữ – Thả">
                  <span className={`rhythm-pill ${stepState === 'contract' ? 'active' : ''}`}>1. Co</span>
                  <span className={`rhythm-pill ${stepState === 'hold' ? 'active' : ''}`}>2. Giữ</span>
                  <span className={`rhythm-pill ${stepState === 'release' ? 'active' : ''}`}>3. Thả</span>
                </div>
                <div className={`mobile-instruction ${!connected && f ? 'unconfirmed' : ''}`} aria-live="polite">
                  <h2>{phaseTitle}</h2>
                  <p>{phaseDescription}</p>
                </div>
              </div>
            </div>

            {/* Hold progress or Calibration progress */}
            {f?.state === 'calibrating' ? (
              <div className="mobile-hold">
                <div>
                  <span>Thả lỏng để hiệu chuẩn mức nghỉ</span>
                  <strong>{Math.round(f.calibration_progress * 100)}%</strong>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="Tiến độ hiệu chuẩn"
                  aria-valuenow={Math.round(f.calibration_progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${f.calibration_progress * 100}%` }} />
                </div>
              </div>
            ) : f?.state === 'training' ? (
              <div className="mobile-hold">
                <div>
                  <span>{current.zone_enabled ? 'Thời gian giữ trong vùng' : 'Tiến trình giữ cơ'}</span>
                  <strong>
                    {((current.zone_enabled ? (f.longest_in_zone_ms ?? 0) : f.current_hold_ms) / 1000).toFixed(1)} / {(current.min_hold_ms / 1000).toLocaleString('vi-VN')} giây
                  </strong>
                </div>
                <div className="progress-track">
                  <span
                    style={{
                      width: `${connected ? Math.min(100, ((current.zone_enabled ? (f.longest_in_zone_ms ?? 0) : f.current_hold_ms) / Math.max(1, current.min_hold_ms)) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            {/* Live activation feedback & real signal metrics */}
            <ActivationFeedback frame={f} live={connected && !delayed} />

            {connected && chData?.rms != null && (
              <div className="mobile-live-metrics">
                <span><Activity size={13} />RMS {channelText(activeChannel, activeMuscle)}: <strong>{chData.rms.toFixed(0)} {unitLabel}</strong></span>
                <span>Ngưỡng co: <strong>{chData.on_threshold.toFixed(0)} {unitLabel}</strong></span>
              </div>
            )}

            {last && (
              <div className={`mobile-last-rep ${last.valid ? 'valid' : 'invalid'}`} role="status">
                {last.valid ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
                <span>
                  Lần thử thứ {total}: <strong>{last.valid ? 'Đạt mục tiêu' : current.zone_enabled ? 'Chưa đủ thời gian trong vùng' : 'Giữ chưa đủ thời gian'}</strong> ({(last.hold_ms / 1000).toFixed(1)} giây)
                </span>
              </div>
            )}

            {/* Clear hierarchy for Pause/Resume and End buttons */}
            <div className="mobile-active-actions">
              {!connected && (
                <button type="button" className="button outline full-width" onClick={onReconnect}>
                  <RefreshCw size={15} />Kết nối lại thiết bị
                </button>
              )}
              <div className="mobile-active-btn-row">
                {f?.state === 'training' && (
                  <button
                    type="button"
                    className="button subtle"
                    onClick={onPauseResume}
                    disabled={!!view.pending || !connected}
                  >
                    {f.paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} />}
                    <span>{f.paused ? 'Tiếp tục' : 'Tạm dừng'}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="button danger"
                  onClick={onStop}
                  disabled={view.pending === 'stop' || !connected}
                >
                  {view.pending === 'stop' ? <LoaderCircle className="spin" size={16} /> : <Square size={15} fill="currentColor" />}
                  <span>{view.pending === 'stop' ? 'Đang kết thúc…' : f?.state === 'calibrating' || countdown !== null ? 'Hủy' : 'Kết thúc buổi'}</span>
                </button>
              </div>
              {onExport && view.record && (
                <div className="active-export-inline">
                  <button type="button" className="text-button" onClick={onExport}>
                    <ArrowDownToLine size={14} />Xuất dữ liệu (bản chụp đang chạy)
                  </button>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {settingsOpen && (
        <Modal title="Thiết lập buổi tập" variant="sheet" onClose={() => setSettingsOpen(false)}>
          <TrainingSettings
            settings={current}
            onChange={onSettingsChange}
            onCancel={() => setSettingsOpen(false)}
            state={f?.state}
            pending={!!view.pending || countdown !== null}
            connected={connected}
            rawRecording={rawRecording}
            onRawRecordingChange={onRawRecordingChange}
            onCalibrate={() => {
              setSettingsOpen(false);
              setPane('coach');
              onCalibrate();
            }}
          />
        </Modal>
      )}
    </section>
  );
}
