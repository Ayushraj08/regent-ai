import WebSocket from 'ws';
import * as dotenv from 'dotenv';
dotenv.config({path: '.env.local'});

function testRaw() {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/realtime', {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
    });
    ws.on('open', () => {
      // Send a fake binary audio buffer
      const buf = Buffer.alloc(1024, 0);
      ws.send(buf);
      setTimeout(() => { ws.close(); resolve(true); }, 500);
    });
    ws.on('message', (data) => {
      console.log('Received binary test:', data.toString());
      ws.close();
      resolve(false);
    });
  });
}

testRaw();
