import * as dotenv from 'dotenv';
import fetch from 'node-fetch';
dotenv.config({path: '.env.local'});

async function testToken() {
  const res = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json"
    }
  });
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Body:', text);
}
testToken();
