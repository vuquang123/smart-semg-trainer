import {describe,it,expect} from 'vitest';
import raw from './fixtures/firmware_snapshot.json';
import rawSensor from './fixtures/firmware_sensor_snapshot.json';
import {SimulationEngine} from '../src/core/engine';
import {biofeedback} from '../src/core/biofeedback';
import {defaults,uid,frameSchema,pongSchema} from '../src/core/protocol';
import {PacketGate} from '../src/core/gate';
import {mapFirmwarePacket,firmwareCommand} from '../src/transports/firmwareMapper';
import {exportCsv} from '../src/storage/export';
import {CuePlanner} from '../src/core/audio';

function training(zone=false){const settings={...defaults,zone_enabled:zone};const e=new SimulationEngine(settings);for(const action of ['calibrate','start'] as const){expect(e.execute({type:'command',protocol:1,command_id:uid(),session_id:e.frame.session_id,action,settings}).accepted).toBe(true);if(action==='calibrate')e.advance(2500);}return e;}
function feed(e:SimulationEngine,rms:number,n:number){for(let i=0;i<n;i++){e.frame.t_ms+=100;e.processRms(rms);}}
describe('biofeedback and exact ledger',()=>{
 it('uses an explicit reference and keeps target band independent from activity categories',()=>{expect(biofeedback(90,{...defaults,reference_rms:300}).activation_level).toBe('medium');expect(biofeedback(210,defaults).activation_level).toBe('high');expect(biofeedback(150,defaults).target_zone).toBe('inside');expect(biofeedback(150,{...defaults,reference_rms:undefined}).activation_pct).toBeNull();});
 it('ignores a one-window spike and requires confirmed release',()=>{const e=training();feed(e,30,5);feed(e,235,1);feed(e,30,3);expect(e.frame.total_count).toBe(0);feed(e,235,8);expect(e.frame.total_count).toBe(0);feed(e,30,1);expect(e.frame.total_count).toBe(0);feed(e,30,1);expect(e.frame.total_count).toBe(1);expect(e.frame.repetitions[0]).toMatchObject({hold_ms:800,rest_ms:900,valid:true});});
 it('does not add separate in-zone intervals to pass a continuous-hold target',()=>{const e=training(true);feed(e,30,4);feed(e,165,3);feed(e,250,2);feed(e,165,3);feed(e,30,2);expect(e.frame.repetitions[0]).toMatchObject({hold_ms:800,in_zone_ms:300,valid:false});feed(e,165,6);feed(e,30,2);expect(e.frame.repetitions[1]).toMatchObject({in_zone_ms:600,valid:true});});
 it('can finish the default simulated target-zone exercise',()=>{const e=training(true);for(let n=0;n<1000&&e.frame.state==='training';n++)e.advance(100);expect(e.frame.state).toBe('completed');expect(e.frame.valid_count).toBe(5);expect(e.frame.repetitions.every(r=>r.rest_ms!=null&&r.in_zone_ms!=null)).toBe(true);});
 it('exports exact rest and target hold and leaves absent old fields empty',()=>{const e=training(true);e.advance(4000);const f=e.snapshot();const csv=exportCsv({id:f.session_id,snapshot:f,samples:[],gaps:0,updated_at:new Date().toISOString(),revision:f.sequence,sync:'local'});expect(csv).toContain('"rest_ms","longest_in_zone_ms"');expect(csv).toContain('"reference_rms"');});
 it('announces target corrections only when confirmed target state changes',()=>{const e=training(true),p=new CuePlanner();p.next(e.snapshot(),true);feed(e,250,3);expect(p.next(e.snapshot(),true)).toBe('above');expect(p.next(e.snapshot(),true)).toBeNull();feed(e,165,2);expect(p.next(e.snapshot(),true)).toBe('inside');});
});
describe('actual C serializer to TypeScript boundary',()=>{
 it('preserves source, both thresholds, elapsed time and every exact result',()=>{const f=mapFirmwarePacket(raw);expect(frameSchema.safeParse(f).success).toBe(true);expect(f.source).toBe('simulation');expect(f.t_ms).toBe(raw.t_ms);expect(f.channels).toEqual(raw.channels);expect(f.repetitions.map(({id,...rep})=>rep)).toEqual(raw.repetitions);expect(f.started_at_estimated).toBe(true);});
 it('keeps identifiers on reconnect and translates commands atomically',()=>{const f=mapFirmwarePacket(raw);expect(mapFirmwarePacket({...raw,sequence:raw.sequence+1}).session_id).toBe(f.session_id);const command={type:'command' as const,protocol:1 as const,command_id:uid(),session_id:f.session_id,action:'calibrate' as const,settings:{...defaults,zone_enabled:true}};expect(firmwareCommand(command,f)).toMatchObject({cmd:'web_calibrate',session_id:raw.session_id,boot_id:raw.boot_id,zone_enabled:1,reference_rms:300});});
 it('rejects missing result history instead of inventing holds or valid flags',()=>{expect(()=>mapFirmwarePacket({...raw,repetitions:[]})).toThrow();expect(()=>mapFirmwarePacket({...raw,format:undefined})).toThrow();});
 it('accepts sensor semg_v2 snapshots in both uV (with conversion) and ADC modes through PacketGate and preserves timing_v1/oled_sequence',()=>{
  const gate=new PacketGate();
  const mappedUv=mapFirmwarePacket(rawSensor);
  expect(frameSchema.safeParse(mappedUv).success).toBe(true);
  expect(gate.accept(mappedUv)).not.toBeNull();
  expect(mappedUv.source).toBe('sensor');
  expect(mappedUv.unit).toBe('uV');
  expect(mappedUv.conversion).toMatchObject({uV_per_unit:2.01465,bias:0,scale:805.86,gain:400,calibrated:false});
  expect(mappedUv.capabilities).toContain('timing_v1');
  expect(mappedUv.device_clock_ms).toBe(12345.678);
  expect(mappedUv.sampled_at_device_ms).toBe(12340.123);
  expect(mappedUv.oled_sequence).toBe(41);
  // Sensor in uV without conversion metadata must be rejected.
  const {conversion:_omitted,...missingConversion}=rawSensor;
  expect(()=>mapFirmwarePacket(missingConversion)).toThrow();
  // Sensor in raw ADC count mode must pass both with and without conversion metadata.
  const sensorAdc={...missingConversion,sequence:43,unit:'ADC' as const,t_ms:rawSensor.t_ms+200};
  const mappedAdc=mapFirmwarePacket(sensorAdc);
  expect(frameSchema.safeParse(mappedAdc).success).toBe(true);
  expect(mappedAdc.unit).toBe('ADC');
  expect(mappedAdc.y_max).toBeGreaterThanOrEqual(2048);
  expect(gate.accept(mappedAdc)).not.toBeNull();
  // Verify exact firmware ping/pong payload matches pongSchema.
  expect(pongSchema.safeParse({type:'pong',protocol:1,ping_id:'b14bfae5-0ac6-46d4-948d-8df07c1b1547',device_rx_ms:12500.125,device_tx_ms:12500.625}).success).toBe(true);
 });
});
