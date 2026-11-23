import { useEffect,useRef,type ReactNode } from 'react';
import { X,CheckCircle2,Cloud,HardDrive,CloudOff } from 'lucide-react';
import type { SessionRecord } from '../core/protocol';
export const duration=(ms:number)=>`${Math.floor(ms/60000).toString().padStart(2,'0')}:${Math.floor(ms/1000%60).toString().padStart(2,'0')}`;
export const localDate=(iso:string)=>new Date(iso).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
export function SaveBadge({status='local'}:{status?:SessionRecord['sync']}){
  return <span className={`save-badge ${status}`}>{status==='synced'?<Cloud size={14}/>:status==='pending'?<CloudOff size={14}/>:<HardDrive size={14}/>} {status==='synced'?'Đã đồng bộ':status==='pending'?'Chờ đồng bộ':'Đã lưu trên máy'}</span>;
}
export function Modal({title,children,onClose,wide=false,variant='modal'}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean;variant?:'modal'|'sheet'}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const el=ref.current;el?.showModal();return ()=>el?.close();},[]);
  return <dialog ref={ref} className={`modal ${wide?'modal-wide':''} ${variant==='sheet'?'modal-sheet':''}`} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal-header"><h2>{title}</h2><button autoFocus className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20}/></button></div>{children}</dialog>;
}
export function CheckItem({children}:{children:ReactNode}){return <li><CheckCircle2 size={17}/><span>{children}</span></li>;}
