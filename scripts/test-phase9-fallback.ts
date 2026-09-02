import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession } from "../src/lib/demo-engine/types";
import { ProviderRouter } from "../src/lib/demo-engine/providers/router";

// Mock the ProviderRouter to ALWAYS throw an error, simulating 100% LLM crash
ProviderRouter.prototype.route = async function() {
    throw new Error("MOCKED LLM CRASH: All providers failed");
};

async function runTests() {
  console.log("=== PHASE 9 TEST: Deterministic Fallback & Loop Prevention ===");
  
  let session = makeEmptySession("PLUMBING");
  
  // Turn 1: LLM crashes, we should get fallback asking for name (since it's first required field)
  console.log("\n--- Turn 1: Initial Fallback ---");
  let result = await processDemoUtterance({ session, utterance: "I need help with my plumbing" });
  session = result.session;
  console.log(`State: ${session.state}`);
  console.log(`Action: ${session.currentAction}`);
  console.log(`Target Field: ${result.targetField}`);
  console.log(`Response Prompt: "${result.response}"`);
  
  // Turn 2: User provides gibberish that doesn't match the regex for 'name'
  console.log("\n--- Turn 2: Gibberish (Loop count 1) ---");
  result = await processDemoUtterance({ session, utterance: "Blah blah blah" });
  session = result.session;
  console.log(`State: ${session.state}`);
  console.log(`Action: ${session.currentAction}`);
  console.log(`Target Field: ${result.targetField}`);
  console.log(`Response Prompt: "${result.response}"`);
  
  // Turn 3: User provides gibberish again (Loop count 2) -> Should trigger loop prevention
  console.log("\n--- Turn 3: Gibberish Again (Loop count 2 -> Escalation) ---");
  result = await processDemoUtterance({ session, utterance: "More blah blah" });
  session = result.session;
  console.log(`State: ${session.state}`);
  console.log(`Action: ${session.currentAction}`);
  console.log(`Should Transfer: ${result.shouldTransfer}`);
  console.log(`Response Prompt: "${result.response}"`);
}

runTests().catch(console.error);
