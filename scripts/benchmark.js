const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const prompt = `Current State: INTENT
Known Lead Info: {"name":null,"phone":null,"address":null,"service":null,"problem":null,"urgency":null,"trade":"HVAC"}
Latest Customer Utterance: "My AC is blowing hot air."

Analyze the utterance, extract data, update the lead, determine the next state, and generate the Regent response.`;

const systemInstruction = `You are the core intelligence for Regent, a missed-call recovery AI for home service businesses.
Your role is to interpret customer utterances, enforce safety rules, extract structured lead data, and advance the conversation state.
JSON RESPONSE FORMAT REQUIRED.`;

async function runBenchmark(model) {
  console.log(`\nBenchmarking ${model}...`);
  const latencies = [];
  const errors = [];

  for (let i = 0; i < 20; i++) {
    const start = Date.now();
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });
      const duration = Date.now() - start;
      latencies.push(duration);
      process.stdout.write(".");
    } catch (e) {
      errors.push(e.message);
      process.stdout.write("E");
    }
  }

  console.log("\nResults for", model);
  if (latencies.length > 0) {
    latencies.sort((a, b) => a - b);
    const min = latencies[0];
    const max = latencies[latencies.length - 1];
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const median = latencies[Math.floor(latencies.length / 2)];
    const p90 = latencies[Math.floor(latencies.length * 0.9)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    console.log(`Min: ${min}ms`);
    console.log(`Max: ${max}ms`);
    console.log(`Avg: ${avg.toFixed(2)}ms`);
    console.log(`Median: ${median}ms`);
    console.log(`P90: ${p90}ms`);
    console.log(`P95: ${p95}ms`);
  }
  console.log(`Errors: ${errors.length}`);
}

async function main() {
  await runBenchmark("gemini-3.7-flash");
  await runBenchmark("gemini-3.5-flash-lite");
}

main().catch(console.error);
