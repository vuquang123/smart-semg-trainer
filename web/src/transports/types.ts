import type { LinkTiming } from '../core/clockSync';
import type { Ack, Command, Connection, Frame, RawBatchPacket } from '../core/protocol';
export interface Transport {
  kind:'mock'|'websocket'; connect():Promise<void>; disconnect():void;
  send(command:Command):Promise<Ack>;
  getDiagnostics?():LinkTiming;
  onFrame(handler:(frame:Frame)=>void):()=>void;
  onRawBatch?(handler:(batch:RawBatchPacket)=>void):()=>void;
  onConnection(handler:(state:Connection)=>void):()=>void;
}
