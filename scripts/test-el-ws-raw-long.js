import WebSocket from 'ws';
import * as dotenv from 'dotenv';
dotenv.config({path: '.env.local'});

const ws = new WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/realtime', {
  headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
});

ws.on('open', () => {
  console.log('Opened, sending raw binary chunk');
  const buf = Buffer.alloc(32000, 0); // 1 sec of silence
  ws.send(buf);
  
  // also send the EOS message?
  // ws.send(JSON.stringify({ text: " " })); // no wait, this throws error
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
});
ws.on('error', (err) => console.log('Error:', err));

setTimeout(() => { ws.close(); process.exit(0); }, 3000);
