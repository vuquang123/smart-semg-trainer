import { Activity, Clock3, Target } from 'lucide-react';
import { isFreeMode, type Frame } from '../core/protocol';

const levels = { low: 'Thấp', medium: 'Vừa', high: 'Cao', unavailable: 'Chưa có mốc' };
const zones = { below: 'Dưới vùng mục tiêu', inside: 'Trong vùng mục tiêu', above: 'Trên vùng mục tiêu', unavailable: 'Chưa có dữ liệu' };
export function ActivationFeedback({ frame: f, live }: { frame: Frame | null; live: boolean }) {
  if (!f) return null;
  const measuring = live && f.state === 'training' && !f.paused;
  const available = measuring && f.activation_pct != null && Number.isFinite(f.activation_pct);
  const zoneEnabled = !!f.settings.zone_enabled && !isFreeMode(f.settings);
  const zone = available ? f.target_zone ?? 'unavailable' : 'unavailable';
  const low = f.settings.zone_low_pct ?? 40, high = f.settings.zone_high_pct ?? 70;
  const max = Math.max(100, high, available ? f.activation_pct! : 0);
  const time = (ms?: number) => ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`;
  return <div className={`activation-feedback zone-${zone}`} aria-label="Phản hồi mức hoạt hóa">
    <div className="activation-heading"><span><Activity size={15}/>Mức hoạt hóa tương đối</span><strong>{available ? `${f.activation_pct!.toFixed(0)}% · ${levels[f.activation_level ?? 'unavailable']}` : !live ? 'Chưa cập nhật' : f.state === 'calibrating' ? 'Đang hiệu chuẩn nghỉ' : '—'}</strong></div>
    <div className="activation-track" style={{background:`linear-gradient(to right,#dce9eb 0 ${30/max*100}%,#d7e9d4 ${30/max*100}% ${70/max*100}%,#f2dfbd ${70/max*100}%)`}} role="meter" aria-label="RMS so với mốc tham chiếu" aria-valuemin={0} aria-valuemax={max} aria-valuenow={available ? f.activation_pct! : undefined} aria-valuetext={available ? `${f.activation_pct!.toFixed(0)} phần trăm mốc tham chiếu` : 'Chưa có giá trị trực tiếp'}>
      {zoneEnabled && <span className="activation-target" style={{left:`${low/max*100}%`,width:`${(high-low)/max*100}%`}}/>}
      {available && <i style={{left:`${Math.min(99,f.activation_pct!/max*100)}%`}}/>}
    </div>
    {zoneEnabled && <div className="activation-zone"><span><Target size={14}/>{zones[zone]}</span><span>{low}–{high}% mốc</span></div>}
    <div className="activation-timing"><span><Clock3 size={13}/>Nghỉ hiện tại: {time(measuring ? f.current_rest_ms : undefined)}</span>{zoneEnabled && <span>Giữ liên tục trong vùng: {time(measuring ? f.current_in_zone_ms : undefined)} / {time(f.settings.min_hold_ms)}</span>}</div>
    <small>{f.source === 'simulation' ? 'Mốc mô phỏng' : 'Mốc tham chiếu đã nhập'}: {f.settings.reference_rms ?? 'chưa đặt'} {f.unit === 'uV' ? 'µV' : f.unit}. Thấp &lt;30%, vừa 30–&lt;70%, cao ≥70%.</small>
  </div>;
}
