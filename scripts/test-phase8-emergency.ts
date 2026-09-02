import { evaluatePolicy } from "../src/lib/demo-engine/controller/policy-engine";
import { makeEmptySession, NLUResponse } from "../src/lib/demo-engine/types";
import { generateResponse } from "../src/lib/demo-engine/controller/response-generator";

async function runTests() {
  console.log("=== PHASE 8 TEST: Emergency Safety Handling ===");
  
  let session = makeEmptySession("ELECTRICAL");

  // NLU detects smoke/fire -> SAFETY_CRITICAL
  const nlu: NLUResponse = {
    intent: "EMERGENCY",
    behavior: "DISTRESSED",
    confidence: 1.0,
    safety: { 
        status: "CRITICAL", 
        category: "FIRE_HAZARD", 
        confidence: 1.0, 
        reason: "Customer mentioned smoke coming from electrical panel" 
    }
  };

  const utterance = "There's smoke coming from my electrical panel!";
  
  console.log("Simulating Evaluate Policy...");
  const result = await evaluatePolicy(session, nlu, utterance);
  session = result.session;

  console.log(`Final State: ${session.state}`);
  console.log(`Current Action: ${session.currentAction}`);
  console.log(`Should Transfer Flag: ${result.shouldTransfer}`);
  console.log(`Diagnostic Reason: ${session.diagnosticReason}`);

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
