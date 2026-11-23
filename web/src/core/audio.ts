import type { Frame } from './protocol';
export type AudioMode='off'|'beep'|'voice';
export type AudioPreferences={mode:AudioMode;volume:number;countdown:boolean};
export type Cue='calibrate'|'start'|'contract'|'relax'|'valid'|'short'|'complete'|'stop'|'below'|'inside'|'above'|'zone_short';
export const defaultAudio:AudioPreferences={mode:'off',volume:.3,countdown:false};
const words:Record<Cue,string>={calibrate:'Thả lỏng để hiệu chuẩn',start:'Bắt đầu',contract:'Co',relax:'Thả',valid:'Đạt',short:'Giữ chưa đủ',complete:'Hoàn thành',stop:'Đã dừng',below:'Tăng mức co',inside:'Giữ mức này',above:'Giảm mức co',zone_short:'Chưa giữ đủ trong vùng'};
export class CuePlanner {
  private previous:Frame|null=null;
  reset(){this.previous=null;}
  next(f:Frame,live:boolean):Cue|null {
    const p=this.previous;
    if(!live){this.reset();return null;}
    if(p&&p.session_id===f.session_id&&p.boot_id===f.boot_id&&f.sequence<=p.sequence)return null;
    this.previous=f;
    if(!p || p.session_id!==f.session_id || p.boot_id!==f.boot_id)return null;
    if(f.state==='completed'&&p.state!=='completed')return 'complete';
    if(f.state==='stopped'&&p.state!=='stopped')return 'stop';
    if(f.state==='calibrating'&&p.state!=='calibrating')return 'calibrate';
    if(f.state!=='training'||f.paused)return null;
    if(p.state!=='training'||p.paused)return 'start';
    if(f.total_count>p.total_count)return f.repetitions.at(-1)?.valid?'valid':f.settings.zone_enabled?'zone_short':'short';
    if(f.settings.zone_enabled && f.settings.mode!=='free' && f.current_hold_ms>0 && f.phase!=='release' && f.target_zone && f.target_zone!=='unavailable' && (f.target_zone!==p.target_zone||p.current_hold_ms===0))return f.target_zone;
    const group=(v:Frame)=>v.phase==='contract'||v.phase==='hold'?'contract':'relax';
    return group(f)!==group(p)?group(f):null;
  }
}
export class AudioFeedback {
  preferences:AudioPreferences={...defaultAudio};private context:AudioContext|null=null;
  private nodes=new Set<OscillatorNode>();private timer:ReturnType<typeof setTimeout>|null=null;private cancelPreparation:(()=>void)|null=null;
  private lastCueAt=-Infinity;private voice:SpeechSynthesisVoice|undefined;
  setPreferences(p:AudioPreferences){this.preferences={...p,volume:Math.min(1,Math.max(0,p.volume))};if(p.mode==='off')this.cancel();}
  async unlock():Promise<boolean>{
    if(this.preferences.mode==='off')return true;
    try{
      const Constructor=globalThis.AudioContext??(globalThis as typeof globalThis&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
      if(Constructor){this.context??=new Constructor();if(this.context.state==='suspended')await this.context.resume();}
      if(typeof speechSynthesis!=='undefined')this.voice=speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith('vi'));
      return this.context?.state==='running'||this.preferences.mode==='voice'&&!!this.voice;
    }catch{return false;}
  }
  private beep(frequency=700,length=.09,offset=0){
    const ctx=this.context;if(!ctx || ctx.state!=='running'||this.preferences.mode==='off'||this.preferences.volume<=0)return;
    const osc=ctx.createOscillator(),gain=ctx.createGain(),t=ctx.currentTime+offset;
    osc.type='sine';osc.frequency.value=frequency;
    gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(this.preferences.volume*.25,t+.012);gain.gain.exponentialRampToValueAtTime(.0001,t+length);
    osc.connect(gain);gain.connect(ctx.destination);this.nodes.add(osc);osc.onended=()=>{this.nodes.delete(osc);osc.disconnect();gain.disconnect();};osc.start(t);osc.stop(t+length+.02);
  }
  private speak(text:string):boolean{
    if(this.preferences.mode!=='voice'||typeof speechSynthesis==='undefined')return false;
    this.voice=speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith('vi'));
    if(!this.voice)return false;
    speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='vi-VN';utterance.voice=this.voice;utterance.rate=1.1;utterance.volume=this.preferences.volume;
    utterance.onerror=e=>{if(!['canceled','interrupted'].includes(e.error))this.beep();};speechSynthesis.speak(utterance);return true;
  }
  cue(cue:Cue){
    if(this.preferences.mode==='off')return;
    const now=performance.now();if(now-this.lastCueAt<250 && !['stop','complete'].includes(cue))return;this.lastCueAt=now;
    if(this.speak(words[cue]))return;
    this.beep(cue==='contract'?880:cue==='relax'||cue==='stop'?440:660);
    if(cue==='valid'||cue==='complete')this.beep(990,.1,.14);
  }
  test(){if(!this.speak('Co. Thả.')){this.beep(880);this.beep(440,.1,.3);}}
  prepare(onStep:(step:number|null)=>void):Promise<boolean>{
    this.cancel();
    if(!this.preferences.countdown||this.preferences.mode==='off')return Promise.resolve(true);
    return new Promise(resolve=>{
      let remaining=3;let done=false;
      const finish=(ok:boolean)=>{if(done)return;done=true;if(this.timer)clearTimeout(this.timer);this.timer=null;this.cancelPreparation=null;onStep(null);resolve(ok);};
      this.cancelPreparation=()=>finish(false);
      const tick=()=>{if(remaining===0){finish(true);return;}onStep(remaining);if(!this.speak(String(remaining)))this.beep(remaining===1?880:660);remaining--;this.timer=setTimeout(tick,1000);};tick();
    });
  }
  cancel(){if(this.timer)clearTimeout(this.timer);this.timer=null;this.cancelPreparation?.();this.cancelPreparation=null;this.nodes.forEach(node=>{try{node.stop();}catch{/* Already ended. */}});this.nodes.clear();if(typeof speechSynthesis!=='undefined')speechSynthesis.cancel();}
  destroy(){this.cancel();void this.context?.close();}
}
