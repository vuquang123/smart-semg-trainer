import type { SessionRecord } from '../core/protocol';
const csvCell=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';
export function exportCsv(r:SessionRecord):string {
  const f=r.snapshot;
  return '\uFEFF'+[
    ['session_id','source','unit','time_ms','rms','contract_threshold','relax_threshold','activation_pct','target_zone'],
    ...r.samples.map(s=>[r.id,f.source,f.unit,s.t_ms,s.rms,s.on_threshold,s.off_threshold,s.activation_pct,s.target_zone]),
    [],['reference_rms','zone_enabled','zone_low_pct','zone_high_pct','started_at_estimated'],
    [f.settings.reference_rms,f.settings.zone_enabled??false,f.settings.zone_low_pct,f.settings.zone_high_pct,f.started_at_estimated??false],
    [],['repetition_id','ordinal','ended_ms','hold_ms','valid','rest_ms','longest_in_zone_ms'],
    ...f.repetitions.map(rep=>[rep.id,rep.ordinal,rep.ended_ms,rep.hold_ms,rep.valid,rep.rest_ms,rep.in_zone_ms]),
  ].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export function triggerBrowserDownload(bytes: Uint8Array, filename: string, mimeType: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export function downloadSession(r:SessionRecord,format:'json'|'csv'){
  const data=format==='json'?JSON.stringify({export_version:1,...r},null,2):exportCsv(r);
  const blob=new Blob([data],{type:format==='json'?'application/json;charset=utf-8':'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`semg_${r.snapshot.started_at.slice(0,10)}_${r.id.slice(0,8)}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function exportSessionsCsv(records:SessionRecord[]):string {
  return '\uFEFF'+[
    ['session_id','started_at','mode','channel','muscle','valid_count','total_count','target','min_hold_ms','duration_ms','state','source','unit','reference_rms','zone_enabled'],
    ...records.map(r=>{
      const f=r.snapshot;
      return [r.id,f.started_at,f.settings.mode??'training',`CH${f.selected_channel}`,f.settings.muscle,f.valid_count,f.total_count,f.settings.target,f.settings.min_hold_ms,f.duration_ms,f.state,f.source,f.unit,f.settings.reference_rms??'',f.settings.zone_enabled??false];
    }),
  ].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export function downloadSessions(records:SessionRecord[],format:'json'|'csv',scope:'all'|'filtered'='all'){
  if(!records.length)return;
  const date=new Date().toISOString().slice(0,10);
  const data=format==='json'
    ?JSON.stringify({export_version:1,scope,exported_at:new Date().toISOString(),count:records.length,sessions:records},null,2)
    :exportSessionsCsv(records);
  const blob=new Blob([data],{type:format==='json'?'application/json;charset=utf-8':'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`semg_lich_su_${scope}_${records.length}_buoi_${date}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
