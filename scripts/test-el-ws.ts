import WebSocket from 'ws';
import * as dotenv from 'dotenv';
import fs from 'fs';
dotenv.config({path: '.env.local'});

async function test() {
  console.log('Connecting to ElevenLabs STT...');
  const ws = new WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/realtime?xi-api-key=' + process.env.ELEVENLABS_API_KEY);
  
  ws.on('open', () => {
    console.log('Connected!');
    ws.send(JSON.stringify({ text: ' ', model_id: 'scribe_v2_realtime' }));
    console.log('Sent initialization payload.');
    
    // Now close it after a second
    setTimeout(() => { ws.close(); console.log('Closed.'); process.exit(0); }, 1500);
  });
  
  ws.on('message', (data) => {
    console.log('Received:', data.toString());
  });
  
  ws.on('error', (err) => {
    console.error('Error:', err);
  });
  
  ws.on('close', (code, reason) => {
    console.log('Close code:', code, 'Reason:', reason.toString());
  });
}
test();
