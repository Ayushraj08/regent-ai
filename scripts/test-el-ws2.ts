import WebSocket from 'ws';
import * as dotenv from 'dotenv';
dotenv.config({path: '.env.local'});

async function test() {
  console.log('Connecting...');
  const ws = new WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
  
  ws.on('open', () => {
    ws.send(JSON.stringify({ 
      text: ' ', 
      model_id: 'scribe_v2_realtime',
      authorization: 'Bearer ' + process.env.ELEVENLABS_API_KEY
    }));
    setTimeout(() => ws.close(), 1000);
  });
  
  ws.on('message', (data) => console.log('Received:', data.toString()));
}
test();
