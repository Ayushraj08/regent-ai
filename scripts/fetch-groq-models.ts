import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

fetch('https://api.groq.com/openai/v1/models', {
  headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` }
})
.then(r => r.json())
.then(data => console.log(JSON.stringify(data.data.map((m: any) => m.id), null, 2)))
.catch(console.error);
