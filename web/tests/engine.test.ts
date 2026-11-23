import { describe,expect,it } from 'vitest';
import { SimulationEngine } from '../src/core/engine';
import { defaults,frameSchema,uid,type Action,type Command } from '../src/core/protocol';
import { PacketGate } from '../src/core/gate';
import { formatDeviceUrl,mapFirmwarePacket,validateWebSocketUrl } from '../src/transports/firmwareMapper';
function command(e:SimulationEngine,action:Action):Command{return {type:'command',protocol:1,command_id:uid(),session_id:e.frame.session_id,action,settings:defaults};}
function training(){const e=new SimulationEngine();e.execute(command(e,'calibrate'));e.advance(2500);e.execute(command(e,'start'));return e;}
describe('virtual device recognition',()=>{
  it('completes five valid repetitions with deterministic unsuccessful attempts and a consistent ledger',()=>{
    const e=training();let previous=0;
    for(let t=0;t<50000 && e.frame.state!=='completed';t+=100){const f=e.advance(100);expect(frameSchema.safeParse(f).success).toBe(true);expect(f.valid_count).toBeGreaterThanOrEqual(previous);if(f.valid_count>previous)expect(f.channels[0].rms).toBeLessThan(f.channels[0].off_threshold);previous=f.valid_count;}
    expect(e.frame.state).toBe('completed');expect(e.frame.valid_count).toBe(5);expect(e.frame.total_count).toBeGreaterThan(5);expect(e.frame.repetitions.some(r=>!r.valid)).toBe(true);expect(new Set(e.frame.repetitions.map(r=>r.id)).size).toBe(e.frame.total_count);
  });
  it('does not count just because RMS crosses the contraction threshold',()=>{const e=training();e.advance(1000);expect(e.frame.channels[0].rms).toBeGreaterThan(140);expect(e.frame.total_count).toBe(0);e.advance(1100);expect(e.frame.valid_count).toBe(0);e.advance(100);expect(e.frame.valid_count).toBe(1);});
  it('stops during calibration and remains stopped',()=>{const e=new SimulationEngine();e.execute(command(e,'calibrate'));e.advance(700);e.execute(command(e,'stop'));e.advance(30000);expect(e.frame.state).toBe('stopped');expect(e.frame.valid_count).toBe(0);});
  it('preserves confirmed repetitions on stop and never increments afterward',()=>{const e=training();e.advance(5000);const count=e.frame.valid_count;expect(count).toBeGreaterThan(0);e.execute(command(e,'stop'));e.advance(100000);expect(e.frame.valid_count).toBe(count);expect(e.frame.state).toBe('stopped');});
  it('rejects start without calibration and resets only while inactive',()=>{const e=new SimulationEngine();expect(e.execute(command(e,'start')).accepted).toBe(false);e.execute(command(e,'calibrate'));expect(e.execute(command(e,'reset')).accepted).toBe(false);e.advance(2500);e.execute(command(e,'start'));expect(e.execute(command(e,'reset')).accepted).toBe(false);});
  it('deduplicates command IDs and gives reset a globally unique new session',()=>{const e=training();e.execute(command(e,'stop'));const c=command(e,'reset');const old=e.frame.session_id;const a=e.execute(c);const duplicate=e.execute(c);expect(a.snapshot.session_id).not.toBe(old);expect(duplicate.snapshot.session_id).toBe(a.snapshot.session_id);});
  it('rejects old-session start/stop commands',()=>{const e=new SimulationEngine();const c=command(e,'stop');e.execute(command(e,'stop'));e.execute(command(e,'reset'));expect(e.execute(c).accepted).toBe(false);});
  it('rejects CH2 for a single-channel device and freezes settings',()=>{const e=new SimulationEngine();const c=command(e,'calibrate');c.settings={...defaults,channel:2};expect(e.execute(c).accepted).toBe(false);});
  it('defaults to 1-channel CH1, updates electrode muscle placement, and emits filtered alongside RMS on CH1',()=>{
    const ch1Settings={...defaults,channel:1 as const,muscle:'biceps' as const,target:2};
    const e=new SimulationEngine(ch1Settings);
    expect(e.frame.channel_count).toBe(1);
    expect(e.frame.channels).toHaveLength(1);
    expect(e.frame.selected_channel).toBe(1);
    expect(e.frame.channels[0].filtered).toBeTypeOf('number');
    expect(e.execute({type:'command',protocol:1,command_id:uid(),session_id:e.frame.session_id,action:'calibrate',settings:ch1Settings}).accepted).toBe(true);
    e.advance(2500);
    expect(e.frame.state).toBe('ready');
    expect(e.frame.selected_channel).toBe(1);
    expect(e.frame.settings.muscle).toBe('biceps');
    expect(e.execute({type:'command',protocol:1,command_id:uid(),session_id:e.frame.session_id,action:'start',settings:ch1Settings}).accepted).toBe(true);
    let sawNonZeroFiltered=false;
    for(let t=0;t<25000 && e.frame.state!=='completed';t+=100){
      const f=e.advance(100);
      if(f.channels[0].filtered!==0 && Number.isFinite(f.channels[0].filtered))sawNonZeroFiltered=true;
    }
    expect(sawNonZeroFiltered).toBe(true);
    expect(e.frame.state).toBe('completed');
    expect(e.frame.selected_channel).toBe(1);
    expect(e.frame.valid_count).toBe(2);
  });
});
describe('packet gate and firmware boundary',()=>{
  it('ignores duplicate and out of order packets',()=>{const e=training(),g=new PacketGate();const a=e.snapshot('state');expect(g.accept(a)).not.toBeNull();expect(g.accept(a)).toBeNull();expect(g.accept({...a,sequence:a.sequence-1})).toBeNull();expect(g.accept(e.advance(100))).not.toBeNull();});
  it('never resurrects retired sessions, even with a higher sequence',()=>{const e=training(),g=new PacketGate();const old=e.snapshot('state');g.accept(old);e.execute(command(e,'stop'));const newFrame=e.execute(command(e,'reset')).snapshot;expect(g.accept(newFrame)).not.toBeNull();expect(g.accept({...old,sequence:99999,cause:'state'})).toBeNull();});
  it('does not switch sessions from an unsolicited stream tick',()=>{const a=new SimulationEngine(),b=new SimulationEngine(),g=new PacketGate();g.accept(a.snapshot('state'));expect(g.accept(b.snapshot('tick'))).toBeNull();expect(g.accept(b.snapshot('state'))).not.toBeNull();});
  it('rejects inconsistent totals, duplicated repetition IDs and unsupported legacy firmware',()=>{const e=training();e.advance(5000);expect(()=>mapFirmwarePacket({...e.snapshot(),valid_count:88})).toThrow();expect(()=>mapFirmwarePacket({rms:120,reps:1})).toThrow();const f=e.snapshot();f.repetitions.push(f.repetitions[0]);expect(frameSchema.safeParse(f).success).toBe(false);});
  it('blocks insecure mixed content while allowing explicit LAN HTTP and secure WSS',()=>{expect(()=>validateWebSocketUrl('ws://192.168.4.1/ws','https:')).toThrow(/HTTPS/);expect(validateWebSocketUrl('ws://192.168.4.1/ws','http:')).toMatch(/^ws:/);expect(validateWebSocketUrl('wss://device.example/ws','https:')).toMatch(/^wss:/);expect(()=>validateWebSocketUrl('javascript:alert(1)')).toThrow();expect(()=>validateWebSocketUrl('ws://user:pass@host/ws')).toThrow();});
  it('requires explicit ESP32 IP/URL instead of defaulting blank input to a hardcoded host',()=>{expect(formatDeviceUrl('')).toBeNull();expect(formatDeviceUrl('   ')).toBeNull();expect(formatDeviceUrl('bad host/ws')).toBeNull();expect(formatDeviceUrl('192.168.1.55')).toBe('ws://192.168.1.55/ws');expect(formatDeviceUrl('ws://192.168.1.55/ws')).toBe('ws://192.168.1.55/ws');});
});

