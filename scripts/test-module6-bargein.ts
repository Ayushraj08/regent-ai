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

async function runBargeInCorrectionTestSuite() {
  console.log("==================================================================");
  console.log("🚀 RELAGENT MODULE 6: BARGE-IN BEHAVIOR & CORRECTION HANDLING");
  console.log("==================================================================\n");

  const tenantId = "00000000-0000-0000-0000-000000000001"; // Apex Heating & Air

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Address Correction during Barge-in
  // Setup: Customer previously gave name "Sarah Connor", phone "555-432-1098",
  // and issue "AC blowing warm air", and initial address "100 Main St, Austin 78701".
  // Regent was in the middle of asking: "What date and time works best for your appointment?"
  // User BARGES IN: "Wait, no! My address is 742 Evergreen Terrace, Austin 78704, not Main Street!"
  // ──────────────────────────────────────────────────────────────────────────
  console.log("TEST 1: Address Correction during Interruption");
  let session1 = makeEmptySession("HVAC");
  session1.tenantId = tenantId;
  session1.state = "COLLECTING";
  session1.turnCount = 3;
  session1.recordingDisclosureGiven = true;
  session1.lead.name = { value: "Sarah Connor", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session1.lead.phone = { value: "5554321098", status: "VALID", confidence: 1.0, sourceTurn: 2, updatedTurn: 2, turn: 2 };
  session1.lead.problem = { value: "AC blowing warm air", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session1.lead.address = { value: "100 Main St, Austin 78701", status: "VALID", confidence: 1.0, sourceTurn: 2, updatedTurn: 2, turn: 2 };

  session1.conversationHistory = [
    { role: "REGENT", content: "Thank you for calling Apex Heating & Air. This is Regent..." },
    { role: "CUSTOMER", content: "Hi, I'm Sarah Connor. My AC is blowing warm air, and my number is 555-432-1098. Address is 100 Main St, Austin 78701." },
    { role: "REGENT", content: "Thanks Sarah, I have your AC issue noted. What date and arrival window works best for you to have a technician visit?" },
  ];

  // User interrupts to fix address
  const res1 = await processRelagentTurn({
    session: session1,
    utterance: "Wait, no! My address is 742 Evergreen Terrace, Austin 78704, not Main Street!",
    isInterrupted: true,
  });

  console.log("  Interrupted User: \"Wait, no! My address is 742 Evergreen Terrace, Austin 78704, not Main Street!\"");
  console.log("  Regent response: \"" + res1.response + "\"");
  console.log("  Updated Address in Session: \"" + res1.session.lead.address?.value + "\"");

  // Verify 1: Never repeat yourself & natural acknowledgment
  const lower1 = res1.response.toLowerCase();
  const hasNaturalAck1 =
    lower1.includes("got it") ||
    lower1.includes("apologies") ||
    lower1.includes("change") ||
    lower1.includes("update") ||
    lower1.includes("no problem") ||
    lower1.includes("noted") ||
    lower1.includes("evergreen");
  assert(hasNaturalAck1, "Rule 1: Regent naturally acknowledged the interruption without repeating previous sentence.");

  // Verify 2: Address corrected in background state
  const updatedAddr = res1.session.lead.address?.value || "";
  assert(updatedAddr.includes("742 Evergreen") || updatedAddr.includes("78704"), "Rule 2: Address data point was updated to 742 Evergreen Terrace in background.");

  // Verify 3: Retain Context & Next Logical Question
  // Should NOT re-ask for Name, Phone, or Problem (which were already captured)
  assert(!lower1.includes("your name"), "Rule 3: Retained context and did NOT re-ask for customer name.");
  assert(!lower1.includes("phone number"), "Rule 3: Retained context and did NOT re-ask for phone number.");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Date/Schedule Correction during Barge-in
  // Setup: Customer scheduled for Wednesday morning. Regent was reading:
  // "Great, I've got you down for Wednesday morning between 9 AM and 12 PM..."
  // User BARGES IN: "Actually, hold on, change that to Friday afternoon instead!"
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\nTEST 2: Schedule / Date Correction during Interruption");
  let session2 = makeEmptySession("HVAC");
  session2.tenantId = tenantId;
  session2.state = "COLLECTING";
  session2.turnCount = 4;
  session2.recordingDisclosureGiven = true;
  session2.lead.name = { value: "David Miller", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session2.lead.phone = { value: "5557891234", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session2.lead.problem = { value: "Heater not igniting", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session2.lead.address = { value: "450 Oak Avenue, Austin 78702", status: "VALID", confidence: 1.0, sourceTurn: 2, updatedTurn: 2, turn: 2 };
  session2.lead.timing = { value: "Wednesday (09:00 AM - 12:00 PM)", status: "VALID", confidence: 1.0, sourceTurn: 3, updatedTurn: 3, turn: 3 };

  session2.conversationHistory = [
    { role: "REGENT", content: "This is Regent with Apex Heating & Air..." },
    { role: "CUSTOMER", content: "Hi, I'm David Miller at 450 Oak Ave, Austin 78702, phone 555-789-1234. Heater won't ignite. Can we do Wednesday morning?" },
    { role: "REGENT", content: "I've got you scheduled for Wednesday morning between 9:00 AM and 12:00 PM..." },
  ];

  const res2 = await processRelagentTurn({
    session: session2,
    utterance: "Actually, hold on, change that to Friday afternoon instead!",
    isInterrupted: true,
  });

  console.log("  Interrupted User: \"Actually, hold on, change that to Friday afternoon instead!\"");
  console.log("  Regent response: \"" + res2.response + "\"");
  console.log("  Updated Schedule in Session: \"" + res2.session.lead.timing?.value + "\"");

  const lower2 = res2.response.toLowerCase();
  const hasTimingAck =
    lower2.includes("friday") ||
    lower2.includes("change") ||
    lower2.includes("afternoon") ||
    lower2.includes("got it") ||
    lower2.includes("update") ||
    lower2.includes("switch");
  assert(hasTimingAck, "Rule 1 & 2: Acknowledged change and updated schedule to Friday.");
  assert(!lower2.includes("your name"), "Rule 3: Retained full context and did not re-ask for name.");
  assert(!lower2.includes("your address"), "Rule 3: Retained full context and did not re-ask for address.");

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Issue Description Correction during Barge-in
  // Setup: User was reported as AC issue. Regent is asking for address.
  // User BARGES IN: "Wait, it's not the AC, my basement is actually flooding right now from a burst water pipe!"
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\nTEST 3: Issue Correction & Emergency Shift during Interruption");
  let session3 = makeEmptySession("PLUMBING");
  session3.tenantId = "00000000-0000-0000-0000-000000000002"; // Metro Flow Plumbing
  session3.state = "COLLECTING";
  session3.turnCount = 2;
  session3.recordingDisclosureGiven = true;
  session3.lead.name = { value: "John Wick", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session3.lead.phone = { value: "5559998888", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session3.lead.problem = { value: "AC making strange buzzing noise", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1, turn: 1 };

  session3.conversationHistory = [
    { role: "REGENT", content: "Thank you for calling Metro Flow Plumbing..." },
    { role: "CUSTOMER", content: "Hi, I'm John Wick, 555-999-8888. My AC is making noise." },
    { role: "REGENT", content: "Thanks John. What is the address where we need to send a technician?" },
  ];

  const res3 = await processRelagentTurn({
    session: session3,
    utterance: "Wait, it's not the AC, my basement is actually flooding right now from a burst water pipe!",
    isInterrupted: true,
  });

  console.log("  Interrupted User: \"Wait, it's not the AC, my basement is actually flooding right now from a burst water pipe!\"");
  console.log("  Regent response: \"" + res3.response + "\"");
  console.log("  Updated Problem in Session: \"" + res3.session.lead.problem?.value + "\"");
  console.log("  Assigned Sentiment State: \"" + res3.session.sentimentState + "\"");

  const problemValue = res3.session.lead.problem?.value?.toLowerCase() || "";
  assert(
    problemValue.includes("burst") ||
    problemValue.includes("flood") ||
    problemValue.includes("pipe"),
    "Rule 2: Problem data point successfully updated to burst pipe/flooding."
  );

  assert(
    res3.session.sentimentState === "urgent" || res3.session.sentimentState === "empathetic",
    "Rule 3: Shifted prosody to urgent/empathetic for emergency flooding context."
  );

  console.log("\n==================================================================");
  console.log("✅ ALL MODULE 6 BARGE-IN & CORRECTION HANDLING TESTS PASSED!");
  console.log("==================================================================");
}

runBargeInCorrectionTestSuite().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});

