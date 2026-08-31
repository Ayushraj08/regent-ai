import WebSocket from 'ws';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
dotenv.config({path: '.env.local'});

async function test() {
  console.log('Fetching token...');
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text/realtime/token', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY || '' }
  });
  console.log('Token response:', res.status);
  const data = await res.json();
  const token = data.token || data.token_id || data;
  console.log('Token data keys:', Object.keys(data));
  console.log('Token string?', typeof token === 'string');
}
test().catch(console.error);
