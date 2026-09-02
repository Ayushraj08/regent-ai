import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession, NLUResponse } from "../src/lib/demo-engine/types";
import { ProviderRouter } from "../src/lib/demo-engine/providers/router";
import { db } from "../src/lib/db/db-client";

// Mock the ProviderRouter so we can precisely control the NLU outputs for the E2E test
let currentMockNLU: NLUResponse;

ProviderRouter.prototype.route = async function() {
    return { nlu: currentMockNLU, telemetry: {} };
};

async function runTests() {
  console.log("=== PHASE 10 TEST: End-to-End Conversation & DB Seed ===");

  // 1. Setup a returning customer in the local SQLite DB
  await db.clearDatabase();
  const businessId = "00000000-0000-0000-0000-000000000001";
  
  const customer = await db.createCustomer({
    business_id: businessId,
    name: "John Doe",
    phone: "5551234567",
    normalized_phone: "5551234567",
    email: "john@example.com"
  });

  const request = await db.createServiceRequest({
    customer_id: customer.id,
    business_id: businessId,
    trade: "HVAC",
    request_type: "INSTALLATION",
    primary_service: "ac_installation",
    problem: "AC stopped blowing cold air",
    service_address: "123 Main St",
    status: "PENDING"
  });

  const ticket = await db.createTicket({
    service_request_id: request.id,
    business_id: businessId,
    public_reference: "REG123US"
  });

  console.log(`\nSeeded DB with Customer: ${customer.name}, Ticket: ${ticket.public_reference}`);

  let session = makeEmptySession("HVAC");
  
  // Turn 1: Returning customer calling with a complaint, matched by phone
  session.callerPhone = "5551234567"; // Identity Matcher uses this

  console.log("\n--- Turn 1: Identity Match & Complaint (Phase 5) ---");
  // Identity matcher will see the phone and auto-fill Name/Address, but wait, 
  // IdentityMatcher intercepts START state.
  // The first utterance is processed in START state.
  let result = await processDemoUtterance({ session, utterance: "Hello?" });
  session = result.session;
  console.log(`Action: ${session.currentAction}`);
  console.log(`Prompt: "${result.response}"`);

  console.log("\n--- Turn 2: Customer Complains (Phase 5) ---");
  currentMockNLU = {
    intent: "COMPLAINT",
    behavior: "FRUSTRATED",
    confidence: 1.0,
    extracted: {},
    safety: { status: "NORMAL", category: null, confidence: 1.0 }
  };
  result = await processDemoUtterance({ session, utterance: "I'm really frustrated, my AC installation went wrong." });
  session = result.session;
  console.log(`Action: ${session.currentAction}`);
  console.log(`Prompt: "${result.response}"`);
  
  console.log("\n--- Turn 3: Customer Confirms Ticket (Phase 2 & 5) ---");
  currentMockNLU = {
    intent: "PROVIDE_INFORMATION",
    behavior: "NEUTRAL",
    confidence: 1.0,
    extracted: {},
    safety: { status: "NORMAL", category: null, confidence: 1.0 }
  };
  result = await processDemoUtterance({ session, utterance: "Yes that's the one." });
  session = result.session;
  console.log(`Action: ${session.currentAction}`);
  console.log(`Prompt: "${result.response}"`);

  console.log("\n--- Turn 4: Customer Provides Problem (Phase 5) ---");
  currentMockNLU = {
    intent: "PROVIDE_INFORMATION",
    behavior: "NEUTRAL",
    confidence: 1.0,
    extracted: {
      problem: { value: "The unit is leaking water everywhere", status: "CAPTURED", confidence: 1.0, sourceTurn: 4, updatedTurn: 4 }
    },
    safety: { status: "NORMAL", category: null, confidence: 1.0 }
  };
  result = await processDemoUtterance({ session, utterance: "The unit is leaking water everywhere." });
  session = result.session;
  console.log(`Action: ${session.currentAction}`);
  console.log(`Prompt: "${result.response}"`);
  
  console.log("\n--- Turn 5: Complete & Review (Phase 3) ---");
  currentMockNLU = {
    intent: "PROVIDE_INFORMATION",
    behavior: "NEUTRAL",
    confidence: 1.0,
    extracted: {},
    safety: { status: "NORMAL", category: null, confidence: 1.0 }
  };
  result = await processDemoUtterance({ session, utterance: "Yeah, that's right." }); // Confirm issue
  session = result.session;
  console.log(`Action: ${session.currentAction}`);
  console.log(`Prompt: "${result.response}"`);

  console.log("\n--- Turn 6: No final info & End (Phase 3) ---");
  currentMockNLU = {
    intent: "END_CALL",
    behavior: "NEUTRAL",
    confidence: 1.0,
    extracted: {},
    safety: { status: "NORMAL", category: null, confidence: 1.0 }
  };
  result = await processDemoUtterance({ session, utterance: "No that's all, thanks." });
  session = result.session;
  console.log(`State: ${session.state}`);
  console.log(`Action: ${session.currentAction}`);
  console.log(`Prompt: "${result.response}"`);

  console.log("\n--- Verify DB Updates ---");
  const requests = await db.findRequestsByCustomer(customer.id);
  console.log(`Open requests for customer: ${requests.length}`);
}

runTests().catch(console.error);
