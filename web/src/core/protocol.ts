import { z } from 'zod';
export const modeSchema = z.enum(['training', 'free']);
export type TrainingMode = z.infer<typeof modeSchema>;
export const settingsSchema = z.object({
  mode: modeSchema.optional(),
  muscle: z.enum(['forearm', 'biceps']), channel: z.union([z.literal(1), z.literal(2)]),
  target: z.number().int().min(1).max(1000), min_hold_ms: z.number().int().min(0).max(10000),
  reference_rms: z.number().positive().max(1e6).optional(),
  zone_enabled: z.boolean().optional(),
  zone_low_pct: z.number().min(0).max(200).optional(),
  zone_high_pct: z.number().min(0).max(200).optional(),
}).superRefine((s,ctx)=>{
  if((s.zone_low_pct??40)>=(s.zone_high_pct??70))ctx.addIssue({code:'custom',message:'Cận dưới vùng mục tiêu phải nhỏ hơn cận trên.'});
  if(s.zone_enabled&&!s.reference_rms)ctx.addIssue({code:'custom',message:'Cần đặt mốc RMS tham chiếu trước khi dùng vùng mục tiêu.'});
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = { muscle: 'forearm', channel: 1, target: 5, min_hold_ms: 500, reference_rms:300,zone_enabled:false,zone_low_pct:40,zone_high_pct:70 };
export const isFreeMode = (s?: Settings | null): boolean => s?.mode === 'free';
export const modeLabel = (m?: TrainingMode): string => m === 'free' ? 'Đếm tự do' : 'Luyện tập';
export const sameSettings = (a?: Settings | null, b?: Settings | null): boolean =>
  !!a && !!b && (a.mode ?? 'training') === (b.mode ?? 'training') && a.muscle === b.muscle && a.channel === b.channel &&
  (isFreeMode(a) || (a.target === b.target && a.min_hold_ms === b.min_hold_ms)) &&
  (a.reference_rms??null)===(b.reference_rms??null) && (a.zone_enabled??false)===(b.zone_enabled??false) &&
  (a.zone_low_pct??40)===(b.zone_low_pct??40) && (a.zone_high_pct??70)===(b.zone_high_pct??70);
export const reasonCodeSchema = z.enum(['short_hold', 'insufficient_in_zone', 'stopped_mid_contraction', 'session_in_progress']);
export type ReasonCode = z.infer<typeof reasonCodeSchema>;
export const labelSourceSchema = z.enum(['algorithm_predicted', 'manual', 'replay_reference']);
export type LabelSource = z.infer<typeof labelSourceSchema>;
export const repetitionSchema = z.object({
  id: z.string().uuid(),
  ordinal: z.number().int().positive(),
  ended_ms: z.number().nonnegative(),
  hold_ms: z.number().nonnegative(),
  valid: z.boolean(),
  rest_ms: z.number().nonnegative().optional(),
  in_zone_ms: z.number().nonnegative().optional(),
  channel: z.union([z.literal(1), z.literal(2)]).optional(),
  started_ms: z.number().nonnegative().optional(),
  start_sample_index: z.number().int().nonnegative().optional(),
  end_sample_index: z.number().int().nonnegative().optional(),
  rms_mean: z.number().nonnegative().nullable().optional(),
  rms_peak: z.number().nonnegative().nullable().optional(),
  reason_code: reasonCodeSchema.nullable().optional(),
  label_source: labelSourceSchema.optional(),
});
export type Repetition = z.infer<typeof repetitionSchema>;
export const incompleteContractionSchema = z.object({
  channel: z.union([z.literal(1), z.literal(2)]),
  started_ms: z.number().nonnegative(),
  ended_ms: z.number().nonnegative(),
  hold_ms: z.number().nonnegative(),
  in_zone_ms: z.number().nonnegative().optional(),
  start_sample_index: z.number().int().nonnegative().optional(),
  end_sample_index: z.number().int().nonnegative().optional(),
  rms_mean: z.number().nonnegative().nullable().optional(),
  rms_peak: z.number().nonnegative().nullable().optional(),
  reason_code: reasonCodeSchema.optional(),
});
export type IncompleteContraction = z.infer<typeof incompleteContractionSchema>;
export const dspConfigSchema = z.object({
  highpass_hz: z.number().nonnegative().nullable().optional(),
  lowpass_hz: z.number().nonnegative().nullable().optional(),
  notch_hz: z.number().nonnegative().nullable().optional(),
  notch_q: z.number().nonnegative().nullable().optional(),
  rms_ms: z.number().positive().nullable().optional(),
  cal_ms: z.number().positive().nullable().optional(),
  settle_ms: z.number().nonnegative().nullable().optional(),
  on_ms: z.number().nonnegative().nullable().optional(),
  off_ms: z.number().nonnegative().nullable().optional(),
  on_factor: z.number().positive().nullable().optional(),
  off_factor: z.number().positive().nullable().optional(),
  on_sd: z.number().nonnegative().nullable().optional(),
  off_sd: z.number().nonnegative().nullable().optional(),
  dc_offset_ch1: z.number().nullable().optional(),
});
export type DspConfig = z.infer<typeof dspConfigSchema>;
export const adcConfigSchema = z.object({
  resolution_bits: z.number().int().positive().nullable().optional(),
  atten_db: z.number().nonnegative().nullable().optional(),
  hw_sample_rate_hz: z.number().positive().nullable().optional(),
  oversampling_ratio: z.number().int().positive().nullable().optional(),
  sampling_mode: z.string().nullable().optional(),
  gpio: z.number().int().nonnegative().nullable().optional(),
  analog_frontend: z.string().nullable().optional(),
  analog_gain: z.number().positive().nullable().optional(),
  analog_bandpass_hz: z.string().nullable().optional(),
  clip_count: z.number().int().nonnegative().optional(),
});
export type AdcConfig = z.infer<typeof adcConfigSchema>;
export const healthMetaSchema = z.object({
  discontinuities: z.number().int().nonnegative().optional(),
  tx_dropped: z.number().int().nonnegative().optional(),
  backlog_ticks: z.number().int().nonnegative().optional(),
  max_dsp_us: z.number().nonnegative().nullable().optional(),
  raw_dropped_samples: z.number().int().nonnegative().optional(),
  raw_overflow_events: z.number().int().nonnegative().optional(),
  tracking_supported: z.boolean().optional(),
});
export type HealthMeta = z.infer<typeof healthMetaSchema>;
export const replayInfoSchema = z.object({
  dataset_name: z.string(),
  dataset_version: z.string().optional(),
  doi: z.string().optional(),
  channel_name: z.string().optional(),
  segment_description: z.string().optional(),
  total_samples: z.number().int().positive().optional(),
  license: z.string().optional(),
});
export type ReplayInfo = z.infer<typeof replayInfoSchema>;
export const conversionSchema = z.object({
  uV_per_unit: z.number().positive(),
  offset_uV: z.number(),
  reference: z.string().min(1),
  bias: z.number().optional(),
  scale: z.number().positive().optional(),
  gain: z.number().positive().optional(),
  calibrated: z.boolean().optional(),
});
export type Conversion = z.infer<typeof conversionSchema>;
export const frameSchema = z.object({
  type: z.literal('snapshot'), protocol: z.literal(1), device_id: z.string(), device_name: z.string(), boot_id: z.string().uuid(),
  firmware_version: z.string().optional(),
  session_id: z.string().uuid(), sequence: z.number().int().nonnegative(), cause: z.enum(['tick','command','reset','state']),
  capabilities:z.array(z.string()).max(16).optional(),device_clock_ms:z.number().nonnegative().optional(),sampled_at_device_ms:z.number().nonnegative().optional(),oled_sequence:z.number().int().nonnegative().optional(),
  started_at: z.string().datetime(), started_at_estimated:z.boolean().optional(),t_ms: z.number().nonnegative(), duration_ms: z.number().nonnegative(),
  state: z.enum(['idle','calibrating','ready','training','stopped','completed','error']),
  phase: z.enum(['idle','relax','contract','hold','release','complete']),
  paused: z.boolean().optional(),
  raw_recording: z.boolean().optional(),
  selected_channel: z.union([z.literal(1),z.literal(2)]), channel_count: z.union([z.literal(1),z.literal(2)]),
  source: z.enum(['simulation','replay','sensor']),fs_hz:z.number().positive().optional(),signal_kind:z.enum(['RAW','ENVELOPE']).optional(), unit: z.enum(['uV','ADC','a.u.']), conversion: conversionSchema.optional(), y_max: z.number().positive(),
  dsp_config: dspConfigSchema.optional(),
  adc_config: adcConfigSchema.optional(),
  health: healthMetaSchema.optional(),
  replay_info: replayInfoSchema.optional(),
  channels: z.array(z.object({ id: z.union([z.literal(1),z.literal(2)]), rms: z.number().nonnegative().nullable(), filtered: z.number().nullable().optional(), on_threshold: z.number().nonnegative(), off_threshold: z.number().nonnegative() })).min(1).max(2),
  settings: settingsSchema, total_count: z.number().int().nonnegative(), valid_count: z.number().int().nonnegative(),
  current_hold_ms: z.number().nonnegative(), last_hold_ms: z.number().nonnegative(), calibration_progress: z.number().min(0).max(1),
  activation_pct:z.number().nonnegative().nullable().optional(),activation_level:z.enum(['low','medium','high','unavailable']).optional(),target_zone:z.enum(['below','inside','above','unavailable']).optional(),
  current_rest_ms:z.number().nonnegative().optional(),current_in_zone_ms:z.number().nonnegative().optional(),longest_in_zone_ms:z.number().nonnegative().optional(),
  repetitions: z.array(repetitionSchema),
  active_contraction: incompleteContractionSchema.nullable().optional(),
  incomplete_contraction: incompleteContractionSchema.nullable().optional(),
  warning: z.string().nullable(), error: z.string().nullable(),
}).superRefine((f,ctx)=>{
  if(f.valid_count !== f.repetitions.filter(r=>r.valid).length || f.total_count !== f.repetitions.length) ctx.addIssue({code:'custom',message:'Số lượt không khớp sổ kết quả.'});
  if(new Set(f.repetitions.map(r=>r.id)).size !== f.repetitions.length) ctx.addIssue({code:'custom',message:'Lượt bị lặp.'});
  if(f.selected_channel > f.channel_count || !f.channels.some(c=>c.id===f.selected_channel) || f.settings.channel!==f.selected_channel) ctx.addIssue({code:'custom',message:'Kênh không hợp lệ.'});
  if(f.source==='sensor' && f.unit==='uV' && !f.conversion)ctx.addIssue({code:'custom',message:'Thiếu hệ số quy đổi sang µV.'});
  if(f.channels.length!==f.channel_count || new Set(f.channels.map(c=>c.id)).size!==f.channel_count || f.channels.some(c=>c.on_threshold>f.y_max))ctx.addIssue({code:'custom',message:'Thông tin kênh hoặc thang đo không hợp lệ.'});
  if(f.channels.some(c=>c.off_threshold>=c.on_threshold && !(c.on_threshold===0 && ['idle','calibrating','error','stopped'].includes(f.state)))) ctx.addIssue({code:'custom',message:'Ngưỡng thả phải thấp hơn ngưỡng co.'});
});
export type Frame = z.infer<typeof frameSchema>;
export type SessionState = Frame['state'];
export type Action = 'calibrate'|'start'|'pause'|'resume'|'reset_counter'|'stop'|'reset'|'get_state';
export type Command = { type:'command'; protocol:1; command_id:string; session_id:string; action:Action; settings?:Settings; raw_record?:boolean };
export const commandSchema=z.object({type:z.literal('command'),protocol:z.literal(1),command_id:z.string().uuid(),session_id:z.string().uuid(),action:z.enum(['calibrate','start','pause','resume','reset_counter','stop','reset','get_state']),settings:settingsSchema.optional(),raw_record:z.boolean().optional()});
export type Ack = { type:'ack'; protocol:1; command_id:string; accepted:boolean; message?:string; snapshot:Frame };
export const ackSchema = z.object({ type:z.literal('ack'), protocol:z.literal(1), command_id:z.string().uuid(), accepted:z.boolean(), message:z.string().optional(), snapshot:frameSchema });
export type Connection = 'disconnected'|'connecting'|'connected'|'lost';
export type Sample = {
  t_ms:number;
  rms:number|null;
  filtered?:number|null;
  on_threshold:number;
  off_threshold:number;
  activation_pct?:number|null;
  target_zone?:Frame['target_zone'];
  sample_index?:number;
};
export type ConfigHistoryEntry = {
  t_ms: number;
  recorded_at: string;
  event: 'session_start' | 'calibrated' | 'threshold_change' | 'settings_change' | 'pause' | 'resume' | 'stop' | 'complete';
  channel: 1 | 2;
  on_threshold: number;
  off_threshold: number;
  min_hold_ms: number;
  target: number;
  zone_enabled: boolean;
  reference_rms?: number;
  zone_low_pct?: number;
  zone_high_pct?: number;
  note?: string;
};
export type RawEncoding = 'uint16_adc' | 'int16_adc' | 'float32_uv';
export type RawBatchPacket = {
  session_id: string;
  first_sample_index: number;
  sample_count: number;
  channels: 1 | 2;
  fs_hz: number;
  encoding: RawEncoding;
  data: Uint16Array | Int16Array | Float32Array;
  dropped_before?: number;
  received_wall_ms?: number;
};
export type RawChunk = {
  key: string;
  session_id: string;
  chunk_seq: number;
  first_sample_index: number;
  sample_count: number;
  channels: 1 | 2;
  fs_hz: number;
  encoding: RawEncoding;
  data: ArrayBuffer;
  discontinuity?: boolean;
};
export type RawSummary = {
  enabled: boolean;
  available: boolean;
  unavailable_reason?: string | null;
  encoding?: RawEncoding;
  fs_hz?: number;
  measured_fs_hz?: number | null;
  channel_count?: 1 | 2;
  sample_count: number;
  chunk_count: number;
  bytes_stored: number;
  tracking_method: 'source_sample_index' | 'none';
  missing_samples_detected: number;
  gap_events: number;
  overflow_events: number;
  truncated?: boolean;
};
export type SessionRecord = {
  id:string;
  snapshot:Frame;
  samples:Sample[];
  gaps:number;
  updated_at:string;
  revision:number;
  sync:'local'|'pending'|'synced';
  owner_id?:string;
  cloud_owner_id?:string;
  adapter_kind?:'mock'|'websocket';
  deleted?:boolean;
  config_history?: ConfigHistoryEntry[];
  raw_summary?: RawSummary;
};
export const isActive = (s?:SessionState) => s === 'training' || s === 'calibrating';
export const isTerminal = (s?:SessionState) => s === 'stopped' || s === 'completed' || s === 'error';
export const stateLabels:Record<SessionState,string> = {idle:'Sẵn sàng',calibrating:'Đang hiệu chuẩn',ready:'Sẵn sàng',training:'Đang tập',stopped:'Đã dừng',completed:'Hoàn thành',error:'Lỗi thiết bị'};
export const muscleLabel = (m:Settings['muscle'])=>m==='forearm'?'Cẳng tay':'Bắp tay';
export function uid():string {
  if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // LAN HTTP can expose getRandomValues without randomUUID; never use Math.random for IDs.
  const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b); b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
  const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

export const pongSchema=z.object({type:z.literal('pong'),protocol:z.literal(1),ping_id:z.string().uuid(),device_rx_ms:z.number().nonnegative(),device_tx_ms:z.number().nonnegative()});
