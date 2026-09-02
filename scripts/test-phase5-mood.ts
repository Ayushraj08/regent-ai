import { evaluatePolicy } from "../src/lib/demo-engine/controller/policy-engine";
import { makeEmptySession, NLUResponse } from "../src/lib/demo-engine/types";
import { db } from "../src/lib/db/db-client";
import { generateResponse } from "../src/lib/demo-engine/controller/response-generator";

async function runTests() {
  console.log("=== PHASE 5 TEST: Mood & Routing ===");
  
  // 1. Seed DB
  await db.clearDatabase();
  const businessId = "00000000-0000-0000-0000-000000000001";
  
  const customer = await db.createCustomer({
    business_id: businessId,
    name: "John Doe",
    phone: "5551234567",
    normalized_phone: "5551234567"
  });

  const request = await db.createServiceRequest({
    customer_id: customer.id,
    business_id: businessId,
    trade: "HVAC",
    request_type: "INSTALLATION",
    primary_service: "AC_INSTALLATION",
    service_address: "123 Main St",
    status: "CLOSED"
  });

  // 2. Simulate Frustrated Returning Customer
  let session = makeEmptySession("HVAC");
  session.turnCount = 1;

  // Assume NLU extracted phone and recognized complaint + anger
  const nlu: NLUResponse = {
    intent: "COMPLAINT",
    behavior: "ANGRY",
    confidence: 0.9,
    safety: { status: "NORMAL", category: null, confidence: 1.0 },
    extracted: {
      phone: { value: "5551234567", status: "CAPTURED", confidence: 1.0, sourceTurn: 1, updatedTurn: 1 },
      problem: { value: null, status: "MISSING", confidence: 0, sourceTurn: 1, updatedTurn: 1 }
    }
  };

  const utterance = "I want to complain about my recent AC install, it's broken!";
  
  console.log("Simulating Evaluate Policy...");
  const result = await evaluatePolicy(session, nlu, utterance);
  session = result.session;

  console.log(`Lookup Status: ${session.lookupStatus}`);
  console.log(`Returning Customer: ${session.returningCustomer}`);
  console.log(`Current Action: ${session.currentAction}`);
  console.log(`Customer Name Auto-filled: ${session.lead.name?.value}`);

  // 3. Generate response
  const prompt = generateResponse(
    session.currentAction,
    result.session.targetField ?? undefined, // <-- changed from currentAction target field? No, targetField is returned via resolution but wait, evaluatePolicy doesn't return targetField, it's in resolution inside policy-engine... wait, `evaluatePolicy` doesn't export targetField directly in PolicyResult! I'll get it from the missingFields or similar? Actually `targetField` is not saved in session. I'll just check what generateResponse outputs.
    session.customerBehavior,
    session.missingFields,
    session
  );

  console.log(`Response Prompt: "${prompt}"`);
}

runTests().catch(console.error);
