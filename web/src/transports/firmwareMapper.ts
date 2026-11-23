import { z } from 'zod';
import {
  adcConfigSchema,
  conversionSchema,
  dspConfigSchema,
  frameSchema,
  healthMetaSchema,
  incompleteContractionSchema,
  labelSourceSchema,
  reasonCodeSchema,
  replayInfoSchema,
  settingsSchema,
  type Command,
  type Frame,
  type RawBatchPacket,
  type Settings,
} from '../core/protocol';

const firmwareSchema=z.object({
  type:z.literal('snapshot'),protocol:z.literal(1),format:z.literal('semg_v2'),
  firmware_version:z.string().optional(),
  boot_id:z.string().uuid(),session_id:z.number().int().nonnegative().max(0xffffffff),sequence:z.number().int().nonnegative(),
  t_ms:z.number().nonnegative(),duration_ms:z.number().nonnegative(),
  state:z.enum(['idle','calibrating','ready','training','stopped','completed','error']),phase:z.enum(['idle','relax','contract','hold','release','complete']),paused:z.boolean(),
  raw_recording:z.boolean().optional(),
  source:z.enum(['simulation','replay','sensor']),signal_kind:z.enum(['RAW','ENVELOPE']),fs_hz:z.number().positive(),unit:z.enum(['uV','ADC','a.u.']),
  conversion:conversionSchema.optional(),
  capabilities:z.array(z.string()).max(16).optional(),
  device_clock_ms:z.number().nonnegative().optional(),
  sampled_at_device_ms:z.number().nonnegative().optional(),
  oled_sequence:z.number().int().nonnegative().optional(),
  dsp_config:dspConfigSchema.optional(),
  adc_config:adcConfigSchema.optional(),
  health:healthMetaSchema.optional(),
  replay_info:replayInfoSchema.optional(),
  settings:settingsSchema,
  channels:z.array(z.object({id:z.union([z.literal(1),z.literal(2)]),rms:z.number().nonnegative(),filtered:z.number().nullable().optional(),on_threshold:z.number().nonnegative(),off_threshold:z.number().nonnegative()})).min(1).max(2),
  valid_count:z.number().int().nonnegative(),total_count:z.number().int().nonnegative(),current_hold_ms:z.number().nonnegative(),last_hold_ms:z.number().nonnegative(),
  current_rest_ms:z.number().nonnegative(),current_in_zone_ms:z.number().nonnegative(),longest_in_zone_ms:z.number().nonnegative(),calibration_progress:z.number().min(0).max(1),
  activation_pct:z.number().nonnegative().nullable(),activation_level:z.enum(['low','medium','high','unavailable']),target_zone:z.enum(['below','inside','above','unavailable']),fault:z.string(),
  repetitions:z.array(z.object({
    ordinal:z.number().int().positive(),
    ended_ms:z.number().nonnegative(),
    hold_ms:z.number().nonnegative(),
    rest_ms:z.number().nonnegative(),
    in_zone_ms:z.number().nonnegative(),
    valid:z.boolean(),
    channel:z.union([z.literal(1),z.literal(2)]).optional(),
    started_ms:z.number().nonnegative().optional(),
    start_sample_index:z.number().int().nonnegative().optional(),
    end_sample_index:z.number().int().nonnegative().optional(),
    rms_mean:z.number().nonnegative().nullable().optional(),
    rms_peak:z.number().nonnegative().nullable().optional(),
    reason_code:reasonCodeSchema.nullable().optional(),
    label_source:labelSourceSchema.optional(),
  })).max(128),
  active_contraction:incompleteContractionSchema.nullable().optional(),
  incomplete_contraction:incompleteContractionSchema.nullable().optional(),
});
const rawBatchSchema=z.object({
  type:z.literal('raw_batch'),
  protocol:z.literal(1),
  boot_id:z.string().uuid(),
  session_id:z.number().int().nonnegative().max(0xffffffff),
  first_sample:z.number().int().nonnegative(),
  frames:z.number().int().positive().max(2048),
  channels:z.union([z.literal(1),z.literal(2)]),
  fs_hz:z.number().positive(),
  encoding:z.enum(['uint16_adc','int16_adc','float32_uv']),
  dropped_before:z.number().int().nonnegative().optional(),
  data_b64:z.string().min(4),
});
function decodeBase64(b64:string):Uint8Array {
  const bin=globalThis.atob(b64);
  const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}
