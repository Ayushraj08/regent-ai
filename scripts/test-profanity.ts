import { OpenAIProvider } from "../src/lib/demo-engine/providers/openai";
import { makeEmptySession } from "../src/lib/demo-engine/types";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function testProvider() {
  const provider = new OpenAIProvider("gpt-4o-mini");
  const session = makeEmptySession(null);
  
  try {
    const res = await provider.generate({
      state: "COLLECTING",
      trade: "HVAC",
      lead: session.lead,
      utterance: "My name is Ayush, but the-- your service is very, very poor, and I don't want to rate you even five out of five. I'm going to rate you zero out of five. You have fucked up my AC.",
      turnCount: 1
    }, { signal: new AbortController().signal });
    console.log("Success:", res);
  } catch (e: any) {
    console.error("Error from provider:", e.message, e.classification);
  }
}

testProvider();
