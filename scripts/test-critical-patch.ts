import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { processRelagentTurn } from "../src/lib/demo-engine/relagent-engine";
import { makeEmptySession } from "../src/lib/demo-engine/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

async function runCriticalPatchVerification() {
  console.log("==================================================================");
  console.log("🚀 RELAGENT CRITICAL PATCH VERIFICATION SUITE");
  console.log("==================================================================\n");

  const tenantId = "b0000000-0000-0000-0000-000000000001"; // Default tenant (fast cached)

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Preemptive ZIP Extraction (Address provided with ZIP)
  // Expected: Should NOT ask for ZIP code again!
  // ──────────────────────────────────────────────────────────────────────────
  console.log("TEST 1: Preemptive ZIP Code Extraction");
  let session1 = makeEmptySession("HVAC");
  session1.tenantId = tenantId;
  session1.state = "COLLECTING";
  session1.turnCount = 2;
  session1.recordingDisclosureGiven = true;
  session1.lead.problem = { value: "Refrigerator leaking water", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session1.lead.name = { value: "John Doe", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session1.lead.phone = { value: "5125551234", status: "VALID", confidence: 1.0, sourceTurn: 2, updatedTurn: 2, turn: 2 };

  session1.conversationHistory = [
    { role: "REGENT", content: "Thank you for calling. May I have your phone number?" },
    { role: "CUSTOMER", content: "Yes, it's 512-555-1234." },
    { role: "REGENT", content: "Thanks John. What is the service address where the refrigerator is located?" }
  ];

  const t0 = Date.now();
  const res1 = await processRelagentTurn({
    session: session1,
    utterance: "The address is 101 Congress Ave, Austin 78701.",
  });
  const elapsed1 = Date.now() - t0;

  console.log(`  Regent response: "${res1.response}" (took ${elapsed1}ms)`);
  console.log(`  Parsed Address:`, res1.session.lead.address?.value);

  // Assert address has zip
  assert(!!res1.session.lead.address?.value?.includes("78701"), "Address saved with ZIP 78701");
  // Assert response does NOT ask for ZIP
  const lowerResp1 = res1.response.toLowerCase();
  assert(!lowerResp1.includes("what is the zip") && !lowerResp1.includes("what's the zip") && !lowerResp1.includes("zip code"),
    "Does NOT re-prompt caller for ZIP code when preemptively given");
  // Assert response asks for date/time or scheduling
  assert(lowerResp1.includes("day") || lowerResp1.includes("date") || lowerResp1.includes("time") || lowerResp1.includes("tomorrow") || lowerResp1.includes("work best"),
    "Advances smoothly to scheduling");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Confirmation Gate & Final Wrap-Up (Native Tool Calling & Script)
  // Expected:
  // - Matches official wrap up script ("Perfect. Your appointment is confirmed under Ticket #...")
  // - No raw JSON leaked in speech
  // - complete: true and state: "CLOSED"
  // - Native end_call tool call present
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\nTEST 2: Confirmation Gate & Wrap-Up Sequence");
  let session2 = makeEmptySession("HVAC");
  session2.tenantId = tenantId;
  session2.state = "CONFIRMING";
  session2.turnCount = 4;
  session2.recordingDisclosureGiven = true;
  session2.lead.problem = { value: "Refrigerator leaking water", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session2.lead.name = { value: "John Doe", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session2.lead.phone = { value: "5125551234", status: "VALID", confidence: 1.0, sourceTurn: 2, updatedTurn: 2, turn: 2 };
  session2.lead.address = { value: "101 Congress Ave, Austin 78701", status: "VALID", confidence: 1.0, sourceTurn: 3, updatedTurn: 3, turn: 3 };
  session2.lead.preferredTime = { value: "Tomorrow morning at 10 AM", status: "VALID", confidence: 1.0, sourceTurn: 4, updatedTurn: 4, turn: 4 };

  session2.conversationHistory = [
    { role: "REGENT", content: "To confirm, I have John Doe for a refrigerator repair at 101 Congress Ave, Austin 78701 for tomorrow morning at 10 AM, callback at 512-555-1234. Does everything look correct?" }
  ];

  const t1 = Date.now();
  const res2 = await processRelagentTurn({
    session: session2,
    utterance: "Yes, that's completely correct!",
  });
  const elapsed2 = Date.now() - t1;

  console.log(`  Regent response: "${res2.response}" (took ${elapsed2}ms)`);
  console.log(`  Call Complete: ${res2.complete}`);
  console.log(`  Final Session State: ${res2.session.state}`);
  console.log(`  Ticket Created: ${res2.session.ticketId || "None"}`);
  console.log(`  Tool Calls:`, res2.toolCalls);

  // Assert no JSON in response
  assert(!res2.response.includes("{") && !res2.response.includes("function") && !res2.response.includes("end_call"),
    "Spoken text contains ZERO raw JSON leakage");
  // Assert official confirmation script components
  assert(res2.response.includes("Your appointment is confirmed under Ticket #"),
    "Spoken text includes official confirmation Ticket # script");
  assert(res2.response.includes("2 hours before arrival"),
    "Spoken text includes '2 hours before arrival' message");
  // Assert call termination
  assert(res2.complete === true, "res.complete is true");
  assert(res2.session.state === "CLOSED", "session.state is CLOSED");
  assert(res2.toolCalls?.some(tc => tc.name === "end_call") === true, "Native end_call tool call is emitted");

  console.log("\n==================================================================");
  console.log("🎉 ALL RELAGENT CRITICAL PATCH VERIFICATION TESTS PASSED!");
  console.log("==================================================================");
}

runCriticalPatchVerification().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
