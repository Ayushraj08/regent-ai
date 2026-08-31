import * as fs from 'fs';
import * as path from 'path';

// Load env directly like Next.js would
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function checkEnv() {
  console.log('--- 1. ENVIRONMENT FILE AUDIT ---');
  const files = ['.env', '.env.local', '.env.development', '.env.development.local'];
  for (const file of files) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      console.log(`\nFound: ${file}`);
      const content = fs.readFileSync(filePath, 'utf-8');
      const vars = ['GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'];
      for (const v of vars) {
        const match = content.match(new RegExp(`^${v}=(.*)$`, 'm'));
        if (match) {
          console.log(`  ${v}: ${match[1].trim() ? 'PRESENT' : 'EMPTY'}`);
        } else {
          console.log(`  ${v}: MISSING`);
        }
      }
    }
  }
}

async function fetchDirect(name: string, url: string, headers: any, body: any) {
  console.log(`\n--- DIAGNOSTIC: ${name} ---`);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const duration = Date.now() - start;
    console.log(`URL: ${url}`);
    console.log(`HTTP status: ${res.status}`);
    console.log(`Latency: ${duration}ms`);
    
    const text = await res.text();
    console.log(`Response body: ${text.substring(0, 500)}`);
  } catch (e: any) {
    console.log(`Request failed completely: ${e.message}`);
  }
}

async function main() {
  await checkEnv();

  // Gemini (REST)
  const geminiKey = process.env.GEMINI_API_KEY || '';
  const geminiModel = 'gemini-1.5-flash'; // Let's try a real model ID
  await fetchDirect(
    'Gemini REST API',
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
    { 'Content-Type': 'application/json' },
    {
      contents: [{ parts: [{ text: "Hello" }] }]
    }
  );

  // Groq
  const groqKey = process.env.GROQ_API_KEY || '';
  await fetchDirect(
    'Groq',
    'https://api.groq.com/openai/v1/chat/completions',
    { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    { model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: 'Hello' }] }
  );

  // OpenAI
  const openaiKey = process.env.OPENAI_API_KEY || '';
  await fetchDirect(
    'OpenAI',
    'https://api.openai.com/v1/chat/completions',
    { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hello' }] }
  );

  // OpenRouter
  const openrouterKey = process.env.OPENROUTER_API_KEY || '';
  await fetchDirect(
    'OpenRouter',
    'https://openrouter.ai/api/v1/chat/completions',
    { 'Authorization': `Bearer ${openrouterKey}`, 'Content-Type': 'application/json' },
    { model: 'meta-llama/llama-3.1-8b-instruct:free', messages: [{ role: 'user', content: 'Hello' }] }
  );
}

main();
