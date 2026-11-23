import type { Frame,Settings } from '../core/protocol';
type Props={muscle:Settings['muscle'];phase?:Frame['phase'];state?:Frame['state'];paused?:boolean;connected?:boolean};
/** Stylized continuous human arm guide (shoulder, upper arm, elbow, forearm, wrist, hand) synchronized with live contraction/calibration state. */
export function MuscleIllustration({muscle,phase='relax',state='idle',paused=false,connected=true}:Props){
  const contracting=connected&&state==='training'&&!paused&&(phase==='contract'||phase==='hold');
  const calibrating=connected&&state==='calibrating';
  const label=muscle==='forearm'?'Cẳng tay':'Bắp tay';
  const statusText=!connected?'Chưa xác nhận':calibrating?'Thả lỏng hiệu chuẩn':paused?'Tạm dừng':contracting?'Đang co cơ':'Thả lỏng';
  return <figure className={`muscle-illustration ${contracting?'is-contracting':'is-relaxed'} ${calibrating?'is-calibrating':''}`} aria-label={`Minh họa ${label.toLowerCase()}: ${statusText.toLowerCase()}`}>
    <svg viewBox="0 0 200 150" role="img" aria-hidden="true">
      <ellipse cx="102" cy="138" rx="68" ry="7" fill="#dfe9dc" opacity=".55"/>
      <path className="arm-outline" d="M18 76C18 62 30 54 42 59C45 61 47 66 49 69C59 61 79 62 92 78C96 83 99 88 101 91C107 73 120 58 139 48L145 44C141 37 139 30 143 26C146 23 151 26 152 32C155 21 163 17 170 20C177 23 180 32 176 41C172 48 166 52 159 55C148 76 135 97 121 114C114 123 105 127 94 125C73 121 50 115 31 107C21 102 18 90 18 76Z"/>
      <path className="arm-landmarks" d="M49 69C46 80 40 90 32 96M95 89Q102 94 109 90M101 119Q108 121 114 115M145 44Q152 49 159 55M152 32C154 37 156 41 154 45M159 24C166 26 171 31 172 37M156 30C162 32 166 36 167 41" fill="none" stroke="#9bb29d" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
      {muscle==='forearm'?<g className="muscle-group">
        <ellipse className="muscle-glow" cx="126" cy="79" rx="26" ry="15" transform="rotate(-38 126 79)"/>
        <path className="muscle-highlight" d="M104 92C109 76 121 62 139 51C144 48 150 53 148 59C141 75 130 93 117 105C110 110 102 101 104 92Z"/>
        <path className="muscle-core" d="M110 90C114 78 124 67 136 58C140 56 144 60 142 64C137 76 127 89 117 98C112 101 108 96 110 90Z"/>
        <path className="muscle-fiber" d="M109 90C115 78 125 66 139 56M113 95C121 83 131 71 143 60M117 99C125 88 134 77 144 65"/>
        <circle className="muscle-ring" cx="126" cy="79" r="26" fill="none" stroke="#3c8a63" strokeDasharray="3.5 4.5" strokeWidth="1.25" opacity={contracting?.75:.28}/>
      </g>:<g className="muscle-group">
        <ellipse className="muscle-glow" cx="70" cy="86" rx="26" ry="15" transform="rotate(14 70 86)"/>
        <path className="muscle-highlight" d="M47 76C57 65 79 66 93 83C97 88 94 97 86 100C71 104 54 99 46 89C43 85 43 79 47 76Z"/>
        <path className="muscle-core" d="M53 79C61 72 77 73 87 84C89 87 86 93 80 95C69 98 57 94 51 87C49 84 50 81 53 79Z"/>
        <path className="muscle-fiber" d="M51 81C63 73 78 74 89 86M50 87C63 81 77 82 87 91M55 92C66 89 76 90 83 95"/>
        <circle className="muscle-ring" cx="70" cy="86" r="26" fill="none" stroke="#3c8a63" strokeDasharray="3.5 4.5" strokeWidth="1.25" opacity={contracting?.75:.28}/>
      </g>}
    </svg>
    <figcaption><strong>{label}</strong><span>{statusText}</span></figcaption>
  </figure>;
}
