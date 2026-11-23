import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { frameSchema, type SessionRecord } from '../core/protocol';
import type { OutboxItem,Repository } from './repository';
const url=import.meta.env.VITE_SUPABASE_URL?.trim();const key=import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export const supabase:SupabaseClient|null=url && key ? createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
export class CloudSync {
  private running=false;
  constructor(private repository:Repository,private client:SupabaseClient){}
  async sync(owner:string){
    if(this.running)return;this.running=true;
    try{
      await this.repository.queue(owner);
      for(const job of await this.repository.jobs(owner)){
        try{await this.push(job);await this.repository.ack(job);}catch(e){await this.repository.failed(job);throw e;}
      }
      const {data,error}=await this.client.from('sessions').select('id,owner_id,payload,deleted_at').eq('owner_id',owner).order('started_at',{ascending:false}).limit(100);
      if(error)throw error;
      for(const row of data??[]){
        const p=row.payload as SessionRecord;
        if(!p || p.id!==row.id || !frameSchema.safeParse(p.snapshot).success || !Array.isArray(p.samples))continue;
        await this.repository.mergeCloud({...p,deleted:!!row.deleted_at},owner);
      }
    }finally{this.running=false;}
  }
  private async push(job:OutboxItem){
    const r=await this.repository.get(job.session_id);if(!r || r.owner_id!==job.owner_id)return;
    if(job.action==='delete'){
      const {error}=await this.client.from('sessions').update({deleted_at:new Date().toISOString()}).eq('id',r.id).eq('owner_id',job.owner_id);if(error)throw error;return;
    }
    const f=r.snapshot;
    const {error}=await this.client.from('sessions').upsert({id:r.id,owner_id:job.owner_id,device_id:f.device_id,started_at:f.started_at,state:f.state,muscle:f.settings.muscle,channel:f.selected_channel,source:f.source,target:f.settings.target,valid_count:f.valid_count,total_count:f.total_count,duration_ms:f.duration_ms,revision:r.revision,payload:r,deleted_at:null},{onConflict:'id'});
    if(error)throw error;
    if(f.repetitions.length){const {error:e}=await this.client.from('repetitions').upsert(f.repetitions.map(rep=>({id:rep.id,ordinal:rep.ordinal,ended_ms:rep.ended_ms,hold_ms:rep.hold_ms,valid:rep.valid,session_id:r.id,owner_id:job.owner_id})),{onConflict:'id'});if(e)throw e;}
  }
  async uploadExperimentalFile(owner:string,sessionId:string,file:File){
    if(file.size>10*1024*1024)throw new Error('File thử nghiệm tối đa 10 MB.');
    const path=`${owner}/${sessionId}/${crypto.randomUUID()}.bin`;
    const {error}=await this.client.storage.from('signals').upload(path,file,{upsert:false});if(error)throw error;
    const {error:e}=await this.client.from('signal_files').insert({owner_id:owner,session_id:sessionId,object_path:path,size_bytes:file.size});if(e)throw e;
  }
}
