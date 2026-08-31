import WebSocket from 'ws';
import * as dotenv from 'dotenv';
dotenv.config({path: '.env.local'});

async function test() {
  const ws = new WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/realtime', {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
  });
  ws.on('open', () => {
    ws.send(JSON.stringify({ text: ' ', model_id: 'scribe_v2_realtime' }));
    setTimeout(() => ws.close(), 1000);
  });
  ws.on('message', (data) => console.log('Received:', data.toString()));
}
test();
