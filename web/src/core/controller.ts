import type { LinkTiming } from './clockSync';
import { PacketGate } from './gate';
import {
  uid,
  isTerminal,
  sameSettings,
  type Action,
  type ConfigHistoryEntry,
  type Connection,
  type Frame,
  type RawBatchPacket,
  type RawChunk,
  type RawEncoding,
  type RawSummary,
  type Sample,
  type SessionRecord,
  type Settings,
} from './protocol';
import type { Transport } from '../transports/types';
import type { Repository } from '../storage/repository';
export type Diagnostics=LinkTiming&{received_interval_ms:number|null;command_rtt_ms:number|null;oled_sequence_gap:number|null;accepted_packets:number;ignored_packets:number};
export type SyncEntry={received_at:string;session_id:string;sequence:number;device_clock_ms?:number;sampled_at_device_ms?:number;oled_sequence?:number;state:Frame['state'];valid_count:number;timing:Diagnostics};
const emptyTiming=():Diagnostics=>({rtt_ms:null,sample_age_ms:null,uncertainty_ms:null,received_interval_ms:null,command_rtt_ms:null,oled_sequence_gap:null,accepted_packets:0,ignored_packets:0});
const MAX_RAW_SESSION_BYTES = 50 * 1024 * 1024;
export type ViewState={connection:Connection;frame:Frame|null;live:boolean;pending:Action|null;error:string|null;record:SessionRecord|null;savedAt:number|null;storageError:string|null;version:number;diagnostics:Diagnostics;rawRecordingEnabled?:boolean};
export class TrainerController {
  private state:ViewState={connection:'disconnected',frame:null,live:false,pending:null,error:null,record:null,savedAt:null,storageError:null,version:0,diagnostics:emptyTiming(),rawRecordingEnabled:false};
  private listeners=new Set<()=>void>();private gate=new PacketGate();private transport?:Transport;private off:(()=>void)[]=[];
  private connectToken=0;private receivedAt=0;private syncLog:SyncEntry[]=[];
  private lastFrameAt=0;private lastSaved=0;private watchdog?:ReturnType<typeof setInterval>;private saveChain=Promise.resolve();private requestToken=0;
  private rawSessionId:string|null=null;private rawPendingChunks:RawChunk[]=[];private rawChunkSeq=0;
  private rawExpectedSample:number|null=null;private rawFirstWallMs:number|null=null;private rawLastWallMs:number|null=null;private rawFirstSampleCount=0;
  private rawTotalSamples=0;private rawMissingSamples=0;private rawGapEvents=0;private rawOverflowEvents=0;private rawStorageBytes=0;private rawTruncated=false;
  private rawEncoding?:RawEncoding;private rawFsHz?:number;private rawChannels?:1|2;private lastRawFlushedAt=0;
  constructor(private repository:Repository,initialRawRecording=false){
    this.state={...this.state,rawRecordingEnabled:initialRawRecording};
  }
  getSnapshot=()=>this.state;
  subscribe=(h:()=>void)=>{this.listeners.add(h);return ()=>{this.listeners.delete(h);};};
  private update(p:Partial<ViewState>){this.state={...this.state,...p,version:this.state.version+1};this.listeners.forEach(h=>h());}
  getSyncLog(){return structuredClone(this.syncLog);}
  get adapter(){return this.transport;}
  setRawRecording(enabled:boolean){this.update({rawRecordingEnabled:enabled});}
  private resetRawTracker(sessionId:string|null,existing?:RawSummary){
    this.rawSessionId=sessionId;
    this.rawPendingChunks=[];
    this.rawChunkSeq=existing?.chunk_count??0;
    this.rawExpectedSample=null;
    this.rawFirstWallMs=null;
    this.rawLastWallMs=null;
    this.rawFirstSampleCount=0;
    this.rawTotalSamples=existing?.sample_count??0;
    this.rawMissingSamples=existing?.missing_samples_detected??0;
    this.rawGapEvents=existing?.gap_events??0;
    this.rawOverflowEvents=existing?.overflow_events??0;
    this.rawStorageBytes=existing?.bytes_stored??0;
    this.rawTruncated=existing?.truncated??false;
    this.rawEncoding=existing?.encoding;
    this.rawFsHz=existing?.fs_hz;
    this.rawChannels=existing?.channel_count;
    this.lastRawFlushedAt=Date.now();
  }
  private flushRawChunks(){
    if(!this.rawPendingChunks.length)return;
    const batch=this.rawPendingChunks.splice(0,this.rawPendingChunks.length);
    this.lastRawFlushedAt=Date.now();
    this.saveChain=this.saveChain.then(()=>this.repository.appendRawChunks(batch)).catch(e=>{
      this.update({storageError:`Không lưu được dữ liệu RAW trên máy: ${(e as Error).message}.`});
    });
  }
  private buildRawSummary(f:Frame):RawSummary{
    const enabled=Boolean(f.raw_recording??this.state.rawRecordingEnabled);
    const available=this.rawTotalSamples>0;
    const supportsRaw=Boolean(f.capabilities?.includes('raw_stream_v1'));
    const unavailableReason=available
      ?null
      :!enabled
        ?'Tùy chọn "Ghi dữ liệu RAW cho nghiên cứu" chưa được bật trước khi bắt đầu phiên.'
        :!supportsRaw
          ?'Thiết bị/firmware hiện tại chưa hỗ trợ truyền luồng dữ liệu RAW (raw_stream_v1).'
          :'Chưa có mẫu RAW nào được ghi nhận trong phiên này.';
    let measuredFs:number|null=null;
    if(this.rawFirstWallMs!==null && this.rawLastWallMs!==null && this.rawLastWallMs-this.rawFirstWallMs>=1000 && this.rawTotalSamples>this.rawFirstSampleCount){
      measuredFs=Math.round((((this.rawTotalSamples-this.rawFirstSampleCount)*1000)/(this.rawLastWallMs-this.rawFirstWallMs))*10)/10;
    }
    const missing=Math.max(this.rawMissingSamples,f.health?.raw_dropped_samples??0);
    const overflows=Math.max(this.rawOverflowEvents,f.health?.raw_overflow_events??0);
    return {
      enabled,
      available,
      unavailable_reason:unavailableReason,
      encoding:this.rawEncoding,
      fs_hz:this.rawFsHz??f.fs_hz,
      measured_fs_hz:measuredFs,
      channel_count:this.rawChannels??f.channel_count,
      sample_count:this.rawTotalSamples,
      chunk_count:this.rawChunkSeq,
      bytes_stored:this.rawStorageBytes,
      tracking_method:(supportsRaw || available || f.health?.tracking_supported)?'source_sample_index':'none',
      missing_samples_detected:missing,
      gap_events:this.rawGapEvents,
      overflow_events:overflows,
      truncated:this.rawTruncated||undefined,
    };
  }
  private acceptRaw(batch:RawBatchPacket){
    const currentId=this.state.frame?.session_id??this.rawSessionId;
    if(currentId && batch.session_id!==currentId)return;
    if(this.rawSessionId!==batch.session_id){
      this.flushRawChunks();
      this.resetRawTracker(batch.session_id);
    }
    if(this.rawTruncated)return;
    const byteLength=batch.data.byteLength;
    if(this.rawStorageBytes+byteLength>MAX_RAW_SESSION_BYTES){
      this.rawTruncated=true;
      this.flushRawChunks();
      return;
    }
    let discontinuity=false;
    if(this.rawExpectedSample!==null && batch.first_sample_index>this.rawExpectedSample){
      this.rawMissingSamples+=batch.first_sample_index-this.rawExpectedSample;
      this.rawGapEvents++;
      discontinuity=true;
    } else if(this.rawExpectedSample===null && (batch.dropped_before??0)>0){
      this.rawMissingSamples+=batch.dropped_before!;
      this.rawGapEvents++;
      discontinuity=true;
    }
    this.rawExpectedSample=batch.first_sample_index+batch.sample_count;
    this.rawTotalSamples+=batch.sample_count;
    this.rawStorageBytes+=byteLength;
    this.rawEncoding=batch.encoding;
    this.rawFsHz=batch.fs_hz;
    this.rawChannels=batch.channels;
    const wall=batch.received_wall_ms??Date.now();
    if(this.rawFirstWallMs===null){this.rawFirstWallMs=wall;this.rawFirstSampleCount=batch.sample_count;}
    this.rawLastWallMs=wall;
    const seq=this.rawChunkSeq++;
    const copiedBytes=new Uint8Array(byteLength);
    copiedBytes.set(new Uint8Array(batch.data.buffer,batch.data.byteOffset,byteLength));
    this.rawPendingChunks.push({
      key:`${batch.session_id}/${String(seq).padStart(10,'0')}`,
      session_id:batch.session_id,
      chunk_seq:seq,
      first_sample_index:batch.first_sample_index,
      sample_count:batch.sample_count,
      channels:batch.channels,
      fs_hz:batch.fs_hz,
      encoding:batch.encoding,
      data:copiedBytes.buffer,
      discontinuity:discontinuity||undefined,
    });
    if(this.rawPendingChunks.length>=8 || Date.now()-this.lastRawFlushedAt>=1000){
      this.flushRawChunks();
    }
  }
  async connect(adapter?:Transport,restored?:SessionRecord){
    const connectionToken=++this.connectToken;this.update({error:null});
    if(adapter && adapter!==this.transport){
      if(this.state.frame && ['training','calibrating'].includes(this.state.frame.state))throw new Error('Hãy dừng và xác nhận buổi hiện tại trước khi đổi nguồn dữ liệu.');
      this.flushRawChunks();
      this.off.forEach(f=>f());this.transport?.disconnect();this.transport=adapter;this.gate=new PacketGate();
      this.receivedAt=0;this.syncLog=[];
      this.resetRawTracker(restored?.id??null,restored?.raw_summary);
      this.update({frame:null,record:restored??null,live:false,savedAt:restored?Date.now():null,diagnostics:emptyTiming()});
      const offs:(()=>void)[]=[
        adapter.onFrame(f=>this.accept(f)),
        adapter.onConnection(connection=>{this.update({connection,live:connection==='connected' && Date.now()-this.lastFrameAt<2000});}),
      ];
      if(adapter.onRawBatch)offs.push(adapter.onRawBatch(b=>this.acceptRaw(b)));
      this.off=offs;
    }
    if(!this.transport)return;
    try{await this.transport.connect();if(connectionToken!==this.connectToken)return;this.update({error:null});if(this.watchdog)clearInterval(this.watchdog);this.watchdog=setInterval(()=>{if(this.state.connection==='connected' && Date.now()-this.lastFrameAt>2500)this.update({connection:'lost',live:false,error:'Mất dữ liệu trực tiếp. Chưa xác nhận trạng thái thiết bị.'});},500);}catch(e){if(connectionToken!==this.connectToken)return;this.update({connection:'lost',live:false,error:(e as Error).message});throw e;}
  }
  private accept(input:Frame){
    const f=this.gate.accept(input);if(!f){this.update({diagnostics:{...this.state.diagnostics,ignored_packets:this.state.diagnostics.ignored_packets+1}});return;}
    const now=performance.now();
    const diagnostics:Diagnostics={...this.state.diagnostics,...(this.transport?.getDiagnostics?.()??{rtt_ms:null,sample_age_ms:null,uncertainty_ms:null}),received_interval_ms:this.receivedAt?now-this.receivedAt:null,accepted_packets:this.state.diagnostics.accepted_packets+1,oled_sequence_gap:f.oled_sequence!=null?f.sequence-f.oled_sequence:null};this.receivedAt=now;
    this.syncLog.push({received_at:new Date().toISOString(),session_id:f.session_id,sequence:f.sequence,device_clock_ms:f.device_clock_ms,sampled_at_device_ms:f.sampled_at_device_ms,oled_sequence:f.oled_sequence,state:f.state,valid_count:f.valid_count,timing:diagnostics});if(this.syncLog.length>300)this.syncLog.shift();
    const p=this.state.record;let record:SessionRecord|null=p;
    const changed=!p || p.id!==f.session_id || p.snapshot.t_ms!==f.t_ms || p.snapshot.state!==f.state || p.snapshot.paused!==f.paused || p.snapshot.total_count!==f.total_count || p.snapshot.valid_count!==f.valid_count;
    if(f.state!=='idle' && changed){
      const same=p?.id===f.session_id;
      if(!same){
        this.flushRawChunks();
        if(this.rawSessionId!==f.session_id)this.resetRawTracker(f.session_id);
      }
      const channel=f.channels.find(c=>c.id===f.selected_channel)??f.channels[0]!;
      const samples:Sample[]=same?[...p.samples]:[];
      let gaps=same?p.gaps:0;
      const previous=samples.at(-1);
      if(previous && f.t_ms-previous.t_ms>450){samples.push({t_ms:previous.t_ms+1,rms:null,filtered:null,on_threshold:channel.on_threshold,off_threshold:channel.off_threshold});gaps++;}
      // One genuine sample per received timestamp, never interpolation.
      if(!previous || f.t_ms>previous.t_ms){
        samples.push({
          t_ms:f.t_ms,
          rms:channel.rms,
          filtered:channel.filtered??null,
          on_threshold:channel.on_threshold,
          off_threshold:channel.off_threshold,
          activation_pct:f.activation_pct,
          target_zone:f.target_zone,
          ...(f.fs_hz?{sample_index:Math.round((f.t_ms*f.fs_hz)/1000)}:{}),
        });
      }
      const configHistory:ConfigHistoryEntry[]=same?[...(p.config_history??[])]:[];
      const makeHist=(event:ConfigHistoryEntry['event'],note?:string):ConfigHistoryEntry=>({
        t_ms:f.t_ms,
        recorded_at:new Date().toISOString(),
        event,
        channel:1,
        on_threshold:channel.on_threshold,
        off_threshold:channel.off_threshold,
        min_hold_ms:f.settings.min_hold_ms,
        target:f.settings.target,
        zone_enabled:Boolean(f.settings.zone_enabled),
        reference_rms:f.settings.reference_rms,
        zone_low_pct:f.settings.zone_low_pct,
        zone_high_pct:f.settings.zone_high_pct,
        ...(note?{note}:{}),
      });
      if(!same || configHistory.length===0){
        configHistory.push(makeHist('session_start'));
      } else {
        const prevSnap=p.snapshot;
        const prevCh=prevSnap.channels.find(c=>c.id===prevSnap.selected_channel);
        if(prevSnap.state==='calibrating' && f.state==='ready'){
          configHistory.push(makeHist('calibrated','Hoàn tất hiệu chuẩn mức nghỉ'));
        } else if(prevCh && (prevCh.on_threshold!==channel.on_threshold || prevCh.off_threshold!==channel.off_threshold)){
          configHistory.push(makeHist('threshold_change'));
        } else if(!sameSettings(prevSnap.settings,f.settings)){
          configHistory.push(makeHist('settings_change'));
        }
        if(Boolean(prevSnap.paused)!==Boolean(f.paused)){
          configHistory.push(makeHist(f.paused?'pause':'resume'));
        }
        if(prevSnap.state!==f.state && (f.state==='stopped' || f.state==='completed')){
          configHistory.push(makeHist(f.state==='completed'?'complete':'stop'));
        }
      }
      record={
        id:f.session_id,
        snapshot:f,
        samples,
        gaps,
        updated_at:new Date().toISOString(),
        revision:f.sequence,
        sync:'local',
        adapter_kind:this.transport?.kind,
        owner_id:same?p.owner_id:undefined,
        config_history:configHistory,
        raw_summary:this.buildRawSummary(f),
      };
    }else if(f.state==='idle')record=null;
    this.lastFrameAt=Date.now();this.update({frame:f,live:true,connection:'connected',record,diagnostics});
    if(record && changed && (Date.now()-this.lastSaved>1000 || isTerminal(f.state))){
      this.lastSaved=Date.now();
      if(isTerminal(f.state))this.flushRawChunks();
      this.persist(record);
    }
  }
  private persist(record:SessionRecord){
    this.saveChain=this.saveChain.then(async()=>{
      await this.repository.save(record);
      if(this.state.record?.id===record.id)this.update({savedAt:Date.now(),storageError:null});
    }).catch(e=>this.update({storageError:`Không lưu được trên máy: ${(e as Error).message}. Hãy xuất dữ liệu để giữ kết quả.`}));
  }
  async flush(){
    this.flushRawChunks();
    if(this.state.record){
      const latest=this.state.frame?{...this.state.record,raw_summary:this.buildRawSummary(this.state.frame)}:this.state.record;
      this.persist(latest);
    }
    await this.saveChain;
  }
  async command(action:Action,settings?:Settings){
    // STOP preempts a delayed command. No other duplicate commands may queue.
    if(this.state.pending && action!=='stop')return false;
    if(this.state.pending==='stop')return false;
    if(!this.transport || this.state.connection!=='connected'){this.update({error:'Chưa xác nhận trạng thái thiết bị. Hãy kết nối lại.'});return false;}
    const sentAt=performance.now();const token=++this.requestToken;this.update({pending:action,error:null});
    try{
      const includeRaw=['calibrate','start','reset'].includes(action);
      const ack=await this.transport.send({
        type:'command',
        protocol:1,
        command_id:uid(),
        session_id:this.state.frame?.session_id??uid(),
        action,
        settings,
        ...(includeRaw?{raw_record:Boolean(this.state.rawRecordingEnabled)}:{}),
      });
      if(token!==this.requestToken)return false;
      this.update({diagnostics:{...this.state.diagnostics,command_rtt_ms:performance.now()-sentAt}});
      this.accept(ack.snapshot);if(!ack.accepted)throw new Error(ack.message??'Thiết bị từ chối lệnh.');
      // ACK may be older than a stream packet. Never roll the display backwards.
      await this.flush();return true;
    }catch(e){if(token===this.requestToken)this.update({error:(e as Error).message});return false;
    }finally{if(token===this.requestToken)this.update({pending:null});}
  }
  clearError(){this.update({error:null});}
  disconnect(){this.connectToken++;this.flushRawChunks();this.transport?.disconnect();this.update({live:false,connection:'disconnected'});}
  destroy(){this.connectToken++;this.flushRawChunks();this.off.forEach(f=>f());this.transport?.disconnect();if(this.watchdog)clearInterval(this.watchdog);}
}
