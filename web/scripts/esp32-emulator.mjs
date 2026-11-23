import { WebSocketServer,WebSocket } from 'ws';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCore } from './load-core.mjs';
export async function createEmulator({port=8787,host='127.0.0.1',timing=true,channels=1,keyHex=process.env.SEMG_AEAD_KEY}={}){
  const {SimulationEngine,commandSchema,DEFAULT_TINYJAMBU_KEY_HEX,EMG_WS_AEAD_AD_C2S,EMG_WS_AEAD_AD_S2C,decryptWsEnvelope,encryptWsEnvelope,parseTinyJambuKey}=await loadCore();
  const engine=new SimulationEngine(undefined,channels);
  const aeadKey=parseTinyJambuKey(keyHex??DEFAULT_TINYJAMBU_KEY_HEX);
  const noncePrefix=0x53454d47;
  let txCounter=0n;
  const encryptOut=obj=>encryptWsEnvelope(JSON.stringify(obj),aeadKey,noncePrefix,++txCounter,EMG_WS_AEAD_AD_S2C);
  const root=path.resolve('dist');
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.zip':'application/zip'};
  const server=createServer(async(req,res)=>{
    try{
      if(req.method!=='GET'){res.writeHead(405);res.end();return;}
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const relative=pathname==='/'?'index.html':pathname.slice(1);const file=path.resolve(root,relative);
      if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
      const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-cache'});res.end(body);
    }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Chạy npm run build trước, rồi mở lại trang.');}
  });
  let sampledAt=performance.now();
  const stamp=f=>timing?({...f,capabilities:['timing_v1','tinyjambu_128_aead'],device_clock_ms:performance.now(),sampled_at_device_ms:sampledAt}):({...f,capabilities:['tinyjambu_128_aead']});
  const wss=new WebSocketServer({server,path:'/ws',maxPayload:32000});
  wss.on('connection',ws=>{
    ws.on('message',raw=>{
      try{
        const plain=decryptWsEnvelope(raw.toString(),aeadKey,EMG_WS_AEAD_AD_C2S);
        const data=JSON.parse(plain);
        if(timing&&data.type==='ping'&&data.protocol===1&&typeof data.ping_id==='string'){const received=performance.now();ws.send(encryptOut({type:'pong',protocol:1,ping_id:data.ping_id,device_rx_ms:received,device_tx_ms:performance.now()}));return;}
        const c=commandSchema.parse(data);const ack=engine.execute(c);ws.send(encryptOut({...ack,snapshot:stamp(ack.snapshot)}));
      }
      catch{ws.close(1008,'Invalid TinyJAMBU-128 AEAD command');}
    });
  });
  let last=Date.now();
  const timer=setInterval(()=>{const now=Date.now();const f=engine.advance(now-last);last=now;sampledAt=performance.now();const message=encryptOut(stamp(f));for(const client of wss.clients)if(client.readyState===WebSocket.OPEN)client.send(message);},100);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  const bound=server.address();
  return {server,wss,engine,url:`ws://127.0.0.1:${bound.port}/ws`,close:()=>new Promise(resolve=>{clearInterval(timer);for(const c of wss.clients)c.terminate();wss.close(()=>server.close(resolve));})};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const emulator=await createEmulator({port:Number(process.env.SEMG_EMULATOR_PORT??8787),host:process.env.SEMG_EMULATOR_HOST??'127.0.0.1'});
  console.log('sEMG v1 virtual device (SIMULATION, not sensor data)');console.log(`Local app: http://localhost:${emulator.server.address().port}/`);console.log(`WebSocket: ${emulator.url}`);console.log('Build the frontend first with npm run build.');
  const close=()=>void emulator.close().then(()=>process.exit(0));process.on('SIGINT',close);process.on('SIGTERM',close);
}
