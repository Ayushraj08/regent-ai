import { config } from "dotenv";
config({ path: ".env.local" });

async function testOpenRouter() {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "meta-llama/llama-3.1-8b-instruct",
      messages: [{ role: "user", content: "Hello!" }]
    })
  });
  console.log(response.status);
  console.log(await response.text());
}
testOpenRouter().catch(console.error);
