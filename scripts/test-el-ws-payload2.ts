import WebSocket from 'ws';
import * as dotenv from 'dotenv';
dotenv.config({path: '.env.local'});

const ws = new WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/realtime', {
  headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
});

ws.on('open', () => {
  ws.send(JSON.stringify({ user_audio_chunk: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=' }));
  setTimeout(() => ws.close(), 1000);
});
ws.on('message', (data) => console.log('Received 2:', data.toString()));
