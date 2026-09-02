import { evaluatePolicy } from "../src/lib/demo-engine/controller/policy-engine";
import { makeEmptySession, NLUResponse } from "../src/lib/demo-engine/types";
import { generateResponse } from "../src/lib/demo-engine/controller/response-generator";

async function runTests() {
  console.log("=== PHASE 7 TEST: Out-of-Scope Deflection ===");
  
  let session = makeEmptySession("HVAC");

  // NLU detects user asks about prime minister
  const nlu: NLUResponse = {
    intent: "OFF_TOPIC",
    behavior: "NEUTRAL",
    confidence: 0.95,
    safety: { status: "NORMAL", category: null, confidence: 1.0 }
  };

  const utterance = "Who is the prime minister?";
  
  for (let i = 1; i <= 3; i++) {
    console.log(`\n--- Turn ${i} ---`);
    const result = await evaluatePolicy(session, nlu, utterance);
    session = result.session;

    console.log(`State: ${session.state}`);
    console.log(`Action: ${session.currentAction}`);
    console.log(`Off-Topic Count: ${session.offTopicCount}`);

    const prompt = generateResponse(
      session.currentAction,
      undefined,
      session.customerBehavior,
      session.missingFields,
      session
    );

    console.log(`Response Prompt: "${prompt}"`);
  }
}

runTests().catch(console.error);
