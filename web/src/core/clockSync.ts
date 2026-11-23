export type LinkTiming={rtt_ms:number|null;sample_age_ms:number|null;uncertainty_ms:number|null};
export class ClockSync {
  private latestRtt:number|null=null;
  private best:{offset:number;rtt:number;received:number}|null=null;
  reset(){this.best=null;this.latestRtt=null;}
  observe(clientSent:number,deviceReceived:number,deviceSent:number,clientReceived:number):boolean{
    if(![clientSent,deviceReceived,deviceSent,clientReceived].every(Number.isFinite)||clientReceived<clientSent||deviceSent<deviceReceived)return false;
    const rtt=clientReceived-clientSent-(deviceSent-deviceReceived);if(rtt<0||rtt>10000)return false;
    this.latestRtt=rtt;
    const offset=((deviceReceived-clientSent)+(deviceSent-clientReceived))/2;
    if(!this.best || clientReceived-this.best.received>30000 || rtt<=this.best.rtt)this.best={offset,rtt,received:clientReceived};return true;
  }
  timing(received:number,sampledAt?:number):LinkTiming{
    if(!this.best||received-this.best.received>60000)return {rtt_ms:null,sample_age_ms:null,uncertainty_ms:null};
    const age=sampledAt==null?null:received-(sampledAt-this.best.offset);
    return {rtt_ms:this.latestRtt,sample_age_ms:age==null||age < -Math.max(this.best.rtt,this.latestRtt??0)/2?null:Math.max(0,age),uncertainty_ms:Math.max(this.best.rtt,this.latestRtt??0)/2};
  }
}