describe('reload recovery and signal units',()=>{
 it('keeps session time monotonic when recalibrating',()=>{const e=new SimulationEngine();e.execute(command(e,'calibrate'));e.advance(2500);const t=e.frame.t_ms;e.execute(command(e,'calibrate'));e.advance(100);expect(e.frame.t_ms).toBe(t+100);expect(e.frame.calibration_progress).toBeCloseTo(.04);});
 it('restores a local simulation with the same ID and confirmed count, stopped without fabricated background data',()=>{const e=training();e.advance(5000);const old=e.snapshot();const restored=new SimulationEngine();restored.restore(old);expect(restored.frame.session_id).toBe(old.session_id);expect(restored.frame.valid_count).toBe(old.valid_count);expect(restored.frame.state).toBe('stopped');expect(restored.frame.sequence).toBeGreaterThan(old.sequence);expect(restored.frame.t_ms).toBe(old.t_ms);});
 it('requires conversion metadata for a real sensor reporting microvolts',()=>{const e=new SimulationEngine();const f=e.snapshot();expect(frameSchema.safeParse({...f,source:'sensor'}).success).toBe(false);expect(frameSchema.safeParse({...f,source:'sensor',unit:'ADC'}).success).toBe(true);expect(frameSchema.safeParse({...f,source:'sensor',conversion:{uV_per_unit:1.2,offset_uV:0,reference:'Gain and ADC reference measured on bench'}}).success).toBe(true);});
});

