import WebSocket from 'ws';
import * as dotenv from 'dotenv';
dotenv.config({path: '.env.local'});

function testPayload(payloadStr, name) {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/realtime', {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
    });
    ws.on('open', () => {
      ws.send(payloadStr);
      setTimeout(() => { ws.close(); resolve(true); }, 500);
    });
    ws.on('message', (data) => {
      const msg = data.toString();
      if (msg.includes('input_error')) {
        console.log('[FAILED] ' + name + ':', msg);
        ws.close();
        resolve(false);
      }
    });
  });
}

async function run() {
  await testPayload(JSON.stringify({ user_audio_chunk: 'base64' }), 'user_audio_chunk');
  await testPayload(JSON.stringify({ audio_chunk: 'base64' }), 'audio_chunk');
  await testPayload(JSON.stringify({ audio: 'base64' }), 'audio');
  await testPayload(JSON.stringify({ type: 'audio', audio: 'base64' }), 'type:audio');
  await testPayload(JSON.stringify({ text: 'base64' }), 'text');
}
run();
