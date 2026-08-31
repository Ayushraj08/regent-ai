import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.GEMINI_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] })
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