describe('free counting mode (Đếm tự do)',()=>{
 it('counts each contraction-release cycle once without hold target requirement and never auto-completes at target',()=>{
  const freeSettings={...defaults,mode:'free' as const,target:3,min_hold_ms:3000};
  const e=new SimulationEngine(freeSettings);
  e.execute({type:'command',protocol:1,command_id:uid(),session_id:e.frame.session_id,action:'calibrate',settings:freeSettings});
  e.advance(2500);
  expect(e.frame.state).toBe('ready');
  e.execute({type:'command',protocol:1,command_id:uid(),session_id:e.frame.session_id,action:'start',settings:freeSettings});
  for(let t=0;t<25000;t+=100){
   const f=e.advance(100);
   expect(frameSchema.safeParse(f).success).toBe(true);
  }
  expect(e.frame.state).toBe('training');
  expect(e.frame.valid_count).toBeGreaterThan(freeSettings.target);
  expect(e.frame.valid_count).toBe(e.frame.total_count);
 });
 it('supports pause, resume, and reset_counter while measuring',()=>{
  const freeSettings={...defaults,mode:'free' as const};
  const e=new SimulationEngine(freeSettings);
  e.execute({type:'command',protocol:1,command_id:uid(),session_id:e.frame.session_id,action:'calibrate',settings:freeSettings});
  e.advance(2500);
  e.execute({type:'command',protocol:1,command_id:uid(),session_id:e.frame.session_id,action:'start',settings:freeSettings});
  e.advance(6000);
  const countBeforePause=e.frame.valid_count;
  const durationBeforePause=e.frame.duration_ms;
  expect(countBeforePause).toBeGreaterThan(0);
  expect(e.execute({type:'command',protocol:1,command_id:uid(),session_id:e.frame.session_id,action:'pause'}).accepted).toBe(true);
  expect(e.frame.paused).toBe(true);
  e.advance(5000);
  expect(e.frame.valid_count).toBe(countBeforePause);
  expect(e.frame.duration_ms).toBe(durationBeforePause);
  expect(e.execute({type:'command',protocol:1,command_id:uid(),session_id:e.frame.session_id,action:'resume'}).accepted).toBe(true);
  expect(e.frame.paused).toBe(false);
  e.advance(3000);
  expect(e.frame.valid_count).toBeGreaterThan(countBeforePause);
  expect(e.execute({type:'command',protocol:1,command_id:uid(),session_id:e.frame.session_id,action:'reset_counter'}).accepted).toBe(true);
  expect(e.frame.valid_count).toBe(0);
  expect(e.frame.total_count).toBe(0);
  expect(e.frame.repetitions).toHaveLength(0);
  expect(e.frame.state).toBe('training');
 });
});
