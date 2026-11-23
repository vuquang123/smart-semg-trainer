import { ackSchema,pongSchema,uid,type Ack,type Command,type Connection,type Frame,type RawBatchPacket } from '../core/protocol';
import { ClockSync,type LinkTiming } from '../core/clockSync';
import { DEFAULT_TINYJAMBU_KEY_HEX,EMG_WS_AEAD_AD_C2S,EMG_WS_AEAD_AD_S2C,decryptWsEnvelope,encryptWsEnvelope,parseTinyJambuKey } from '../core/tinyjambu';
import { mapFirmwarePacket,mapFirmwareRawBatch,firmwareCommand,firmwareMessage,rememberFirmwareSettings,validateWebSocketUrl } from './firmwareMapper';
import type { Transport } from './types';
const withAeadCap=(f:Frame):Frame=>({...f,capabilities:f.capabilities?.includes('tinyjambu_128_aead')?f.capabilities:[...(f.capabilities??[]),'tinyjambu_128_aead']});
export class WebSocketTransport implements Transport {
  kind='websocket' as const;private socket?:WebSocket;private ready=false;private clock=new ClockSync();private boot:string|null=null;
  private lastFrame:Frame|null=null;private key:Uint8Array;private noncePrefix:number;private txCounter=0n;
  private connecting:Promise<void>|null=null;private abortConnect:(()=>void)|null=null;
  private timing:LinkTiming={rtt_ms:null,sample_age_ms:null,uncertainty_ms:null};private probeTimer?:ReturnType<typeof setInterval>;private probes=new Map<string,number>();
  private frames=new Set<(f:Frame)=>void>();private rawHandlers=new Set<(b:RawBatchPacket)=>void>();private connections=new Set<(s:Connection)=>void>();
  private pending=new Map<string,{resolve:(a:Ack)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;action?:Command['action']}>();
  constructor(private url:string,keyInput:string=DEFAULT_TINYJAMBU_KEY_HEX){
    this.key=parseTinyJambuKey(keyInput);
    const b=new Uint32Array(1);globalThis.crypto.getRandomValues(b);this.noncePrefix=b[0]!;
  }
  private sendEncrypted(payload:unknown){
    if(this.socket?.readyState!==WebSocket.OPEN)return;
    this.socket.send(encryptWsEnvelope(JSON.stringify(payload),this.key,this.noncePrefix,++this.txCounter,EMG_WS_AEAD_AD_C2S));
  }
  onFrame(h:(f:Frame)=>void){this.frames.add(h);return ()=>{this.frames.delete(h);};}
  onRawBatch(h:(b:RawBatchPacket)=>void){this.rawHandlers.add(h);return ()=>{this.rawHandlers.delete(h);};}
  onConnection(h:(s:Connection)=>void){this.connections.add(h);return ()=>{this.connections.delete(h);};}
  getDiagnostics(){return {...this.timing};}
  private status(s:Connection){this.connections.forEach(h=>h(s));}
  private observe(f:Frame){
    this.lastFrame=f;
    if(this.boot!==f.boot_id){this.clock.reset();this.boot=f.boot_id;}
    this.timing=this.clock.timing(performance.now(),f.sampled_at_device_ms);
    if(this.ready&&f.capabilities?.includes('timing_v1')&&!this.probeTimer){this.probe();this.probeTimer=setInterval(()=>this.probe(),5000);}
  }
  private probe(){
    if(this.socket?.readyState!==WebSocket.OPEN)return;
    const now=performance.now();for(const [key,sent] of this.probes)if(now-sent>10000)this.probes.delete(key);
    const id=uid();this.probes.set(id,now);this.sendEncrypted({type:'ping',protocol:1,ping_id:id});
  }
  private stopProbes(){if(this.probeTimer)clearInterval(this.probeTimer);this.probeTimer=undefined;this.probes.clear();}
  private teardown(){
    this.abortConnect?.();this.abortConnect=null;this.stopProbes();this.ready=false;this.lastFrame=null;this.clock.reset();this.boot=null;this.timing={rtt_ms:null,sample_age_ms:null,uncertainty_ms:null};
    if(this.socket){this.socket.onopen=null;this.socket.onmessage=null;this.socket.onerror=null;this.socket.onclose=null;this.socket.close();this.socket=undefined;}
    this.pending.forEach(p=>{clearTimeout(p.timer);p.reject(new Error('Kết nối đã thay đổi, chưa xác nhận lệnh.'));});this.pending.clear();
  }
  connect():Promise<void>{
    if(this.connecting)return this.connecting;
    const promise=this.open();this.connecting=promise;
    void promise.then(()=>{if(this.connecting===promise)this.connecting=null;},()=>{if(this.connecting===promise)this.connecting=null;});return promise;
  }
  private open():Promise<void>{
    const url=validateWebSocketUrl(this.url);this.teardown();this.status('connecting');
    return new Promise((resolve,reject)=>{
      const ws=new WebSocket(url);this.socket=ws;
      let handshakeTimer:ReturnType<typeof setTimeout>|undefined;
      const clearTimers=()=>{clearTimeout(timeout);if(handshakeTimer)clearTimeout(handshakeTimer);};
      const timeout=setTimeout(()=>{this.abortConnect=null;if(handshakeTimer)clearTimeout(handshakeTimer);ws.close();reject(new Error('Thiết bị chưa phản hồi kết nối.'));},9000);
      this.abortConnect=()=>{clearTimers();reject(new Error('Đã hủy kết nối trước đó.'));};
      const completeOpen=(snapshot:Frame)=>{
        if(this.ready)return;
        this.ready=true;clearTimers();this.abortConnect=null;
        this.observe(snapshot);this.status('connected');this.frames.forEach(h=>h({...snapshot,cause:'state'}));resolve();
      };
      ws.onopen=()=>{
        // Wait briefly for spontaneous broadcast snapshot (e.g. ESP32 200ms push); fallback to explicit get_state.
        handshakeTimer=setTimeout(async()=>{
          if(this.ready||ws.readyState!==WebSocket.OPEN)return;
          try{const ack=await this.send({type:'command',protocol:1,command_id:uid(),session_id:uid(),action:'get_state'});
            if(!ack.accepted)throw new Error(ack.message??'Không lấy được trạng thái.');
            completeOpen(ack.snapshot);
          }catch(e){if(!this.ready){clearTimers();this.abortConnect=null;ws.close();reject(e);}}
        },2500);
      };
      ws.onmessage=e=>{
        try{
          if(typeof e.data!=='string'||e.data.length>500000)return;
          let plainText:string;
          try{
            plainText=decryptWsEnvelope(e.data,this.key,EMG_WS_AEAD_AD_S2C);
          }catch(err){
            if(!this.ready){clearTimers();this.abortConnect=null;ws.close();reject(err instanceof Error?err:new Error('Xác thực TinyJAMBU-128 AEAD thất bại.'));}
            return;
          }
          const data:unknown=JSON.parse(plainText);const pong=pongSchema.safeParse(data);
          if(pong.success){const sent=this.probes.get(pong.data.ping_id);if(sent!=null){this.clock.observe(sent,pong.data.device_rx_ms,pong.data.device_tx_ms,performance.now());this.probes.delete(pong.data.ping_id);}return;}
          if(data&&typeof data==='object'&&(data as Record<string,unknown>).type==='raw_batch'){
            if(this.ready){const batch=mapFirmwareRawBatch(data);if(batch)this.rawHandlers.forEach(h=>h(batch));}
            return;
          }
          if(data&&typeof data==='object'&&(data as Record<string,unknown>).type==='ack'&&'snapshot' in data){
            const rawAck=data as Record<string,unknown>;
            const mappedSnap=withAeadCap(mapFirmwarePacket(rawAck.snapshot));
            if(mappedSnap.capabilities?.includes('semg_v2')&&typeof rawAck.message==='string')rawAck.message=firmwareMessage(rawAck.message);
            const ack=ackSchema.safeParse({...rawAck,snapshot:mappedSnap});
            if(ack.success){this.observe(ack.data.snapshot);const p=this.pending.get(ack.data.command_id);if(p){clearTimeout(p.timer);this.pending.delete(ack.data.command_id);p.resolve(ack.data);}return;}
          }
          const f=withAeadCap(mapFirmwarePacket(data));
          if(!this.ready){completeOpen(f);return;}
          this.observe(f);
          for(const [cmdId,p] of this.pending){
            if(p.action==='get_state'){clearTimeout(p.timer);this.pending.delete(cmdId);p.resolve({type:'ack',protocol:1,command_id:cmdId,accepted:true,snapshot:{...f,cause:'state'}});}
          }
          this.frames.forEach(h=>h(f));
        }catch{/* Malformed packets never change state; the watchdog detects a stalled stream. */}
      };
      ws.onerror=()=>{clearTimers();this.abortConnect=null;reject(new Error('Không kết nối được. Kiểm tra cùng mạng, địa chỉ và chứng chỉ.'));};
      ws.onclose=()=>{clearTimers();this.abortConnect=null;this.stopProbes();this.ready=false;this.status('lost');this.pending.forEach(p=>{clearTimeout(p.timer);p.reject(new Error('Mất kết nối, chưa xác nhận trạng thái thiết bị.'));});this.pending.clear();reject(new Error('Kết nối đã đóng.'));};
    });
  }
  send(c:Command):Promise<Ack>{
    return new Promise((resolve,reject)=>{
      if(this.socket?.readyState!==WebSocket.OPEN){reject(new Error('Chưa kết nối thiết bị.'));return;}
      rememberFirmwareSettings(c.settings);
      const timer=setTimeout(()=>{this.pending.delete(c.command_id);reject(new Error('Chưa nhận được xác nhận. Hãy lấy lại trạng thái.'));},6000);
      this.pending.set(c.command_id,{resolve,reject,timer,action:c.action});
      this.sendEncrypted(firmwareCommand(c,this.lastFrame));
    });
  }
  disconnect(){this.teardown();this.status('disconnected');}
}
