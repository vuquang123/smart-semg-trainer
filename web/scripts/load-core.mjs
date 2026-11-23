import { build } from 'esbuild';
export async function loadCore(){
  const result=await build({stdin:{contents:"export {SimulationEngine} from './src/core/engine.ts';export {commandSchema} from './src/core/protocol.ts';export {WebSocketTransport} from './src/transports/websocket.ts';export {DEFAULT_TINYJAMBU_KEY_HEX,EMG_WS_AEAD_AD_C2S,EMG_WS_AEAD_AD_S2C,decryptWsEnvelope,encryptWsEnvelope,parseTinyJambuKey} from './src/core/tinyjambu.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
