import WebSocket from 'ws';
import * as dotenv from 'dotenv';
dotenv.config({path: '.env.local'});

const ws = new WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/realtime', {
  headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
});

ws.on('open', () => {
  ws.send(JSON.stringify({ text: "Hello" }));
});
ws.on('message', (data) => console.log('Received 3:', data.toString()));
setTimeout(() => process.exit(0), 1000);
