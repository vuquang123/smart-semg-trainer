import { afterEach,describe,expect,it,vi } from 'vitest';
import { AudioFeedback,CuePlanner } from '../src/core/audio';
import { clampWindow,panWindow,zoomWindow } from '../src/core/chartWindow';
import { ClockSync } from '../src/core/clockSync';
import { SimulationEngine } from '../src/core/engine';
import { defaults,uid,type Frame } from '../src/core/protocol';
const command=(e:SimulationEngine,action:'calibrate'|'start'|'stop')=>e.execute({type:'command',protocol:1,command_id:uid(),session_id:e.frame.session_id,action,settings:defaults}).snapshot;
afterEach(()=>vi.useRealTimers());
describe('review navigation',()=>{
 it('zooms around the selected instant and pans without leaving recorded time',()=>{const extent={start:0,end:30};const zoomed=zoomWindow(extent,.5,extent,10);expect(zoomed).toEqual({start:5,end:20});expect(panWindow(zoomed,100,extent)).toEqual({start:15,end:30});expect(panWindow(zoomed,-100,extent)).toEqual({start:0,end:15});});
 it('limits zoom to one second and handles a short recording',()=>{expect(zoomWindow({start:5,end:6},.1,{start:0,end:30})).toEqual({start:5,end:6});expect(clampWindow({start:-1,end:10},{start:0,end:.3})).toEqual({start:0,end:.3});expect(clampWindow({start:0,end:0},{start:0,end:0})).toEqual({start:0,end:0});});
 it('shows the full recording when zooming out and preserves null gaps',()=>{const samples=[{t:0,rms:12},{t:1,rms:null},{t:2,rms:30}];const before=structuredClone(samples);expect(zoomWindow({start:1,end:2},100,{start:0,end:2})).toEqual({start:0,end:2});expect(samples).toEqual(before);});
});
describe('audio follows confirmed state',()=>{
 it('does not announce first snapshots or old frames as a new cue',()=>{const e=new SimulationEngine(),p=new CuePlanner();const idle=e.snapshot();expect(p.next(idle,true)).toBeNull();expect(p.next(idle,true)).toBeNull();const calibrating=command(e,'calibrate');expect(p.next(calibrating,true)).toBe('calibrate');expect(p.next(calibrating,true)).toBeNull();});
 it('does not repeat cues every 100ms and announces only real transitions',()=>{const e=new SimulationEngine(),p=new CuePlanner();p.next(e.snapshot(),true);p.next(command(e,'calibrate'),true);p.next(e.advance(2500),true);expect(p.next(command(e,'start'),true)).toBe('start');expect(p.next(e.advance(500),true)).toBe('contract');expect(p.next(e.advance(100),true)).toBeNull();expect(p.next(command(e,'stop'),true)).toBe('stop');});
 it('suppresses replay after disconnect/reconnect and across session IDs',()=>{const e=new SimulationEngine(),p=new CuePlanner();p.next(e.snapshot(),true);expect(p.next(command(e,'calibrate'),false)).toBeNull();expect(p.next(e.advance(100),true)).toBeNull();const other=new SimulationEngine();expect(p.next(command(other,'calibrate'),true)).toBeNull();});
 it('counts 3-2-1 before allowing start, and cancellation never allows start',async()=>{vi.useFakeTimers();const a=new AudioFeedback();a.setPreferences({mode:'beep',volume:.3,countdown:true});const steps:(number|null)[]=[];const ready=a.prepare(n=>steps.push(n));expect(steps).toEqual([3]);await vi.advanceTimersByTimeAsync(1000);expect(steps).toEqual([3,2]);a.cancel();expect(await ready).toBe(false);await vi.advanceTimersByTimeAsync(4000);expect(steps).toEqual([3,2,null]);const done=a.prepare(n=>steps.push(n));await vi.advanceTimersByTimeAsync(3000);expect(await done).toBe(true);expect(steps.slice(-4)).toEqual([3,2,1,null]);});
 it('has no preparation delay while muted and muting cancels an ongoing countdown',async()=>{const a=new AudioFeedback();expect(await a.prepare(()=>{})).toBe(true);vi.useFakeTimers();a.setPreferences({mode:'voice',volume:.3,countdown:true});const pending=a.prepare(()=>{});a.setPreferences({mode:'off',volume:.3,countdown:true});expect(await pending).toBe(false);});
});
describe('monotonic clock estimates',()=>{
 it('estimates network RTT, device offset, sample age and uncertainty without requiring RTC',()=>{const c=new ClockSync();expect(c.observe(100,150,152,122)).toBe(true);const t=c.timing(130,160);expect(t.rtt_ms).toBe(20);expect(t.uncertainty_ms).toBe(10);expect(t.sample_age_ms).toBe(10);});
 it('keeps timing unknown until supported and rejects impossible timestamps',()=>{const c=new ClockSync();expect(c.timing(100,80).sample_age_ms).toBeNull();expect(c.observe(100,100,99,120)).toBe(false);expect(c.observe(100,100,140,120)).toBe(false);expect(c.observe(100,100,100,99)).toBe(false);});
 it('expires old clock estimates and clears them on reboot/reconnect',()=>{const c=new ClockSync();c.observe(100,150,152,122);expect(c.timing(70000,160).rtt_ms).toBeNull();c.reset();expect(c.timing(130,160).sample_age_ms).toBeNull();});
});

it('does not let an old phase packet change the baseline for the next cue',()=>{
 const e=new SimulationEngine(),planner=new CuePlanner();const idle=e.snapshot();planner.next(idle,true);planner.next(command(e,'calibrate'),true);planner.next(e.advance(2500),true);planner.next(command(e,'start'),true);
 const contract=e.advance(500);expect(planner.next(contract,true)).toBe('contract');expect(planner.next(idle,true)).toBeNull();expect(planner.next(e.advance(100),true)).toBeNull();
});
