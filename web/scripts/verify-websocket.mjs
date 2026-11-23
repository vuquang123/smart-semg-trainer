import assert from 'node:assert/strict';
import { createEmulator } from './esp32-emulator.mjs';
import { loadCore } from './load-core.mjs';
const {WebSocketTransport}=await loadCore();
const server=await createEmulator({port:0});
const transport=new WebSocketTransport(server.url);let latest;let received=0;
transport.onFrame(f=>{latest=f;received++;});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const send=async(action)=>transport.send({type:'command',protocol:1,command_id:crypto.randomUUID(),session_id:latest.session_id,action,settings:{muscle:'forearm',channel:1,target:5,min_hold_ms:500}});
try{
 await transport.connect();assert.equal(latest.source,'simulation');const id=latest.session_id;
 assert.equal((await send('start')).accepted,false);
 const a=await send('calibrate');assert.equal(a.accepted,true);await wait(2700);assert.equal(latest.state,'ready');
 assert.equal((await send('start')).accepted,true);await wait(3300);assert.ok(latest.valid_count>=1);
 const stopped=await send('stop');assert.equal(stopped.snapshot.state,'stopped');const count=stopped.snapshot.valid_count;await wait(400);assert.equal(latest.valid_count,count);
 assert.ok(transport.getDiagnostics().rtt_ms!==null);assert.ok(transport.getDiagnostics().sample_age_ms!==null);assert.ok(transport.getDiagnostics().uncertainty_ms!==null);
 transport.disconnect();const first=transport.connect(),second=transport.connect();assert.equal(first,second);await Promise.all([first,second]);assert.equal(latest.session_id,id);assert.equal(latest.state,'stopped');assert.ok(received>20);
 const legacy=await createEmulator({port:0,timing:false});const oldTransport=new WebSocketTransport(legacy.url);let legacyFrames=0;oldTransport.onFrame(()=>legacyFrames++);try{await oldTransport.connect();await wait(350);assert.equal(oldTransport.getDiagnostics().rtt_ms,null);assert.ok(legacyFrames>=3);}finally{oldTransport.disconnect();await legacy.close();}
 const badKeyTransport=new WebSocketTransport(server.url,'ffffffffffffffffffffffffffffffff');await assert.rejects(()=>badKeyTransport.connect(),/TinyJAMBU-128 AEAD/);badKeyTransport.disconnect();
 console.log(JSON.stringify({status:'passed',checks:14,transport:'Real WebSocket client ↔ Node virtual ESP32 (TinyJAMBU-128 AEAD)',packets_received:received,valid_count:count,session_preserved:true,aead_verified:true,note:'No physical hardware or Safari browser involved.'},null,2));
}finally{transport.disconnect();await server.close();}
