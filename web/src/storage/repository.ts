import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { RawChunk, SessionRecord } from '../core/protocol';
export type OutboxItem={ key:string; session_id:string; owner_id:string; action:'upsert'|'delete'; attempts:number; retry_at:number; revision:number };
interface Schema extends DBSchema {
  sessions:{key:string,value:SessionRecord};
  outbox:{key:string,value:OutboxItem};
  raw_chunks:{key:string,value:RawChunk;indexes:{by_session:string}};
}
export class Repository {
  private db:Promise<IDBPDatabase<Schema>>;
  constructor(name='smart-semg-v1') {
    this.db=openDB<Schema>(name,2,{
      upgrade(db,oldVersion){
        if(oldVersion<1){
          db.createObjectStore('sessions',{keyPath:'id'});
          db.createObjectStore('outbox',{keyPath:'key'});
        }
        if(oldVersion<2 && !db.objectStoreNames.contains('raw_chunks')){
          const store=db.createObjectStore('raw_chunks',{keyPath:'key'});
          store.createIndex('by_session','session_id',{unique:false});
        }
      },
    });
  }
  async all(owner?:string){return (await (await this.db).getAll('sessions')).filter(r=>!r.deleted && (!r.owner_id || r.owner_id===owner)).sort((a,b)=>b.snapshot.started_at.localeCompare(a.snapshot.started_at));}
  async get(id:string){return (await this.db).get('sessions',id);}
  async save(record:SessionRecord){
    const db=await this.db;const tx=db.transaction(['sessions','outbox'],'readwrite');
    const previous=await tx.objectStore('sessions').get(record.id);
    if(previous?.deleted || previous && previous.revision>record.revision){await tx.done;return;}
    const r={...record,owner_id:record.owner_id??previous?.owner_id,cloud_owner_id:record.cloud_owner_id??previous?.cloud_owner_id};
    if(r.owner_id){r.sync='pending';await tx.objectStore('outbox').put({key:`${r.owner_id}/${r.id}`,session_id:r.id,owner_id:r.owner_id,action:'upsert',attempts:0,retry_at:0,revision:r.revision});}
    await tx.objectStore('sessions').put(r);await tx.done;
  }
  async queue(owner:string){
    const db=await this.db;const tx=db.transaction(['sessions','outbox'],'readwrite');
    for(const r of await tx.objectStore('sessions').getAll()){
      if(r.deleted || r.owner_id && r.owner_id!==owner || !['completed','stopped','error'].includes(r.snapshot.state) || r.sync==='synced' && r.owner_id===owner)continue;
      r.owner_id=owner;r.sync='pending';await tx.objectStore('sessions').put(r);
      const key=`${owner}/${r.id}`;
      if(!await tx.objectStore('outbox').get(key))await tx.objectStore('outbox').put({key,session_id:r.id,owner_id:owner,action:'upsert',attempts:0,retry_at:0,revision:r.revision});
    }
    await tx.done;
  }
  async jobs(owner:string,now=Date.now()){return (await (await this.db).getAll('outbox')).filter(j=>j.owner_id===owner && j.retry_at<=now);}
  async failed(job:OutboxItem){
    const db=await this.db;const tx=db.transaction('outbox','readwrite');const current=await tx.store.get(job.key);
    if(current && current.revision===job.revision && current.action===job.action)await tx.store.put({...current,attempts:job.attempts+1,retry_at:Date.now()+Math.min(300000,2000*2**Math.min(job.attempts,8))});await tx.done;
  }
  async ack(job:OutboxItem){
    const db=await this.db;const tx=db.transaction(['sessions','outbox'],'readwrite');const current=await tx.objectStore('outbox').get(job.key);
    if(current?.revision===job.revision && current.action===job.action){
      await tx.objectStore('outbox').delete(job.key);const r=await tx.objectStore('sessions').get(job.session_id);
      if(r && !r.deleted && r.revision===job.revision){r.sync='synced';r.cloud_owner_id=job.owner_id;await tx.objectStore('sessions').put(r);}
    }await tx.done;
  }
  async remove(id:string){
    const db=await this.db;const tx=db.transaction(['sessions','outbox','raw_chunks'],'readwrite');const r=await tx.objectStore('sessions').get(id);
    if(r){r.deleted=true;r.revision++;await tx.objectStore('sessions').put(r);
      if(r.owner_id)await tx.objectStore('outbox').put({key:`${r.owner_id}/${id}`,session_id:id,owner_id:r.owner_id,action:'delete',attempts:0,retry_at:0,revision:r.revision});
    }
    let cursor=await tx.objectStore('raw_chunks').index('by_session').openCursor(id);
    while(cursor){await cursor.delete();cursor=await cursor.continue();}
    await tx.done;
  }
  async appendRawChunks(chunks:RawChunk[]){
    if(!chunks.length)return;
    const db=await this.db;
    const tx=db.transaction('raw_chunks','readwrite');
    for(const c of chunks)await tx.store.put(c);
    await tx.done;
  }
  async getRawChunks(sessionId:string):Promise<RawChunk[]>{
    const db=await this.db;
    const list=await db.getAllFromIndex('raw_chunks','by_session',sessionId);
    return list.sort((a,b)=>a.chunk_seq-b.chunk_seq);
  }
  async iterateRawChunks(sessionId:string,onChunk:(chunk:RawChunk)=>void|Promise<void>):Promise<number>{
    const db=await this.db;
    const keys=(await db.getAllKeysFromIndex('raw_chunks','by_session',sessionId)).sort();
    let count=0;
    const BATCH=8;
    for(let i=0;i<keys.length;i+=BATCH){
      const slice=keys.slice(i,i+BATCH);
      const tx=db.transaction('raw_chunks','readonly');
      const items=await Promise.all(slice.map(k=>tx.store.get(k)));
      await tx.done;
      const valid=items.filter((c):c is RawChunk=>!!c).sort((a,b)=>a.chunk_seq-b.chunk_seq);
      for(const c of valid){await onChunk(c);count++;}
    }
    return count;
  }
  async deleteRawChunks(sessionId:string){
    const db=await this.db;
    const tx=db.transaction('raw_chunks','readwrite');
    let cursor=await tx.store.index('by_session').openCursor(sessionId);
    while(cursor){await cursor.delete();cursor=await cursor.continue();}
    await tx.done;
  }
  async mergeCloud(remote:SessionRecord,owner:string){
    const db=await this.db;const tx=db.transaction(['sessions','outbox'],'readwrite');
    const old=await tx.objectStore('sessions').get(remote.id);const pending=await tx.objectStore('outbox').get(`${owner}/${remote.id}`);
    if(!pending && (!old || old.owner_id===owner && old.revision<=remote.revision))await tx.objectStore('sessions').put({...remote,owner_id:owner,cloud_owner_id:owner,sync:'synced'});
    await tx.done;
  }
}
