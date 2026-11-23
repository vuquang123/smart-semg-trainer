import 'fake-indexeddb/auto';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { TrainerController } from '../src/core/controller';
import { MockTransport } from '../src/transports/mock';
import { Repository } from '../src/storage/repository';
import { defaults,uid } from '../src/core/protocol';
let controller:TrainerController,mock:MockTransport,repo:Repository;
beforeEach(()=>{vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout','setInterval','clearInterval']});repo=new Repository(uid());controller=new TrainerController(repo);mock=new MockTransport();});
afterEach(()=>{controller.destroy();vi.useRealTimers();});
async function connect(){const p=controller.connect(mock);await vi.advanceTimersByTimeAsync(200);await p;}
async function cmd(action:'calibrate'|'start'|'stop'|'reset'){const p=controller.command(action,defaults);await vi.advanceTimersByTimeAsync(200);return p;}
describe('complete transport/controller acceptance flows',()=>{
 it('runs five repetitions and stores a replayable, consistent result',async()=>{await connect();await cmd('calibrate');await vi.advanceTimersByTimeAsync(2600);await cmd('start');await vi.advanceTimersByTimeAsync(30000);await controller.flush();const v=controller.getSnapshot();expect(v.frame?.state).toBe('completed');expect(v.frame?.valid_count).toBe(5);const stored=(await repo.all())[0];expect(stored.snapshot.valid_count).toBe(v.frame?.valid_count);expect(stored.samples.length).toBeGreaterThan(50);expect(stored.snapshot.repetitions).toEqual(v.frame?.repetitions);});
 it('prioritizes stop during calibration',async()=>{await connect();await cmd('calibrate');await cmd('stop');await vi.advanceTimersByTimeAsync(10000);expect(controller.getSnapshot().frame?.state).toBe('stopped');expect(controller.getSnapshot().frame?.valid_count).toBe(0);});
 it('never declares stopped on connection loss; reconnect keeps the session and ledger',async()=>{await connect();await cmd('calibrate');await vi.advanceTimersByTimeAsync(2600);await cmd('start');const id=controller.getSnapshot().frame?.session_id;mock.loseConnection();await vi.advanceTimersByTimeAsync(7000);expect(controller.getSnapshot().live).toBe(false);expect(controller.getSnapshot().connection).toBe('lost');expect(controller.getSnapshot().frame?.state).toBe('training');const p=controller.connect();await vi.advanceTimersByTimeAsync(200);await p;expect(controller.getSnapshot().frame?.session_id).toBe(id);expect(controller.getSnapshot().record?.gaps).toBeGreaterThan(0);expect(controller.getSnapshot().record?.samples.some(s=>s.rms===null)).toBe(true);expect(controller.getSnapshot().frame?.total_count).toBeGreaterThan(0);});
 it('does not replay or restart a stopped session on reconnect',async()=>{await connect();await cmd('calibrate');await cmd('stop');const before=controller.getSnapshot().frame!;mock.loseConnection();await vi.advanceTimersByTimeAsync(3000);const p=controller.connect();await vi.advanceTimersByTimeAsync(200);await p;expect(controller.getSnapshot().frame?.session_id).toBe(before.session_id);expect(controller.getSnapshot().frame?.state).toBe('stopped');});
 it('prevents duplicate commands and supports STOP while a slow command is pending',async()=>{await connect();mock.delay=3000;const a=controller.command('calibrate',defaults);expect(await controller.command('calibrate',defaults)).toBe(false);const b=controller.command('stop');await vi.advanceTimersByTimeAsync(3100);await Promise.all([a,b]);expect(controller.getSnapshot().frame?.state).toBe('stopped');expect(controller.getSnapshot().pending).toBeNull();});
 it('reports missing acknowledgment without changing state optimistically',async()=>{await connect();mock.dropNextAck=true;const p=controller.command('calibrate',defaults);expect(controller.getSnapshot().frame?.state).toBe('idle');await vi.advanceTimersByTimeAsync(6300);expect(await p).toBe(false);expect(controller.getSnapshot().error).toMatch(/Chưa nhận/);expect(controller.getSnapshot().pending).toBeNull();});
 it('reset preserves previously saved results',async()=>{await connect();await cmd('calibrate');await cmd('stop');await controller.flush();const old=controller.getSnapshot().frame!.session_id;await cmd('reset');expect(controller.getSnapshot().frame?.session_id).not.toBe(old);expect((await repo.all()).some(r=>r.id===old)).toBe(true);});
});

it('restores saved local simulation history without overwriting its received RMS samples',async()=>{
 await connect();await cmd('calibrate');await vi.advanceTimersByTimeAsync(2600);await cmd('start');await vi.advanceTimersByTimeAsync(5000);await controller.flush();
 const before=(await repo.all())[0];controller.destroy();
 const next=new MockTransport();next.engine.restore(before.snapshot);controller=new TrainerController(repo);
 const p=controller.connect(next,before);await vi.advanceTimersByTimeAsync(200);await p;await controller.flush();
 const after=(await repo.all())[0];expect(after.id).toBe(before.id);expect(after.samples).toEqual(before.samples);expect(after.snapshot.state).toBe('stopped');expect(after.snapshot.valid_count).toBe(before.snapshot.valid_count);
});

it('resets free mode counter without deleting previous sessions in history',async()=>{
 await connect();await cmd('calibrate');await vi.advanceTimersByTimeAsync(2600);await cmd('start');await vi.advanceTimersByTimeAsync(5000);await cmd('stop');await controller.flush();
 const firstSessionId=controller.getSnapshot().frame!.session_id;
 await cmd('reset');
 const freeSettings={...defaults,mode:'free' as const};
 const cal=controller.command('calibrate',freeSettings);await vi.advanceTimersByTimeAsync(200);await cal;
 await vi.advanceTimersByTimeAsync(2600);
 const st=controller.command('start',freeSettings);await vi.advanceTimersByTimeAsync(200);await st;
 await vi.advanceTimersByTimeAsync(4000);
 expect(controller.getSnapshot().frame?.valid_count).toBeGreaterThan(0);
 const rc=controller.command('reset_counter');await vi.advanceTimersByTimeAsync(200);await rc;
 expect(controller.getSnapshot().frame?.valid_count).toBe(0);
 const all=await repo.all();
 expect(all.some(r=>r.id===firstSessionId)).toBe(true);
});


it('operates on single-channel CH1, updates electrode muscle placement, records CH1 filtered samples, and preserves valid state when command fails',async()=>{
 await connect();
 expect(controller.getSnapshot().frame?.channel_count).toBe(1);
 expect(controller.getSnapshot().frame?.selected_channel).toBe(1);
 const bicepsSettings={...defaults,channel:1 as const,muscle:'biceps' as const};
 const idleSwitch=controller.command('reset',bicepsSettings);
 await vi.advanceTimersByTimeAsync(200);
 expect(await idleSwitch).toBe(true);
 expect(controller.getSnapshot().frame?.selected_channel).toBe(1);
 expect(controller.getSnapshot().frame?.settings.muscle).toBe('biceps');
 expect(controller.getSnapshot().error).toBeNull();

 const cal=controller.command('calibrate',bicepsSettings);
 await vi.advanceTimersByTimeAsync(2800);
 await cal;
 expect(controller.getSnapshot().frame?.state).toBe('ready');
 const firstSample=controller.getSnapshot().record?.samples.find(s=>s.rms!==null);
 expect(firstSample?.filtered).toBeTypeOf('number');
 expect((firstSample as Record<string,unknown>)?.ch2_rms).toBeUndefined();
 const readySwitch=controller.command('reset',defaults);
 await vi.advanceTimersByTimeAsync(200);
 expect(await readySwitch).toBe(true);
 expect(controller.getSnapshot().frame?.selected_channel).toBe(1);
 expect(controller.getSnapshot().frame?.settings.muscle).toBe('forearm');

 mock.rejectNextCommand=true;
 const failedSwitch=controller.command('reset',bicepsSettings);
 await vi.advanceTimersByTimeAsync(200);
 expect(await failedSwitch).toBe(false);
 expect(controller.getSnapshot().frame?.selected_channel).toBe(1);
 expect(controller.getSnapshot().frame?.settings.muscle).toBe('forearm');
});
