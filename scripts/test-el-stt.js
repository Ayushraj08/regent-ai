import WebSocket from 'ws';
import * as dotenv from 'dotenv';
dotenv.config({path: '.env.local'});

async function run() {
  const ws = new WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/realtime', {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
  });
  ws.on('open', () => {
    // Send 1 second of white noise instead of silence
    const buf = Buffer.alloc(32000);
    for(let i=0; i<32000; i++) buf[i] = Math.random() * 255;
    ws.send(buf);
    
    // Also send some JSON to see if we get a response
    ws.send(JSON.stringify({ user_audio_chunk: buf.toString('base64') }));
  });
  ws.on('message', (data) => console.log('Message:', data.toString()));
  setTimeout(() => process.exit(0), 3000);
}
run();
