import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession, ConversationSession } from "../src/lib/demo-engine/types";
import { validateLeadForCompletion } from "../src/lib/demo-engine/controller/completion-gate";
import assert from "assert";

async function runTests() {
  console.log("Running Phase 3 Automated Invariants & Regressions...\n");

  let session: ConversationSession;
  let res;

  // ─── REGRESSION: Exact Overhandling Regression ─────────────────────────────
  console.log("Test: Exact Overhandling Regression (Repair flow)");
  session = makeEmptySession("HVAC");
  session.lead.name = { value: "Ayush", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.lead.phone = { value: "1234567890", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.lead.address = { value: "123 Main St", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.lead.problem = { value: "AC stopped cooling", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.lead.urgency = { value: "today", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.requestType = "REPAIR";
  session.primaryService = "AC_REPAIR";
  session.state = "COLLECTING";

  // Force evaluate completion
  const comp = validateLeadForCompletion(session);
  console.log("Completion Output:", comp);
  assert(comp.complete === true, "Invariant 1 Failed: Lead should be complete");
  console.log("✔ Invariant 1: Complete lead recognized.");

  // Turn 1: Any utterance triggers issue confirmation
  res = await processDemoUtterance({ session, utterance: "Hello" });
  console.log("RES STATE IS:", res.state, "ACTION IS:", res.action);
  assert(res.state === "AWAITING_ISSUE_CONFIRMATION", `State should be AWAITING_ISSUE_CONFIRMATION, got ${res.state}`);
  assert(res.action === "CONFIRM_ISSUE", "Action should be CONFIRM_ISSUE");
  console.log("✔ Expected: lead becomes READY_FOR_CONFIRMATION -> AWAITING_ISSUE_CONFIRMATION");
  
  // Turn 2: Customer confirms
  session = res.session;
  res = await processDemoUtterance({ session, utterance: "Yes, that's correct." });
  console.log("TURN 2 RES STATE IS:", res.state, "ACTION IS:", res.action);
  assert(res.state === "WAITING_FOR_FINAL_INPUT" || res.state === "TICKET_CREATED", "State should progress to final review");
  assert(res.ticketId !== null, "Invariant 7 Failed: Ticket must be generated");
  const firstTicket = res.ticketId;
  console.log("✔ Customer confirmed. Ticket generated:", res.ticketId);

  // Turn 3: Customer says no to "anything else"
  session = res.session;
  res = await processDemoUtterance({ session, utterance: "No." });
  assert(res.state === "CLOSED", "Expected state to be CLOSED after saying no to anything else.");
  assert(res.ticketId === firstTicket, "Ticket ID should not change.");
  console.log("✔ Overhandling prevented: Closed gracefully without unnecessary 'Can I end the call?' questions.");

  // ─── REGRESSION: Exact Installation Regression ──────────────────────────────
  console.log("\nTest: Exact Installation Regression");
  session = makeEmptySession("HVAC");
  session.lead.name = { value: "Ayush", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.lead.phone = { value: "1234567890", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.lead.address = { value: "123 Main St", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.lead.urgency = { value: "today", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.requestType = "INSTALLATION";
  session.primaryService = "AC_INSTALLATION";
  session.state = "COLLECTING";
  
  const compInst = validateLeadForCompletion(session);
  assert(compInst.complete === true, "Invariant 3 Failed: Problem is NOT required for installation, should be complete.");
  console.log("✔ Invariant 3: Problem not required for INSTALLATION.");

  res = await processDemoUtterance({ session, utterance: "I need AC installation." });
  assert(res.action === "CONFIRM_ISSUE");
  assert(!res.response.includes("problem") && !res.response.includes("wrong"), "Confirmation should not ask for a problem.");
  console.log("✔ Installation confirmation does not ask for a problem.");

  // ─── REGRESSION: Explicit End Regression ────────────────────────────────────
  console.log("\nTest: Explicit End Regression");
  session = makeEmptySession("HVAC");
  session.lead.name = { value: "Ayush", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.lead.phone = { value: "1234567890", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.lead.address = { value: "123 Main St", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.lead.problem = { value: "AC stopped cooling", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.lead.urgency = { value: "today", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  session.requestType = "REPAIR";
  session.primaryService = "AC_REPAIR";
  session.state = "COLLECTING";

  res = await processDemoUtterance({ session, utterance: "Everything is done. We can end this call now." });
  assert(res.state === "CLOSED", "State should be CLOSED");
  assert(res.ticketId !== null, "Ticket should be generated dynamically before closing.");
  console.log("✔ Invariant 6: Explicit goodbye bypasses closing questions and generates ticket: " + res.ticketId);

  // ─── INVARIANT: Missing required field blocks completion ────────────────────
  console.log("\nTest: Invariant 2 - Missing field blocks completion");
  session = makeEmptySession("HVAC");
  session.lead.name = { value: "Ayush", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
  // Missing phone, address, etc.
  
  const compInc = validateLeadForCompletion(session);
  assert(compInc.complete === false, "Invariant 2 Failed: Should be incomplete");
  console.log("✔ Invariant 2: Missing field correctly blocks completion.");

  console.log("\nAll tests passed successfully.");
}

runTests().catch(console.error);
