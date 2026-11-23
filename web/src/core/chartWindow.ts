export type TimeWindow={start:number;end:number};
export function clampWindow(range:TimeWindow,extent:TimeWindow,minSpan=1):TimeWindow {
  const size=Math.max(0,extent.end-extent.start);
  if(size===0)return {...extent};
  const span=Math.min(size,Math.max(Math.min(minSpan,size),range.end-range.start));
  const start=Math.min(extent.end-span,Math.max(extent.start,Number.isFinite(range.start)?range.start:extent.start));
  return {start,end:start+span};
}
export function zoomWindow(range:TimeWindow,factor:number,extent:TimeWindow,anchor=(range.start+range.end)/2):TimeWindow {
  const span=range.end-range.start;
  const ratio=span>0?(anchor-range.start)/span:.5;
  const size=extent.end-extent.start;const target=Math.min(size,Math.max(Math.min(1,size),span*Math.max(.01,factor))); 
  return clampWindow({start:anchor-ratio*target,end:anchor+(1-ratio)*target},extent);
}
export const panWindow=(range:TimeWindow,delta:number,extent:TimeWindow)=>clampWindow({start:range.start+delta,end:range.end+delta},extent);
export const timeLabel=(seconds:number)=>seconds.toLocaleString('vi-VN',{maximumFractionDigits:1})+' s';
