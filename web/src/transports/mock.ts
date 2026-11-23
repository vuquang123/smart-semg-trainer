import { SimulationEngine } from '../core/engine';
import type { Ack,Command,Connection,Frame,RawBatchPacket,Settings } from '../core/protocol';
import type { Transport } from './types';
export class MockTransport implements Transport {
  kind='mock' as const;engine:SimulationEngine;
  constructor(channels:1|2=1,settings?:Settings){this.engine=new SimulationEngine(settings,channels);}
  delay=160; dropNextAck=false; rejectNextCommand=false; private connected=false;private timer?:ReturnType<typeof setInterval>;private last=0;
  private frames=new Set<(f:Frame)=>void>();private connections=new Set<(s:Connection)=>void>();
  onFrame(h:(f:Frame)=>void){this.frames.add(h);return ()=>{this.frames.delete(h);};}
  onRawBatch(h:(b:RawBatchPacket)=>void){return this.engine.onRawBatch(b=>{if(this.connected)h(b);});}
  onConnection(h:(s:Connection)=>void){this.connections.add(h);return ()=>{this.connections.delete(h);};}
  private emit(f:Frame){if(this.connected)this.frames.forEach(h=>h(f));}
  private status(s:Connection){this.connections.forEach(h=>h(s));}
  async connect(){
    this.status('connecting');await new Promise(r=>setTimeout(r,120));if(this.timer){const now=Date.now();this.engine.advance(now-this.last);this.last=now;}this.connected=true;this.status('connected');this.emit(this.engine.snapshot('state'));
    if(!this.timer){this.last=Date.now();this.timer=setInterval(()=>{const now=Date.now();const f=this.engine.advance(now-this.last);this.last=now;this.emit(f);},100);}
  }
  disconnect(){this.connected=false;this.status('disconnected');if(this.timer)clearInterval(this.timer);this.timer=undefined;}
  loseConnection(){this.connected=false;this.status('lost');} // virtual device keeps running.
  async send(c:Command):Promise<Ack>{
    if(!this.connected)throw new Error('Chưa kết nối thiết bị.');
    const drop=this.dropNextAck;this.dropNextAck=false;
    const rejectCmd=this.rejectNextCommand;this.rejectNextCommand=false;
    await new Promise(r=>setTimeout(r,this.delay));
    if(!this.connected)throw new Error('Mất kết nối khi gửi lệnh.');
    if(rejectCmd){
      const snap=this.engine.snapshot('command');
      return {type:'ack',protocol:1,command_id:c.command_id,accepted:false,message:'Thiết bị từ chối đổi kênh.',snapshot:snap};
    }
    const ack=this.engine.execute(c);if(!drop)this.emit(ack.snapshot);
    if(drop) return new Promise((_,reject)=>setTimeout(()=>reject(new Error('Chưa nhận được xác nhận. Hãy kiểm tra trạng thái thiết bị.')),6000));
    return ack;
  }
  destroy(){this.disconnect();this.frames.clear();this.connections.clear();}
}
