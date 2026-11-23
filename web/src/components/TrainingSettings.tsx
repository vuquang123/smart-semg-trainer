import { useEffect, useState } from 'react';
import { Activity, Check, ChevronDown, Clock3, FlaskConical, Gauge, LoaderCircle, RotateCcw, SlidersHorizontal, Target, X } from 'lucide-react';
import { isActive, isFreeMode, isTerminal, muscleLabel, sameSettings, settingsSchema, type SessionState, type Settings, type TrainingMode } from '../core/protocol';

type Props = {
  settings: Settings;
  onChange: (settings: Settings) => void | Promise<boolean | void>;
  onModeChange?: (mode: TrainingMode) => void;
  onCancel?: () => void;
  state?: SessionState;
  pending: boolean;
  connected: boolean;
  onCalibrate: () => void;
  rawRecording?: boolean;
  onRawRecordingChange?: (enabled: boolean) => void;
};

export function TrainingSettings({
  settings,
  onChange,
  onCancel,
  state,
  pending,
  connected,
  onCalibrate,
  rawRecording = false,
  onRawRecordingChange,
}: Props) {
  const [draft, setDraft] = useState<Settings>(() => ({ ...settings, channel: 1 }));
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setDraft({ ...settings, channel: 1 });
  }, [
    settings.mode,
    settings.muscle,
    settings.target,
    settings.min_hold_ms,
    settings.reference_rms,
    settings.zone_enabled,
    settings.zone_low_pct,
    settings.zone_high_pct,
  ]);

  const active = isActive(state);
  const terminal = isTerminal(state);
  const busy = pending || applying;
  const locked = active || busy;
  const free = isFreeMode(draft);
  const validation = settingsSchema.safeParse({ ...draft, channel: 1 });
  const validationError = !validation.success ? validation.error.issues[0]?.message ?? 'Thiết lập chưa hợp lệ.' : null;
  const dirty = !sameSettings({ ...draft, channel: 1 }, { ...settings, channel: 1 });

  const selectMode = (mode: TrainingMode) => {
    if (locked) return;
    setDraft(prev => ({ ...prev, channel: 1, mode: mode === 'free' ? 'free' : undefined }));
  };

  const selectMuscle = (muscle: 'forearm' | 'biceps') => {
    if (locked) return;
    setDraft(prev => ({ ...prev, channel: 1, muscle }));
  };

  const handleApply = async () => {
    if (locked || !validation.success) return;
    setApplying(true);
    try {
      const result = await onChange({ ...validation.data, channel: 1 });
      if (result !== false && onCancel) {
        onCancel();
      }
    } finally {
      setApplying(false);
    }
  };

  const handleCancel = () => {
    setDraft({ ...settings, channel: 1 });
    onCancel?.();
  };

  return (
    <div className="training-settings">
      <div className="settings-scroll-body">
        <fieldset disabled={locked}>
          <legend className="sr-only">Chế độ tập luyện</legend>
          <span className="field-label" id="mode-label">Chế độ buổi tập</span>
          <div className="segmented mode-picker" role="group" aria-labelledby="mode-label">
            <button type="button" aria-pressed={!free} onClick={() => selectMode('training')}>
              <Target size={16} />
              <span>Luyện tập</span>
              {!free && <Check size={14} className="selected-check" aria-hidden="true" />}
            </button>
            <button type="button" aria-pressed={free} onClick={() => selectMode('free')}>
              <Gauge size={16} />
              <span>Đếm tự do</span>
              {free && <Check size={14} className="selected-check" aria-hidden="true" />}
            </button>
          </div>
        </fieldset>

        <fieldset disabled={locked} className="channel-unified-group">
          <legend className="sr-only">Vị trí đặt điện cực trên kênh CH1</legend>
          <div className="field-label-row">
            <span className="field-label" id="channel-muscle-label">
              Vị trí đặt điện cực (Kênh CH1)
            </span>
          </div>
          <div className="segmented channel-muscle-picker" role="group" aria-labelledby="channel-muscle-label">
            {(['forearm', 'biceps'] as const).map(m => {
              const selected = draft.muscle === m;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => selectMuscle(m)}
                >
                  <Activity size={15} />
                  <span>{muscleLabel(m)}</span>
                  {selected && <Check size={14} className="selected-check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <p className="channel-rule-note">
            Đo trên 1 kênh CH1 · Vùng cơ là thông tin vị trí đặt điện cực của phiên tập.
          </p>
        </fieldset>

        <fieldset disabled={locked}>
          <legend className="sr-only">Thông số buổi tập</legend>
          {!free && (
            <>
              <div className="setting-row">
                <span><Target size={17} />Mục tiêu số lượt đạt</span>
                <div className="stepper">
                  <button
                    type="button"
                    aria-label="Giảm mục tiêu"
                    disabled={locked || draft.target <= 1}
                    onClick={() => setDraft({ ...draft, target: Math.max(1, draft.target - 1) })}
                  >
                    −
                  </button>
                  <output aria-label="Mục tiêu số lượt">{draft.target}</output>
                  <button
                    type="button"
                    aria-label="Tăng mục tiêu"
                    disabled={locked || draft.target >= 100}
                    onClick={() => setDraft({ ...draft, target: Math.min(100, draft.target + 1) })}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="setting-row">
                <label htmlFor="hold-select"><Clock3 size={17} />Thời gian giữ cơ</label>
                <select
                  id="hold-select"
                  value={draft.min_hold_ms}
                  onChange={e => setDraft({ ...draft, min_hold_ms: Number(e.target.value) })}
                >
                  {[200, 500, 1000, 2000, 3000, 5000].map(n => (
                    <option key={n} value={n}>{(n / 1000).toLocaleString('vi-VN')} giây</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <details className="advanced-settings">
            <summary>
              <span><SlidersHorizontal size={15} />Thiết lập nâng cao</span>
              <small>
                Mốc {draft.reference_rms ?? 'chưa đặt'} µV
                {!free && draft.zone_enabled ? ` · Vùng ${draft.zone_low_pct ?? 40}–${draft.zone_high_pct ?? 70}%` : ''}
              </small>
              <ChevronDown size={15} className="summary-chevron" />
            </summary>
            <div className="reference-setting">
              <div className="setting-row">
                <label htmlFor="reference-rms">Mốc RMS tham chiếu (µV)</label>
                <input
                  id="reference-rms"
                  type="number"
                  min="1"
                  max="1000000"
                  step="1"
                  value={draft.reference_rms ?? ''}
                  onFocus={e => e.currentTarget.scrollIntoView({ block: 'nearest' })}
                  onChange={e => {
                    const n = e.currentTarget.valueAsNumber;
                    const validRef = Number.isFinite(n) && n > 0 ? Math.min(1e6, n) : undefined;
                    setDraft({
                      ...draft,
                      reference_rms: validRef,
                      zone_enabled: validRef ? draft.zone_enabled : false,
                    });
                  }}
                />
              </div>
              <p className="microcopy">
                Cùng đơn vị với RMS trên biểu đồ. Mô phỏng dùng mốc 300 µV. Với dữ liệu thật, nhập mốc co tham chiếu của người tập trong cùng điều kiện đo; hiệu chuẩn nghỉ không tự xác định mốc này.
              </p>
              {!free && (
                <>
                  <label className="zone-toggle">
                    <input
                      type="checkbox"
                      checked={draft.zone_enabled ?? false}
                      disabled={!draft.reference_rms}
                      onChange={e => setDraft({ ...draft, zone_enabled: e.target.checked })}
                    />
                    <span>Tập trong vùng mục tiêu (% mốc tham chiếu)</span>
                  </label>
                  {draft.zone_enabled && (
                    <>
                      <div className="zone-inputs">
                        <label>
                          Cận dưới (% mốc)
                          <input
                            type="number"
                            min="0"
                            max={(draft.zone_high_pct ?? 70) - 1}
                            value={draft.zone_low_pct ?? 40}
                            onFocus={e => e.currentTarget.scrollIntoView({ block: 'nearest' })}
                            onChange={e =>
                              setDraft({
                                ...draft,
                                zone_low_pct: Math.max(0, Math.min((draft.zone_high_pct ?? 70) - 1, Number(e.target.value))),
                              })
                            }
                          />
                        </label>
                        <label>
                          Cận trên (% mốc)
                          <input
                            type="number"
                            min={(draft.zone_low_pct ?? 40) + 1}
                            max="200"
                            value={draft.zone_high_pct ?? 70}
                            onFocus={e => e.currentTarget.scrollIntoView({ block: 'nearest' })}
                            onChange={e =>
                              setDraft({
                                ...draft,
                                zone_high_pct: Math.min(200, Math.max((draft.zone_low_pct ?? 40) + 1, Number(e.target.value))),
                              })
                            }
                          />
                        </label>
                      </div>
                      <p className="microcopy">
                        Lượt đạt khi giữ liên tục đủ thời gian trong vùng, rồi thả. Ra khỏi vùng sẽ bắt đầu lại thời gian liên tục; khoảng lâu nhất của lượt vẫn được lưu.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          </details>
        </fieldset>

        {validationError && (
          <div className="alert error settings-validation-error" role="alert">
            <span>{validationError}</span>
          </div>
        )}

        {onRawRecordingChange && (
          <div className="raw-record-toggle-box">
            <label className="toggle-row compact-toggle">
              <span>
                <strong><FlaskConical size={14} /> Ghi dữ liệu RAW cho nghiên cứu</strong>
                <small>
                  {rawRecording
                    ? 'Đang bật — lưu tín hiệu gốc theo lô vào bộ nhớ cục bộ để xuất gói nghiên cứu (.zip).'
                    : 'Đang tắt — phiên này sẽ chỉ lưu tổng kết và RMS cho Báo cáo buổi tập, không thể xuất tín hiệu gốc (signal_raw.csv).'}
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={rawRecording}
                disabled={locked}
                onChange={e => onRawRecordingChange(e.target.checked)}
              />
            </label>
          </div>
        )}

        <div className="settings-secondary-row">
          <button
            type="button"
            className="button outline full-width calibrate-button"
            disabled={locked || !connected}
            onClick={onCalibrate}
          >
            <RotateCcw size={16} />Hiệu chuẩn mức nghỉ
          </button>
        </div>

        <p className="microcopy settings-status-note">
          {active
            ? 'Thông số buổi tập và vị trí đặt điện cực CH1 được khóa khi đang đo.'
            : terminal
              ? 'Nhấn Áp dụng để tạo buổi mới với thiết lập đã chọn.'
              : dirty
                ? 'Có thay đổi chưa áp dụng. Nhấn Áp dụng để xác nhận.'
                : free
                  ? 'Đo liên tục trên kênh CH1 không giới hạn số lượt; mỗi chu kỳ co → thả tính 1 lần.'
                  : 'Thiết lập đang áp dụng cho buổi tập trên kênh CH1.'}
        </p>
      </div>

      <div className="settings-footer-actions">
        {(onCancel || dirty) && (
          <button
            type="button"
            className="button subtle"
            disabled={applying}
            onClick={handleCancel}
          >
            <X size={16} />{onCancel ? 'Hủy' : 'Hoàn tác'}
          </button>
        )}
        <button
          type="button"
          className="button primary settings-apply-btn"
          disabled={locked || !!validationError || (!dirty && !onCancel)}
          onClick={() => void handleApply()}
        >
          {applying || pending ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
          <span>{applying || pending ? 'Đang áp dụng…' : 'Áp dụng'}</span>
        </button>
      </div>
    </div>
  );
}
