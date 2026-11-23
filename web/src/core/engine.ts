import { defaults, isFreeMode, sameSettings, settingsSchema, uid, type Ack, type Command, type Frame, type RawBatchPacket, type Settings } from './protocol';
import { biofeedback } from './biofeedback';
/** Deterministic virtual ESP32. The UI never computes repetitions from RMS. */
export class SimulationEngine {
  frame:Frame;
  private trainingStart=0;
  private calibrationStart=0;
  private cycleStart=0;
  private contractionAt:number|null=null;
  private aboveAt:number|null=null;
  private belowAt:number|null=null;
  private restAt=0;
  private restBefore=0;
  private zoneSince:number|null=null;
  private zoneLongest=0;
  private remainder=0;
  private acks=new Map<string,Ack>();
  private rawRecording=false;
  private readonly simFsHz=1000;
  private sampleIndex=0;
  private rawRng=20261122;
  private activeRmsSum=0;
  private activeRmsPeak=0;
  private activeRmsCount=0;
  private rawHandlers=new Set<(batch:RawBatchPacket)=>void>();
  constructor(settings:Settings=defaults,private channelCount:1|2=1) { this.frame=this.fresh(settings); }
  onRawBatch(h:(batch:RawBatchPacket)=>void){this.rawHandlers.add(h);return ()=>{this.rawHandlers.delete(h);};}
  private activeChannel(){
    return this.frame.channels.find(c=>c.id===this.frame.selected_channel)??this.frame.channels[0]!;
  }
  private fresh(settings:Settings):Frame {
    const chCount:1|2=this.channelCount;
    const selectedChannel:1|2=chCount===1?1:settings.channel;
    const normalizedSettings:Settings={...settings,channel:selectedChannel};
    const channels=chCount===2
      ?[{id:1 as const,rms:28,filtered:0,on_threshold:140,off_threshold:85},{id:2 as const,rms:26,filtered:0,on_threshold:140,off_threshold:85}]
      :[{id:1 as const,rms:28,filtered:0,on_threshold:140,off_threshold:85}];
    this.sampleIndex=0;this.activeRmsSum=0;this.activeRmsPeak=0;this.activeRmsCount=0;
    return {
      type:'snapshot',protocol:1,device_id:'semg-demo-01',device_name:'sEMG Companion',
      firmware_version:'sim-1.2.0',
      boot_id:this.frame?.boot_id??uid(),session_id:uid(),sequence:0,cause:'reset',
      capabilities:['semg_v2','biofeedback_v1','rest_v1','raw_stream_v1'],
      started_at:new Date().toISOString(),t_ms:0,duration_ms:0,state:'idle',phase:'idle',paused:false,
      raw_recording:this.rawRecording,
      selected_channel:selectedChannel,channel_count:chCount,
      source:'simulation',fs_hz:this.simFsHz,signal_kind:'RAW',unit:'uV',y_max:500,
      dsp_config:{highpass_hz:null,lowpass_hz:null,notch_hz:null,notch_q:null,rms_ms:100,cal_ms:2500,settle_ms:0,on_ms:200,off_ms:200,on_factor:null,off_factor:null,on_sd:null,off_sd:null,dc_offset_ch1:null},
      adc_config:{resolution_bits:12,atten_db:null,hw_sample_rate_hz:this.simFsHz,oversampling_ratio:1,sampling_mode:chCount===2?'simulated_synchronous':'simulated_single_channel',gpio:null,analog_frontend:'Bộ mô phỏng trình duyệt (không qua mạch analog/ADC thật)',analog_gain:null,analog_bandpass_hz:null,clip_count:0},
      health:{discontinuities:0,tx_dropped:0,backlog_ticks:0,max_dsp_us:null,raw_dropped_samples:0,raw_overflow_events:0,tracking_supported:true},
      channels,settings:normalizedSettings,
      total_count:0,valid_count:0,current_hold_ms:0,last_hold_ms:0,calibration_progress:0,
      repetitions:[],active_contraction:null,incomplete_contraction:null,warning:null,error:null,
    };
  }
  restore(saved:Frame){
    if(saved.source!=='simulation')throw new Error('Chỉ khôi phục trạng thái mô phỏng.');
    this.frame=structuredClone(saved);
    if(this.channelCount===1 && (this.frame.channel_count!==1 || this.frame.selected_channel!==1)){
      const ch1=this.frame.channels.find(c=>c.id===1)??this.frame.channels[0]!;
      this.frame.channel_count=1;
      this.frame.selected_channel=1;
      this.frame.settings={...this.frame.settings,channel:1};
      this.frame.channels=[{...ch1,id:1}];
    }
    this.frame.cause='state';this.frame.sequence++;
    if(['training','calibrating'].includes(this.frame.state)){
      this.frame.state='stopped';this.frame.phase='idle';this.frame.paused=false;this.frame.current_hold_ms=0;
      this.frame.warning='Mô phỏng được dừng khi tải lại ứng dụng. Không tạo bù tín hiệu trong thời gian ứng dụng đóng.';
    }
    this.contractionAt=null;this.remainder=0;this.sampleIndex=Math.round(this.frame.t_ms*this.simFsHz/1000);
    this.activeRmsSum=0;this.activeRmsPeak=0;this.activeRmsCount=0;this.frame.active_contraction=null;
  }
  snapshot(cause:Frame['cause']='tick'):Frame {
    Object.assign(this.frame,biofeedback(this.activeChannel().rms,this.frame.settings));
    this.frame.sequence++; this.frame.cause=cause; return structuredClone(this.frame);
  }
  execute(c:Command):Ack {
    const cached=this.acks.get(c.command_id);if(cached)return structuredClone(cached);
    let error:string|undefined;
    const f=this.frame;
    if(c.action!=='get_state' && c.session_id!==f.session_id) error='Phiên đã thay đổi. Hãy lấy lại trạng thái.';
    else if(c.action==='reset') {
      if(['training','calibrating'].includes(f.state)) error='Hãy dừng buổi tập hiện tại trước khi thực hiện thao tác này.';
      else {
        const s=settingsSchema.safeParse(c.settings??f.settings);
        if(!s.success || s.data.channel>f.channel_count)error='Thiết lập không phù hợp với thiết bị.';
        else {
          if(typeof c.raw_record==='boolean')this.rawRecording=c.raw_record;
          this.frame=this.fresh(s.data);this.contractionAt=null;this.remainder=0;
        }
      }
    } else if(c.action==='stop') {
      if(['training','calibrating','ready','idle'].includes(f.state)){
        if(f.state==='training' && !f.paused && this.contractionAt!==null){
          f.incomplete_contraction={
            channel:f.selected_channel,
            started_ms:this.contractionAt,
            ended_ms:f.t_ms,
            hold_ms:f.current_hold_ms,
            in_zone_ms:this.zoneLongest,
            start_sample_index:Math.round(this.contractionAt*this.simFsHz/1000),
            end_sample_index:Math.round(f.t_ms*this.simFsHz/1000),
            rms_mean:this.activeRmsCount?Math.round((this.activeRmsSum/this.activeRmsCount)*10)/10:this.activeChannel().rms,
            rms_peak:this.activeRmsCount?Math.round(this.activeRmsPeak*10)/10:this.activeChannel().rms,
            reason_code:'stopped_mid_contraction',
          };
        }
        f.state='stopped';f.phase='idle';f.paused=false;f.current_hold_ms=0;f.active_contraction=null;
        this.contractionAt=null;this.activeRmsSum=0;this.activeRmsPeak=0;this.activeRmsCount=0;
      }
    } else if(c.action==='pause') {
      if(f.state!=='training' || f.paused) error='Chỉ có thể tạm dừng khi đang đo.';
      else {f.paused=true;f.phase='idle';f.current_hold_ms=0;f.active_contraction=null;this.contractionAt=null;this.activeRmsSum=0;this.activeRmsPeak=0;this.activeRmsCount=0;}
    } else if(c.action==='resume') {
      if(f.state!=='training' || !f.paused) error='Phiên đo không ở trạng thái tạm dừng.';
      else {f.paused=false;f.phase='relax';f.current_hold_ms=0;f.active_contraction=null;this.contractionAt=null;this.cycleStart=f.t_ms;this.activeRmsSum=0;this.activeRmsPeak=0;this.activeRmsCount=0;}
    } else if(c.action==='reset_counter') {
      if(!['training','ready','idle','stopped','completed'].includes(f.state)) error='Không thể đặt lại bộ đếm lúc này.';
      else {f.total_count=0;f.valid_count=0;f.repetitions=[];f.current_hold_ms=0;f.last_hold_ms=0;f.active_contraction=null;f.incomplete_contraction=null;this.contractionAt=null;this.cycleStart=f.t_ms;this.activeRmsSum=0;this.activeRmsPeak=0;this.activeRmsCount=0;if(f.state==='training'&&!f.paused)f.phase='relax';}
    } else if(c.action==='calibrate') {
      if(!['idle','ready'].includes(f.state)) error='Hãy tạo buổi mới trước khi hiệu chuẩn.';
      else {
        const s=settingsSchema.safeParse(c.settings??f.settings);
        if(!s.success || s.data.channel>f.channel_count)error='Thiết lập không phù hợp với thiết bị.';
        else {
          if(typeof c.raw_record==='boolean'){this.rawRecording=c.raw_record;f.raw_recording=this.rawRecording;}
          f.settings=s.data;f.y_max=Math.max(500,(s.data.reference_rms??0)*Math.max(1,(s.data.zone_high_pct??70)/100)*1.15);f.selected_channel=s.data.channel;f.state='calibrating';f.paused=false;f.phase='relax';f.calibration_progress=0;f.active_contraction=null;f.incomplete_contraction=null;this.calibrationStart=f.t_ms;if(f.t_ms===0)f.started_at=new Date().toISOString();
        }
      }
    } else if(c.action==='start') {
      if(f.state!=='ready') error='Cần hiệu chuẩn xong trước khi bắt đầu.';
      else if(c.settings && !sameSettings(c.settings,f.settings)) error='Thiết lập thay đổi, hãy hiệu chuẩn lại.';
      else {
        if(typeof c.raw_record==='boolean'){this.rawRecording=c.raw_record;f.raw_recording=this.rawRecording;}
        if(c.settings)f.settings={...f.settings,...c.settings};f.state='training';f.paused=false;f.phase='relax';f.duration_ms=0;f.active_contraction=null;f.incomplete_contraction=null;this.trainingStart=f.t_ms;this.cycleStart=f.t_ms;this.restAt=f.t_ms;
      }
    }
    if(!error && ['pause','resume','reset','reset_counter','stop','calibrate'].includes(c.action)){
      this.aboveAt=this.belowAt=this.zoneSince=null;this.zoneLongest=0;this.restAt=this.frame.t_ms;
      this.frame.current_rest_ms=0;this.frame.current_in_zone_ms=0;this.frame.longest_in_zone_ms=0;
    }
    const ack:Ack={type:'ack',protocol:1,command_id:c.command_id,accepted:!error,message:error,snapshot:this.snapshot(c.action==='reset'?'reset':c.action==='get_state'?'state':'command')};
    this.acks.set(c.command_id,structuredClone(ack)); if(this.acks.size>256)this.acks.delete(this.acks.keys().next().value!);
    return ack;
  }
  advance(dt:number):Frame {
    this.remainder+=Math.max(0,dt);
    // Internal processing steps maintain the repetition ledger; only the newest display packet is emitted.
    while(this.remainder>=100) {this.step();this.remainder-=100;}
    return this.snapshot();
  }
  private emitRawWindow(firstSample:number,framesCount:number){
    if(!this.rawRecording || this.rawHandlers.size===0)return;
    const f=this.frame;
    const chCount=f.channel_count;
    const data=new Uint16Array(framesCount*chCount);
    const uvPerCode=805.86/400;
    for(let i=0;i<framesCount;i++){
      const sec=(firstSample+i)/this.simFsHz;
      for(let k=0;k<chCount;k++){
        const rmsUv=f.channels[k]?.rms??28;
        this.rawRng=(Math.imul(this.rawRng,1664525)+1013904223)>>>0;
        const n=(((this.rawRng>>>8)/16777216)*2-1)*1.7320508;
        const uv=rmsUv*(0.75*n+0.8*Math.sin(2*Math.PI*83*sec+k)+0.6*Math.sin(2*Math.PI*137*sec+k))+5*Math.sin(2*Math.PI*50*sec);
        const code=Math.max(0,Math.min(4095,Math.round(2048+uv/uvPerCode)));
        data[i*chCount+k]=code;
      }
    }
    const packet:RawBatchPacket={
      session_id:f.session_id,
      first_sample_index:firstSample,
      sample_count:framesCount,
      channels:chCount,
      fs_hz:this.simFsHz,
      encoding:'uint16_adc',
      data,
      received_wall_ms:Date.now(),
    };
    this.rawHandlers.forEach(h=>h(packet));
  }
  private step(){
    const f=this.frame;
    if(f.state==='calibrating') {
      const firstSample=this.sampleIndex;
      this.sampleIndex+=100;
      f.t_ms+=100;f.calibration_progress=Math.min(1,(f.t_ms-this.calibrationStart)/2500);
      const rms0=Math.round((28+3*Math.sin(f.t_ms/170))*10)/10;
      f.channels[0].rms=rms0;
      f.channels[0].filtered=Math.round((rms0*1.15*Math.sin(f.t_ms*0.19))*10)/10;
      if(f.channels[1]){
        const rms1=Math.round((26+3*Math.cos(f.t_ms/190))*10)/10;
        f.channels[1].rms=rms1;
        f.channels[1].filtered=Math.round((rms1*1.15*Math.cos(f.t_ms*0.19))*10)/10;
      }
      this.emitRawWindow(firstSample,100);
      if(f.calibration_progress===1){f.state='ready';f.phase='idle';}
      return;
    }
    if(f.state!=='training')return;
    if(f.paused){f.phase='idle';return;}
    const free=isFreeMode(f.settings);
    const firstSample=this.sampleIndex;
    this.sampleIndex+=100;
    f.t_ms+=100; f.duration_ms=f.t_ms-this.trainingStart;
    const pos=f.t_ms-this.cycleStart;
    const short=f.total_count%4===1; // includes repeatable unsuccessful attempts in training mode.
    const hold=free?(short?300:700):(short?Math.max(100,f.settings.min_hold_ms-300):f.settings.min_hold_ms+600);
    const releasedAt=1000+hold;
    let rms=30+6*Math.sin(f.t_ms/170)+2*Math.cos(f.t_ms/60);
    if(pos>=1000 && pos<releasedAt) {
      if(f.settings.zone_enabled && !free){
        const low=f.settings.zone_low_pct??40,high=f.settings.zone_high_pct??70,ref=f.settings.reference_rms!;
        // Every third attempt starts too high before settling in the selected target band.
        const pct=f.total_count%3===2 && pos<1300?high+15:(low+high)/2;
        rms=ref*pct/100;
      }else rms=235+20*Math.sin(f.t_ms/190);
    }
    const activeCh=this.activeChannel();
    activeCh.rms=Math.round(rms*10)/10;
    activeCh.filtered=Math.round((rms*1.15*Math.sin(f.t_ms*0.19+0.7))*10)/10;
    const otherCh=f.channels.find(c=>c.id!==activeCh.id);
    if(otherCh){
      const otherRms=Math.round((27+5*Math.cos(f.t_ms/150))*10)/10;
      otherCh.rms=otherRms;
      otherCh.filtered=Math.round((otherRms*1.15*Math.cos(f.t_ms*0.19))*10)/10;
    }
    this.emitRawWindow(firstSample,100);
    this.processRms(rms,free,pos);
    if(pos>=releasedAt+1000)this.cycleStart=f.t_ms;
  }
  /** One 100 ms window; public for deterministic signal regression tests. */
  processRms(rms:number,free=isFreeMode(this.frame.settings),pos=0){
    const f=this.frame;
    if(f.state!=='training'||f.paused||!Number.isFinite(rms)||rms<0)return;
    const activeCh=this.activeChannel();
    activeCh.rms=rms;
    activeCh.filtered=Math.round((rms*1.15*Math.sin(f.t_ms*0.19+0.7))*10)/10;
    Object.assign(f,biofeedback(rms,f.settings));
    const inside=f.target_zone==='inside';
    if(this.contractionAt===null){
      if(rms>=activeCh.on_threshold){
        this.aboveAt??=f.t_ms-100;
        if(inside)this.zoneSince??=f.t_ms-100;else this.zoneSince=null;
        if(f.t_ms-this.aboveAt>=200){
          this.contractionAt=this.aboveAt;
          this.restBefore=Math.max(0,this.contractionAt-this.restAt);
          this.zoneLongest=0;
          this.activeRmsSum=rms;this.activeRmsPeak=rms;this.activeRmsCount=1;
        }
      }else {this.aboveAt=null;this.zoneSince=null;}
    }
    if(this.contractionAt!==null) {
      if(this.activeRmsCount===0){this.activeRmsSum=rms;this.activeRmsPeak=rms;this.activeRmsCount=1;}
      else {this.activeRmsSum+=rms;if(rms>this.activeRmsPeak)this.activeRmsPeak=rms;this.activeRmsCount++;}
      if(inside){this.zoneSince??=f.t_ms-100;}else this.zoneSince=null;
      f.current_in_zone_ms=this.zoneSince===null?0:f.t_ms-this.zoneSince;
      this.zoneLongest=Math.max(this.zoneLongest,f.current_in_zone_ms);f.longest_in_zone_ms=this.zoneLongest;
      if(rms<=activeCh.off_threshold)this.belowAt??=f.t_ms-100;else this.belowAt=null;
      f.current_hold_ms=(this.belowAt??f.t_ms)-this.contractionAt;f.current_rest_ms=0;
      f.phase=free?'contract':((f.settings.zone_enabled?this.zoneLongest:f.current_hold_ms)>=f.settings.min_hold_ms?'release':'hold');
      if(this.belowAt!==null && f.t_ms-this.belowAt>=200){
        const held=f.current_hold_ms; const valid=free||(f.settings.zone_enabled?this.zoneLongest:held)>=f.settings.min_hold_ms;
        const meanRms=Math.round((this.activeRmsSum/Math.max(1,this.activeRmsCount))*10)/10;
        const peakRms=Math.round(this.activeRmsPeak*10)/10;
        f.repetitions.push({
          id:uid(),
          ordinal:f.total_count+1,
          channel:f.selected_channel,
          started_ms:this.contractionAt,
          ended_ms:this.belowAt,
          hold_ms:held,
          rest_ms:this.restBefore,
          in_zone_ms:this.zoneLongest,
          start_sample_index:Math.round(this.contractionAt*this.simFsHz/1000),
          end_sample_index:Math.round(this.belowAt*this.simFsHz/1000),
          rms_mean:meanRms,
          rms_peak:peakRms,
          reason_code:valid?null:(f.settings.zone_enabled?'insufficient_in_zone':'short_hold'),
          label_source:'algorithm_predicted',
          valid,
        });
        f.total_count++;if(valid)f.valid_count++;f.last_hold_ms=held;f.current_hold_ms=0;this.contractionAt=null;
        this.restAt=this.belowAt;this.belowAt=this.aboveAt=this.zoneSince=null;this.zoneLongest=0;
        this.activeRmsSum=0;this.activeRmsPeak=0;this.activeRmsCount=0;f.active_contraction=null;
        f.current_in_zone_ms=f.longest_in_zone_ms=0;
        f.phase='relax';
        if(!free && f.valid_count>=f.settings.target){f.state='completed';f.phase='complete';}
      } else {
        f.active_contraction={
          channel:f.selected_channel,
          started_ms:this.contractionAt,
          ended_ms:f.t_ms,
          hold_ms:f.current_hold_ms,
          in_zone_ms:this.zoneLongest,
          start_sample_index:Math.round(this.contractionAt*this.simFsHz/1000),
          end_sample_index:Math.round(f.t_ms*this.simFsHz/1000),
          rms_mean:Math.round((this.activeRmsSum/Math.max(1,this.activeRmsCount))*10)/10,
          rms_peak:Math.round(this.activeRmsPeak*10)/10,
          reason_code:'session_in_progress',
        };
      }
    } else {f.active_contraction=null;f.current_rest_ms=Math.max(0,f.t_ms-this.restAt);f.current_in_zone_ms=0;f.phase=free?'relax':(pos<500?'relax':'contract');}
  }
}
