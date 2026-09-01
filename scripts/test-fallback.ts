process.env.OPENAI_API_KEY = "fake";
process.env.GROQ_API_KEY = "fake";
process.env.GEMINI_API_KEY = "fake";
process.env.OPENROUTER_API_KEY = "fake";

import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession } from "../src/lib/demo-engine/types";

async function testFallback() {
  let session = makeEmptySession("HVAC");
  session.turnCount = 1;
  session.state = "COLLECTING";
  // Simulate that we are currently handling a complaint!
  session.currentAction = "HANDLE_COMPLAINT";
  session.customerBehavior = "FRUSTRATED";
  session.intent = "COMPLAINT";
  session.conversationHistory = [
    { role: "CUSTOMER", content: "Your service is very, very poor. I regretted to opt for your service." },
    { role: "REGENT", content: "I completely understand your frustration, and I apologize for the hassle. Let's get to the bottom of this. What exactly is going on?" }
  ];

  try {
    const r2 = await processDemoUtterance({
      session,
      utterance: "My AC was not working properly, and I opt for your service, and your, uh, support executive came to my home, but my AC is still not working properly, and it's not cooling."
    }, "turn-2");
    
    console.log("R2 Fallback Response:", r2.response);
  } catch (e: any) {
    console.error("FAILED:", e);
  }
}

testFallback();
