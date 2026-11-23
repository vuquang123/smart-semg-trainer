import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ActivationFeedback} from '../src/components/ActivationFeedback';
import {FreeMeasure,computeFreeStats} from '../src/components/FreeMeasure';
import {MobileTraining} from '../src/components/MobileTraining';
import {TrainingSettings} from '../src/components/TrainingSettings';
import {DEFAULT_CHANNEL_MAP,resolveChannelMap,withChannel} from '../src/core/channelMap';
import {SimulationEngine} from '../src/core/engine';
import {defaults} from '../src/core/protocol';
import {exportSessionsCsv} from '../src/storage/export';
describe('feedback display',()=>{
 it('shows a received target value and the separate continuous hold duration',()=>{const f=new SimulationEngine({...defaults,zone_enabled:true}).snapshot();f.state='training';f.activation_pct=55;f.activation_level='medium';f.target_zone='inside';f.current_in_zone_ms=300;f.current_rest_ms=0;const html=renderToStaticMarkup(<ActivationFeedback frame={f} live/>);expect(html).toContain('55%');expect(html).toContain('Trong vùng mục tiêu');expect(html).toContain('0.3 s');});
 it('never presents stale activation as live after connection loss',()=>{const f=new SimulationEngine(defaults).snapshot();f.state='training';f.activation_pct=55;const html=renderToStaticMarkup(<ActivationFeedback frame={f} live={false}/>);expect(html).toContain('Chưa cập nhật');expect(html).not.toContain('55%');});
 it('explains the reference and locks changes during training',()=>{const html=renderToStaticMarkup(<TrainingSettings settings={{...defaults,zone_enabled:true}} onChange={()=>{}} state="training" pending={false} connected onCalibrate={()=>{}}/>);expect(html).toContain('fieldset disabled');expect(html).toContain('Mốc RMS tham chiếu');expect(html).toContain('Ra khỏi vùng');});
 it('renders the dedicated free-measurement view without target denominators or hold goal',()=>{
  const freeSettings={...defaults,mode:'free' as const,target:5};
  const f=new SimulationEngine(freeSettings).snapshot();
  f.state='training';f.phase='contract';f.duration_ms=30000;f.current_hold_ms=800;f.valid_count=3;f.total_count=3;
  f.repetitions=[
   {id:'00000000-0000-4000-8000-000000000001',ordinal:1,ended_ms:3000,hold_ms:600,rest_ms:2000,in_zone_ms:0,valid:true},
   {id:'00000000-0000-4000-8000-000000000002',ordinal:2,ended_ms:10000,hold_ms:1000,rest_ms:6000,in_zone_ms:0,valid:true},
   {id:'00000000-0000-4000-8000-000000000003',ordinal:3,ended_ms:20000,hold_ms:800,rest_ms:9200,in_zone_ms:0,valid:true},
  ];
  const stats=computeFreeStats(f);
  expect(stats.count).toBe(3);expect(stats.ratePerMin).toBeCloseTo(6,2);expect(stats.avgHoldMs).toBeCloseTo(800,1);expect(stats.longestHoldMs).toBe(1000);expect(stats.avgRestMs).toBeCloseTo(7600,1);
  const noop=()=>{};
  const html=renderToStaticMarkup(<FreeMeasure frame={f} settings={freeSettings} connected delayed={false} pending={null} connecting={false} saved={false} hasRecord phaseTitle="Đang co cơ" phaseDescription="Thả lỏng để hoàn tất 1 chu kỳ." onStart={noop} onPauseResume={noop} onResetCounter={noop} onStop={noop} onResult={noop}/>);
  expect(html).toContain('DANG CO 0.8S');
  expect(html).toContain('6.0');
  expect(html).not.toContain('/ 5');
  expect(html).not.toContain('Tiến độ buổi tập');
  expect(html).not.toContain('CH2');
 });
 it('treats muscle strictly as electrode placement metadata on single-channel CH1 without CH2 selection',()=>{
  const freshMap=resolveChannelMap(null,null);
  expect(freshMap[1]).toBe('forearm');
  expect(withChannel(defaults,freshMap,1)).toMatchObject({channel:1,muscle:'forearm'});
  const html=renderToStaticMarkup(<TrainingSettings settings={defaults} onChange={()=>{}} state="idle" pending={false} connected onCalibrate={()=>{}}/>);
  expect(html).toContain('Vị trí đặt điện cực (Kênh CH1)');
  expect(html).toContain('Cẳng tay');
  expect(html).toContain('Bắp tay');
  expect(html).toContain('Đo trên 1 kênh CH1 · Vùng cơ là thông tin vị trí đặt điện cực của phiên tập.');
  expect(html).not.toContain('CH2');
  expect(html).not.toContain('2 kênh');
  expect(html).not.toContain('Đổi vị trí cơ');
  expect(html).toContain('Áp dụng');
 });
 it('renders state-specific mobile training cards for single-channel CH1 (pre-start, active, completed without dash placeholders)',()=>{
  const noop=()=>{};
  const e=new SimulationEngine(defaults);
  const baseView={connection:'connected' as const,frame:e.snapshot(),live:true,pending:null,error:null,record:null,savedAt:null,storageError:null,version:1,diagnostics:{rtt_ms:10,sample_age_ms:20,uncertainty_ms:5,received_interval_ms:100,command_rtt_ms:12,oled_sequence_gap:0,accepted_packets:1,ignored_packets:0}};
  const preHtml=renderToStaticMarkup(<MobileTraining view={baseView} settings={defaults} onSettingsChange={noop} onModeChange={noop} phaseTitle="Sẵn sàng" phaseDescription="Chuẩn bị" onStart={noop} onPauseResume={noop} onResetCounter={noop} onStop={noop} onNewSession={noop} onResult={noop} onDevice={noop} onCalibrate={noop} onReconnect={noop}/>);
  expect(preHtml).toContain('CH1 · Cẳng tay · 5 lượt · Giữ 0,5 giây');
  expect(preHtml).toContain('Chỉnh');
  expect(preHtml).toContain('Bắt đầu');
  expect(preHtml).toContain('Không cần gắn điện cực');
  expect(preHtml).not.toContain('CH2');
  expect(preHtml).not.toContain('mobile-channel-bar');

  const doneFrame=e.snapshot();
  doneFrame.state='completed';
  doneFrame.valid_count=5;
  doneFrame.total_count=7;
  doneFrame.duration_ms=42000;
  const doneHtml=renderToStaticMarkup(<MobileTraining view={{...baseView,frame:doneFrame}} settings={defaults} onSettingsChange={noop} onModeChange={noop} phaseTitle="Hoàn thành" phaseDescription="Đã lưu" onStart={noop} onPauseResume={noop} onResetCounter={noop} onStop={noop} onNewSession={noop} onResult={noop} onDevice={noop} onCalibrate={noop} onReconnect={noop}/>);
  expect(doneHtml).toContain('Số lượt đạt mục tiêu');
  expect(doneHtml).toContain('Tổng lần thử: 7 (5 đạt, 2 chưa đủ giữ)');
  expect(doneHtml).toContain('Xem kết quả');
  expect(doneHtml).toContain('Buổi mới');
  expect(doneHtml).not.toContain('—');
 });
 it('exports all sessions in batch CSV without truncating to a single page on CH1',()=>{
  const records=Array.from({length:7},(_,i)=>{
   const e=new SimulationEngine({...defaults,channel:1,muscle:i%2===0?'forearm':'biceps'});
   const snap=e.snapshot();
   return {id:snap.session_id,snapshot:snap,samples:[],gaps:0,updated_at:snap.started_at,revision:1,sync:'local' as const};
  });
  const csv=exportSessionsCsv(records);
  expect(csv.trim().split('\r\n')).toHaveLength(8);
  expect(csv).not.toContain('CH2');
 });
});
