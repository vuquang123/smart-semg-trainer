import { useCallback,useEffect,useState } from 'react';
import { AudioFeedback,CuePlanner,defaultAudio,type AudioPreferences } from '../core/audio';
import type { Frame } from '../core/protocol';
const read=():AudioPreferences=>{try{const p=JSON.parse(localStorage.getItem('semg-audio')??'null');return p&&['off','beep','voice'].includes(p.mode)?{mode:p.mode,volume:Math.min(1,Math.max(0,Number.isFinite(p.volume)?p.volume:.3)),countdown:!!p.countdown}:defaultAudio;}catch{return defaultAudio;}};
export function useAudioFeedback(frame:Frame|null,live:boolean,estimatedAge?:number|null){
  const [service]=useState(()=>new AudioFeedback());const [planner]=useState(()=>new CuePlanner());
  const [preferences,setPreferences]=useState(read);const [countdown,setCountdown]=useState<number|null>(null);const [message,setMessage]=useState('');
  useEffect(()=>{service.setPreferences(preferences);try{localStorage.setItem('semg-audio',JSON.stringify(preferences));}catch{}},[preferences,service]);
  useEffect(()=>{
    const visible=document.visibilityState==='visible';
    const measuring=frame?.state==='training'||frame?.state==='calibrating';
    const fresh=live&&visible&&(!measuring||estimatedAge==null||estimatedAge<=500);
    if(!fresh){service.cancel();planner.reset();return;}
    if(frame){const cue=planner.next(frame,true);if(cue)service.cue(cue);}
  },[frame,live,estimatedAge,planner,service]);
  useEffect(()=>{const hide=()=>{if(document.visibilityState!=='visible'){service.cancel();planner.reset();}};document.addEventListener('visibilitychange',hide);return ()=>{document.removeEventListener('visibilitychange',hide);service.destroy();};},[service,planner]);
  const change=useCallback((next:AudioPreferences)=>{service.setPreferences(next);setPreferences(next);if(next.mode!=='off')void service.unlock().then(ok=>{setMessage(ok?'':'Hãy thử âm thanh. Trình duyệt có thể đang chặn phát âm.');});},[service]);
  const unlock=useCallback(()=>{void service.unlock().then(ok=>{if(!ok)setMessage('Chưa bật được âm thanh. Mở tùy chọn và nhấn Thử âm thanh.');});},[service]);
  const test=useCallback(()=>{void service.unlock().then(ok=>{service.test();setMessage(ok?'Nếu không nghe thấy, hãy kiểm tra âm lượng thiết bị.':'Trình duyệt chưa cho phát âm. Kiểm tra âm lượng và thử lại bằng nút này.');});},[service]);
  const prepare=useCallback(()=>service.prepare(setCountdown),[service]);
  const cancel=useCallback(()=>service.cancel(),[service]);
  return {preferences,change,unlock,test,prepare,cancel,countdown,message};
}
