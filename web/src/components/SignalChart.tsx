import { useEffect,useId,useMemo,useRef,useState,type PointerEvent } from 'react';
import { Area,ReferenceArea,CartesianGrid,ComposedChart,Line,ResponsiveContainer,Tooltip,XAxis,YAxis } from 'recharts';
import { Activity,Maximize2,MoveHorizontal,RotateCcw,X,ZoomIn,ZoomOut } from 'lucide-react';
import type { Frame,Sample } from '../core/protocol';
import { clampWindow,panWindow,timeLabel,zoomWindow,type TimeWindow } from '../core/chartWindow';
type Point={x:number;y:number};
type Gesture={range:TimeWindow;x:number;distance:number;anchor:number;width:number};
export function SignalChart({samples,frame,live=false,history=false,delayed=false,focusRange}:{samples:Sample[];frame:Frame|null;live?:boolean;history?:boolean;delayed?:boolean;focusRange?:TimeWindow|null}){
  const dialog=useRef<HTMLDialogElement>(null);const gradient=useId().replaceAll(':','');
  const [seconds,setSeconds]=useState(30);const [expanded,setExpanded]=useState(false);const [selection,setSelection]=useState<TimeWindow|null>(null);const [dragMode,setDragMode]=useState(false);
  const pointers=useRef(new Map<number,Point>());const gesture=useRef<Gesture|null>(null);
  const extent={start:(samples[0]?.t_ms??0)/1000,end:(samples.at(-1)?.t_ms??0)/1000};
  const bounds=history?clampWindow(selection??extent,extent):{start:Math.max(0,extent.end-seconds),end:Math.max(extent.end,seconds)};
  const boundsRef=useRef(bounds);boundsRef.current=bounds;const extentRef=useRef(extent);extentRef.current=extent;
  useEffect(()=>{if(expanded)dialog.current?.showModal();},[expanded]);
  useEffect(()=>{setSelection(null);setDragMode(false);pointers.current.clear();gesture.current=null;},[frame?.session_id]);
  useEffect(()=>{if(focusRange)setSelection(clampWindow(focusRange,extentRef.current));},[focusRange]);
  const unit=frame?.unit==='uV'?'µV':frame?.unit??'µV';
  const data=useMemo(()=>samples.filter(s=>s.t_ms/1000>=bounds.start&&s.t_ms/1000<=bounds.end).map(s=>({s:s.t_ms/1000,rms:s.rms,on:s.on_threshold,off:s.off_threshold})),[samples,bounds.start,bounds.end]);
  const sim=!frame||frame.source==='simulation';const zone=frame?.settings.zone_enabled&&frame.settings.mode!=='free'&&frame.settings.reference_rms?{low:frame.settings.reference_rms*(frame.settings.zone_low_pct??40)/100,high:frame.settings.reference_rms*(frame.settings.zone_high_pct??70)/100}:null;const span=bounds.end-bounds.start;const fullSpan=extent.end-extent.start;const review=history&&fullSpan>0;
  const update=(next:TimeWindow)=>setSelection(clampWindow(next,extentRef.current));
  const beginGesture=(element:HTMLDivElement)=>{
    const values=[...pointers.current.values()];if(!values.length){gesture.current=null;return;}
    const rect=element.getBoundingClientRect(),center=values.reduce((s,p)=>s+p.x,0)/values.length;
    gesture.current={range:{...boundsRef.current},x:center,width:Math.max(1,rect.width),distance:values.length>1?Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y):0,anchor:boundsRef.current.start+Math.min(1,Math.max(0,(center-rect.left)/Math.max(1,rect.width)))*(boundsRef.current.end-boundsRef.current.start)};
  };
  const pointerDown=(e:PointerEvent<HTMLDivElement>)=>{if(!review||!dragMode)return;pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});e.currentTarget.setPointerCapture(e.pointerId);beginGesture(e.currentTarget);};
  const pointerMove=(e:PointerEvent<HTMLDivElement>)=>{
    if(!review||!dragMode||!pointers.current.has(e.pointerId)||!gesture.current)return;
    pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});const values=[...pointers.current.values()],g=gesture.current;
    const center=values.reduce((s,p)=>s+p.x,0)/values.length;
    if(values.length>1&&g.distance>0){const distance=Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y);const zoomed=zoomWindow(g.range,g.distance/Math.max(1,distance),extentRef.current,g.anchor);update(panWindow(zoomed,-(center-g.x)/g.width*(zoomed.end-zoomed.start),extentRef.current));}
    else update(panWindow(g.range,-(center-g.x)/g.width*(g.range.end-g.range.start),extentRef.current));
  };
  const pointerUp=(e:PointerEvent<HTMLDivElement>)=>{pointers.current.delete(e.pointerId);try{e.currentTarget.releasePointerCapture(e.pointerId);}catch{}beginGesture(e.currentTarget);};
  const body=<>
    <div className="card-heading chart-heading"><div><div className="eyebrow">{history?'XEM LẠI BUỔI TẬP':'QUAN SÁT TÍN HIỆU'}</div><h2>Mức hoạt động cơ <Activity size={17}/></h2></div><div className="chart-actions">{!history&&<div className="segmented tiny"><button aria-pressed={seconds===30} onClick={()=>setSeconds(30)}>30 giây</button><button aria-pressed={seconds===60} onClick={()=>setSeconds(60)}>60 giây</button></div>}<button className="icon-button" aria-label={expanded?'Đóng toàn màn hình':'Mở biểu đồ toàn màn hình'} onClick={()=>setExpanded(!expanded)}>{expanded?<X size={19}/>:<Maximize2 size={18}/>}</button></div></div>
    <div className="chart-meta"><span>{sim?'RMS mô phỏng':frame?.source==='replay'?'RMS phát lại':'RMS đã xử lý'} ({unit})</span><span className={delayed?'delayed-label':live?'live-label':'muted'}>{delayed?'Dữ liệu đến chậm':live?<><i/> Trực tiếp</>:history?'Dữ liệu đã lưu':samples.length?'Tạm ngưng cập nhật':'Chưa có dữ liệu'}</span></div>
    {review&&<div className="review-toolbar"><div className="review-tools"><button className="icon-button" aria-label="Phóng to biểu đồ" disabled={span<=Math.min(1,fullSpan)} onClick={()=>update(zoomWindow(bounds,.5,extent))}><ZoomIn size={18}/></button><button className="icon-button" aria-label="Thu nhỏ biểu đồ" disabled={span>=fullSpan} onClick={()=>update(zoomWindow(bounds,2,extent))}><ZoomOut size={18}/></button><button className="review-reset" onClick={()=>setSelection(null)}><RotateCcw size={14}/>Toàn phiên</button><button className="review-drag" aria-pressed={dragMode} onClick={()=>{setDragMode(!dragMode);pointers.current.clear();gesture.current=null;}}><MoveHorizontal size={16}/>{dragMode?'Kéo / chụm':'Chạm xem'}</button></div><div className="review-position"><span>{timeLabel(bounds.start)} – {timeLabel(bounds.end)}</span><label><span className="sr-only">Cuộn tới thời điểm trong buổi tập</span><input type="range" min={extent.start} max={Math.max(extent.start,extent.end-span)} step="0.1" value={bounds.start} disabled={span>=fullSpan} aria-valuetext={`${timeLabel(bounds.start)} đến ${timeLabel(bounds.end)}`} onChange={e=>update({start:Number(e.target.value),end:Number(e.target.value)+span})}/></label></div></div>}
    <div className={`chart-wrap ${review&&dragMode?'chart-pan-mode':''}`} role="group" aria-label={`Biểu đồ RMS theo thời gian tính bằng giây, đơn vị ${unit}. Vùng trống là khoảng thiếu dữ liệu.`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      {data.length?<ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{top:12,right:12,bottom:18,left:0}} accessibilityLayer>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#238c76" stopOpacity={.18}/><stop offset="100%" stopColor="#238c76" stopOpacity={.01}/></linearGradient></defs>
        <CartesianGrid stroke="#e8ede8" strokeDasharray="3 4" vertical={false}/>
        <XAxis dataKey="s" type="number" domain={[bounds.start,Math.max(bounds.end,bounds.start+.1)]} allowDataOverflow tickCount={5} tickFormatter={v=>Number(v).toLocaleString('vi-VN',{maximumFractionDigits:span<10?1:0})} tickLine={false} axisLine={false} stroke="#7a897b" fontSize={12} label={{value:'Thời gian (s)',position:'insideBottom',offset:-12,fontSize:12,fill:'#768472'}}/>
        <YAxis domain={[0,frame?.y_max??500]} allowDataOverflow tickCount={5} tickLine={false} axisLine={false} width={39} stroke="#7a897b" fontSize={12}/>
        {!(review&&dragMode)&&<Tooltip labelFormatter={v=>timeLabel(Number(v))} formatter={(v,n)=>[`${Number(v).toFixed(1)} ${unit}`,n==='rms'?'RMS':n==='on'?'Ngưỡng co':'Ngưỡng thả']} contentStyle={{border:'1px solid #dbe5dd',borderRadius:12,fontSize:13}}/>}
        {zone&&<ReferenceArea y1={zone.low} y2={zone.high} fill="#237d59" fillOpacity={.12} stroke="#237d59" strokeDasharray="3 4"/>}
        <Area dataKey="rms" type="linear" stroke="none" fill={`url(#${gradient})`} isAnimationActive={false} connectNulls={false}/>
        <Line dataKey="rms" type="linear" stroke="#258a73" strokeWidth={2.3} dot={false} activeDot={{r:4}} connectNulls={false} isAnimationActive={false}/>
        <Line dataKey="on" stroke="#ba913e" strokeDasharray="6 5" strokeWidth={1.4} dot={false} isAnimationActive={false}/>
        <Line dataKey="off" stroke="#8e9c92" strokeDasharray="4 5" strokeWidth={1.4} dot={false} isAnimationActive={false}/>
      </ComposedChart></ResponsiveContainer>:<div className="chart-empty"><Activity size={30}/><strong>{history?'Khoảng này không có mẫu RMS':'Tín hiệu sẽ xuất hiện tại đây'}</strong><span>{history?'Cuộn sang khoảng khác để xem dữ liệu đã lưu.':'Bắt đầu buổi tập để quan sát hoạt động cơ.'}</span></div>}
    </div>
    <div className="chart-legend">{zone&&<span><i className="legend-line zone"/>Vùng mục tiêu</span>}<span><i className="legend-line rms"/>RMS</span><span><i className="legend-line on"/>Ngưỡng co</span><span><i className="legend-line off"/>Ngưỡng thả</span></div>
    <p className="chart-note">RMS đã xử lý, không phải EMG thô. {review?dragMode?'Kéo một ngón để cuộn, chụm hai ngón để zoom; hoặc dùng các nút và thanh thời gian.':'Phóng to hoặc chọn một lượt để xem chi tiết. Chạm biểu đồ để xem giá trị.':data.length?'Chạm biểu đồ để xem giá trị.':'Thang Y cố định trong phiên.'}</p>
  </>;
  return <><section className="card signal-card">{!expanded&&body}</section>{expanded&&<dialog ref={dialog} className="chart-overlay" aria-label="Biểu đồ toàn màn hình" onCancel={()=>setExpanded(false)}>{body}</dialog>}</>;
}
