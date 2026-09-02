import { evaluatePolicy } from "../src/lib/demo-engine/controller/policy-engine";
import { makeEmptySession, NLUResponse } from "../src/lib/demo-engine/types";
import { generateResponse } from "../src/lib/demo-engine/controller/response-generator";

async function runTests() {
  console.log("=== PHASE 6 TEST: Human Escalation ===");
  
  let session = makeEmptySession("HVAC");
  session.turnCount = 1;
  // Let's say we captured a name already to check nameCtx insertion
  session.lead.name = { value: "Sarah", status: "CAPTURED", confidence: 1.0, sourceTurn: 1, updatedTurn: 1 };

  // NLU detects user wants a human
  const nlu: NLUResponse = {
    intent: "HUMAN_REQUEST",
    behavior: "FRUSTRATED",
    confidence: 0.95,
    safety: { status: "NORMAL", category: null, confidence: 1.0 }
  };

  const utterance = "Just let me speak to a person!";
  
  console.log("Simulating Evaluate Policy...");
  const result = await evaluatePolicy(session, nlu, utterance);
  session = result.session;

  console.log(`Final State: ${session.state}`);
  console.log(`Current Action: ${session.currentAction}`);
  console.log(`Should Transfer Flag: ${result.shouldTransfer}`);

  const prompt = generateResponse(
    session.currentAction,
    undefined,
    session.customerBehavior,
    session.missingFields,
    session
  );

  console.log(`Response Prompt: "${prompt}"`);
}

runTests().catch(console.error);
