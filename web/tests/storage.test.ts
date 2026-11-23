import 'fake-indexeddb/auto';
import { describe,expect,it } from 'vitest';
import { Repository } from '../src/storage/repository';
import { SimulationEngine } from '../src/core/engine';
import { defaults,uid,type SessionRecord } from '../src/core/protocol';
import { exportCsv } from '../src/storage/export';
const fixture=():SessionRecord=>{
 const e=new SimulationEngine();e.execute({type:'command',protocol:1,command_id:uid(),session_id:e.frame.session_id,action:'stop'});const f=e.snapshot();
 return {id:f.session_id,snapshot:f,samples:[{t_ms:100,rms:20,on_threshold:140,off_threshold:85},{t_ms:101,rms:null,on_threshold:140,off_threshold:85}],gaps:1,revision:f.sequence,updated_at:new Date().toISOString(),sync:'local'};
};
describe('IndexedDB local history and outbox',()=>{
 it('persists and reopens a session with RMS gaps',async()=>{const name=uid();const r=new Repository(name);const record=fixture();await r.save(record);const reopened=new Repository(name);expect((await reopened.all())[0]).toEqual(record);});
 it('does not duplicate sessions or jobs when synchronizing again',async()=>{const r=new Repository(uid());const f=fixture();await r.save(f);await r.save(f);await r.queue('user-a');await r.queue('user-a');expect(await r.all('user-a')).toHaveLength(1);expect(await r.jobs('user-a')).toHaveLength(1);const job=(await r.jobs('user-a'))[0];await r.ack(job);expect((await r.all('user-a'))[0].sync).toBe('synced');await r.queue('user-a');expect(await r.jobs('user-a')).toHaveLength(0);});
 it('isolates accounts and never sends user-a jobs as user-b',async()=>{const r=new Repository(uid());await r.save(fixture());await r.queue('user-a');await r.queue('user-b');expect(await r.jobs('user-b')).toHaveLength(0);expect(await r.all('user-b')).toHaveLength(0);expect(await r.all()).toHaveLength(0);expect(await r.all('user-a')).toHaveLength(1);});
 it('backs off failed uploads without blocking local history',async()=>{const r=new Repository(uid());await r.save(fixture());await r.queue('a');const job=(await r.jobs('a'))[0];await r.failed(job);expect(await r.jobs('a')).toHaveLength(0);expect(await r.jobs('a',Date.now()+10000)).toHaveLength(1);expect(await r.all('a')).toHaveLength(1);});
 it('keeps a newer revision pending if an old upload completes later',async()=>{const r=new Repository(uid());const f=fixture();await r.save(f);await r.queue('a');const job=(await r.jobs('a'))[0];await r.save({...f,revision:f.revision+5,owner_id:'a'});await r.ack(job);expect(await r.jobs('a')).toHaveLength(1);expect((await r.all('a'))[0].sync).toBe('pending');});
 it('separates reset/new records from old history',async()=>{const r=new Repository(uid());const a=fixture(),b=fixture();await r.save(a);await r.save(b);expect(await r.all()).toHaveLength(2);expect(await r.get(a.id)).toBeDefined();});
 it('deletes only the selected session and queues a cloud tombstone',async()=>{const r=new Repository(uid());const a=fixture(),b=fixture();await r.save(a);await r.save(b);await r.queue('a');const up=(await r.jobs('a')).find(j=>j.session_id===a.id)!;await r.remove(a.id);await r.ack(up);expect(await r.all('a')).toHaveLength(1);expect((await r.jobs('a')).find(j=>j.session_id===a.id)?.action).toBe('delete');await r.save(a);expect(await r.all('a')).toHaveLength(1);});
 it('exports received timestamps and gaps without synthesizing RMS points',()=>{const f=fixture();const csv=exportCsv(f);expect(csv).toContain('"100","20"');expect(csv).toContain('"101",""');expect(csv).toContain('"source","unit"');expect(JSON.parse(JSON.stringify(f)).samples.length).toBe(2);});
});
