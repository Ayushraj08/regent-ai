import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const token = process.env.GEMINI_API_KEY || '';

async function testAuth(method: string, headers: any, suffix = '') {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent${suffix}`;
  console.log(`\nTesting: ${method}`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] })
    });
    console.log(`Status: ${res.status}`);
    const body = await res.text();
    console.log(`Body: ${body.substring(0, 300)}`);
  } catch (e: any) {
    console.log(`Failed: ${e.message}`);
  }
}

async function run() {
  console.log(`Token prefix: ${token.substring(0, 4)}...`);
  
  // Test 1: As API Key
  await testAuth('API Key in URL', {}, `?key=${token}`);
  
  // Test 2: As API Key in Header
  await testAuth('API Key in Header', { 'x-goog-api-key': token });
  
  // Test 3: As Bearer Token
  await testAuth('Bearer Token', { 'Authorization': `Bearer ${token}` });
}

run();
