import { GeminiProvider } from "../src/lib/demo-engine/providers/gemini";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const provider = new GeminiProvider("gemini-1.5-flash");

async function run() {
  const req = {
    state: "COLLECTING",
    trade: "HVAC",
    lead: {},
    utterance: "It's about my AC. AC is not working properly. It's not cooling. And I called your executive, but they are not able to fix it.",
    turnCount: 1,
    conversationHistory: [
      { role: "REGENT", content: "Alright. Could you tell me more — is this about your AC, heating, thermostat, or something else?" }
    ]
  };
  const res = await provider.generate(req, { signal: new AbortController().signal });
  console.log(JSON.stringify(res, null, 2));
}

run().catch(console.error);