export function mapFirmwareRawBatch(input:unknown):RawBatchPacket|null {
  const parsed=rawBatchSchema.safeParse(input);
  if(!parsed.success)return null;
  const r=parsed.data;
  const bytes=decodeBase64(r.data_b64);
  const stride=r.channels*(r.encoding==='float32_uv'?4:2);
  const expectedBytes=r.frames*stride;
  if(bytes.byteLength!==expectedBytes)return null;
  const aligned=bytes.slice().buffer;
  const data=r.encoding==='float32_uv'
    ?new Float32Array(aligned)
    :r.encoding==='int16_adc'
      ?new Int16Array(aligned)
      :new Uint16Array(aligned);
  return {
    session_id:firmwareUuid(r.boot_id,r.session_id),
    first_sample_index:r.first_sample,
    sample_count:r.frames,
    channels:r.channels,
    fs_hz:r.fs_hz,
    encoding:r.encoding,
    data,
    dropped_before:r.dropped_before,
    received_wall_ms:Date.now(),
  };
}
// Stable across reconnect and browser reload; no fabricated device clock or measurements.
export function firmwareUuid(boot:string,session:number,ordinal=0):string {
  const tail=(BigInt('0x'+boot.slice(24))^(BigInt(session)<<16n)^BigInt(ordinal)).toString(16).padStart(12,'0');
  return boot.slice(0,24)+tail;
}
const receiptTimes=new Map<string,string>();
const wireIds=new Map<string,{boot:string;session:number}>();
export function firmwareMessage(code:string):string {
  const messages:Record<string,string>={ok:'Đã áp dụng lệnh.',stale_session:'Phiên thiết bị đã đổi. Hãy lấy lại trạng thái.',busy_stop_first:'Hãy dừng buổi tập trước khi thay đổi.',calibrate_first:'Cần hiệu chuẩn trước khi bắt đầu.',settings_changed:'Thiết lập đã thay đổi. Hãy hiệu chuẩn lại.',invalid_settings:'Mốc tham chiếu, vùng mục tiêu hoặc thiết lập chưa hợp lệ.',invalid_state:'Không thể thực hiện thao tác ở trạng thái hiện tại.',command_expired:'Lệnh đã hết thời gian chờ và chưa được áp dụng.',ledger_full:'Đã đủ 128 lượt trong sổ kết quả. Hãy xuất kết quả và tạo phiên mới.',adc_not_implemented:'Nguồn cảm biến thật chưa được tích hợp.',adc_single_channel_only:'Phần cứng ADC1 hiện tại chỉ hỗ trợ 1 kênh (CH1 / GPIO34).',adc_fixed_2048Hz:'Nguồn ADC phần cứng cố định tần số lấy mẫu 2048 Hz.',adc_init_failed:'Không khởi tạo được driver ADC1 DMA trên ESP32.',invalid_unit:'Đơn vị đo không hợp lệ (chỉ hỗ trợ uV, ADC hoặc a.u.).',data_discontinuity:'Tín hiệu bị gián đoạn. Phiên đã dừng để giữ kết quả.',scheduler_overrun:'Xử lý tín hiệu không kịp. Phiên đã dừng.'};
  return messages[code]??'Thiết bị báo lỗi xử lý. Hãy xem log Serial để biết chi tiết.';
}
export function rememberFirmwareSettings(_s?:Settings){} // Legacy API retained; never overrides device settings.
export function mapFirmwarePacket(input:unknown):Frame {
  const native=frameSchema.safeParse(input);if(native.success)return native.data;
  const parsed=firmwareSchema.safeParse(input);
  if(!parsed.success)throw new Error('Firmware chưa gửi đủ dữ liệu chính xác. Hãy cập nhật firmware 0.3 (semg_v2).');
  const r=parsed.data,id=firmwareUuid(r.boot_id,r.session_id);
  if(!receiptTimes.has(id))receiptTimes.set(id,new Date(Date.now()-r.t_ms).toISOString());
  wireIds.set(id,{boot:r.boot_id,session:r.session_id});
  if(receiptTimes.size>256){const first=receiptTimes.keys().next().value!;receiptTimes.delete(first);wireIds.delete(first);}
  const capabilities=Array.from(new Set(['semg_v2','biofeedback_v1','rest_v1',...(r.capabilities??[])]));
  const yFloor=r.unit==='ADC'?2048:250;
  return frameSchema.parse({...r,device_id:`esp32-${r.boot_id.slice(0,8)}`,device_name:'ESP32 sEMG Trainer',session_id:id,cause:'state',
    started_at:receiptTimes.get(id),started_at_estimated:true,capabilities,
    selected_channel:r.settings.channel,channel_count:r.channels.length,
    y_max:Math.max(yFloor,(r.settings.reference_rms??0)*Math.max(1,(r.settings.zone_high_pct??70)/100)*1.15,...r.channels.map(c=>c.on_threshold*1.5)),
    repetitions:r.repetitions.map(rep=>({...rep,id:firmwareUuid(r.boot_id,r.session_id,rep.ordinal)})),
    warning:r.state==='completed'&&r.source==='replay'&&r.valid_count<r.settings.target?'Đã hết dữ liệu phát lại trước khi đạt mục tiêu.':r.state==='stopped'&&r.settings.mode==='free'&&r.total_count>=128?'Đã đủ 128 lần co cơ trong sổ kết quả. Hãy xuất kết quả và tạo phiên mới để đo tiếp.':null,error:r.fault?firmwareMessage(r.fault):null,
  });
}
export function firmwareCommand(c:Command,lastFrame:Frame|null):unknown {
  if(!lastFrame?.capabilities?.includes('semg_v2'))return c;
  const wire=wireIds.get(c.session_id);if(!wire)throw new Error('Cần lấy lại trạng thái phiên thiết bị.');
  const id=Number.parseInt(c.command_id.replaceAll('-','').slice(-8),16)||1;
  const s=c.settings;
  return {v:1,id,cmd:`web_${c.action}`,request_id:c.command_id,boot_id:wire.boot,session_id:wire.session,
    ...s&&['start','calibrate','reset'].includes(c.action)?{target_reps:s.target,hold_ms:s.min_hold_ms,exercise_channel:s.channel-1,mode:s.mode??'training',muscle:s.muscle,reference_rms:s.reference_rms??0,zone_enabled:s.zone_enabled?1:0,zone_low_pct:s.zone_low_pct??40,zone_high_pct:s.zone_high_pct??70}:{},
    ...(typeof c.raw_record==='boolean' && ['start','calibrate','reset'].includes(c.action) && lastFrame?.capabilities?.includes('raw_stream_v1') ? {raw_record:c.raw_record?1:0} : {}),
  };
}
export function formatDeviceUrl(raw:string):string|null {
  const s=raw.trim();
  if(!s || /\s/.test(s))return null;
  if(/^wss?:\/\//i.test(s))return s;
  const host=s.replace(/^https?:\/\//i,'').replace(/\/+$/,'');
  if(!host)return null;
  return host.includes('/')?`ws://${host}`:`ws://${host}/ws`;
}
export function validateWebSocketUrl(input:string,pageProtocol=globalThis.location?.protocol??'http:'):string {
  let u:URL;try{u=new URL(input);}catch{throw new Error('Địa chỉ kết nối chưa hợp lệ.');}
  if(!['ws:','wss:'].includes(u.protocol)||u.username||u.password)throw new Error('Hãy dùng địa chỉ ws:// hoặc wss:// không chứa mật khẩu.');
  if(pageProtocol==='https:'&&u.protocol==='ws:')throw new Error('Bản HTTPS cần WSS có chứng chỉ hợp lệ. Với WS nội bộ, hãy mở web qua HTTP trong cùng mạng.');
  return u.toString();
}
