import { frameSchema, type Frame } from './protocol';
/** Retired sessions cannot resurrect; reconnect keeps this gate for the same adapter. */
export class PacketGate {
  private current?:Frame; private retired=new Set<string>();
  accept(input:unknown):Frame|null {
    const parsed=frameSchema.safeParse(input);if(!parsed.success)return null;
    const f=parsed.data, p=this.current;
    const key=(v:Frame)=>`${v.device_id}/${v.boot_id}/${v.session_id}`;
    if(this.retired.has(key(f)))return null;
    if(p && key(f)===key(p) && (f.sequence<=p.sequence || f.t_ms<p.t_ms))return null;
    if(p && key(f)!==key(p)){
      if(!['state','reset'].includes(f.cause))return null;
      this.retired.add(key(p));
    }
    this.current=f;return f;
  }
}
