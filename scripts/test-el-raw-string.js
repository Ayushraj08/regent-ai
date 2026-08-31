import WebSocket from 'ws';
import * as dotenv from 'dotenv';
dotenv.config({path: '.env.local'});

async function run() {
  const ws = new WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/realtime', {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
  });
  ws.on('open', () => {
    const buf = Buffer.alloc(1024, 0);
    // Send just the base64 string, not JSON wrapped!
    ws.send(JSON.stringify({ text: " " })); // wait, let's try raw JSON first just to be sure
  });
  ws.on('message', (data) => console.log('Message:', data.toString()));
  setTimeout(() => process.exit(0), 1000);
}
run();
