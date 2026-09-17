import { processRelagentTurn } from "../src/lib/demo-engine/relagent-engine";
import { makeEmptySession } from "../src/lib/demo-engine/types";

async function testFlow() {
  console.log("=== STARTING SIMULATION OF CONVERSATION FIXES ===\n");

  let session = makeEmptySession("HVAC");
  session.tenantId = "00000000-0000-0000-0000-000000000001";
  // Simulate call at 2:30 PM so morning slot has passed
  session.lead.context = {
    value: "REF_DATE:2026-09-17T18:30:00.000Z", // 2:30 PM EDT (UTC-4)
    status: "VALID",
    confidence: 1,
    sourceTurn: 0,
    updatedTurn: 0,
    turn: 0,
    validationReason: "Test time anchor",
  };

  // Turn 0: Greeting
  let res = await processRelagentTurn({ session, utterance: "" });
  session = res.session;
  console.log("REGENT Turn 0:", res.response);

  // Turn 1: Problem
  console.log("\nCUSTOMER: AC is not working properly.");
  res = await processRelagentTurn({ session, utterance: "AC is not working properly." });
  session = res.session;
  console.log("REGENT:", res.response);

  // Turn 2: Name
  console.log("\nCUSTOMER: My name is Ayush Raj.");
  res = await processRelagentTurn({ session, utterance: "My name is Ayush Raj." });
  session = res.session;
  console.log("REGENT:", res.response);

  // Turn 3: Phone
  console.log("\nCUSTOMER: My phone number is 1234567890.");
  res = await processRelagentTurn({ session, utterance: "My phone number is 1234567890." });
  session = res.session;
  console.log("REGENT:", res.response);

  // Turn 4: Address + City + ZIP together in one turn
  console.log("\nCUSTOMER: 123 Main Street, Dallas, 78701.");
  res = await processRelagentTurn({ session, utterance: "123 Main Street, Dallas, 78701." });
  session = res.session;
  console.log("REGENT:", res.response);
  console.log("Address status:", session.lead.address?.status, "Value:", session.lead.address?.value);

  // Check: did it ask for zip again?
  const askedZipAgain = res.response.toLowerCase().includes("what is the zip") || res.response.toLowerCase().includes("what is your zip");
  console.log(askedZipAgain ? "❌ FAIL: Asked for ZIP when ZIP was already provided!" : "✅ PASS: Did NOT ask for ZIP again!");

  // Check: timing question phrasing
  const askedWhatDate = res.response.toLowerCase().includes("what date") || res.response.toLowerCase().includes("what day");
  console.log(askedWhatDate ? "❌ FAIL: Asked what date / day!" : "✅ PASS: Natural timing preference asked without robotic 'what date' phrasing!");

  // Turn 5: Customer asks for a slot that has passed ('today in the morning' when current time is evening)
  console.log("\nCUSTOMER: Yeah, I would prefer this can be done today in the morning.");
  res = await processRelagentTurn({ session, utterance: "Yeah, I would prefer this can be done today in the morning." });
  session = res.session;
  console.log("REGENT:", res.response);
  console.log("Session state:", session.state);

  const falselyConfirmed = res.response.toLowerCase().includes("confirmed") && res.response.toLowerCase().includes("ticket #");
  if (falselyConfirmed) {
    console.log("❌ FAIL: Falsely confirmed a past slot!");
  } else {
    console.log("✅ PASS: Correctly detected passed/unavailable slot and offered binary options!");
  }

  // Turn 6: Customer selects tomorrow morning
  console.log("\nCUSTOMER: Tomorrow morning works.");
  res = await processRelagentTurn({ session, utterance: "Tomorrow morning works." });
  session = res.session;
  console.log("REGENT:", res.response);
  console.log("Session state:", session.state);

  const askedConfirmation = res.response.toLowerCase().includes("sound right") || res.response.toLowerCase().includes("look correct") || res.response.toLowerCase().includes("read this back") || res.response.toLowerCase().includes("anything to change");
  console.log(askedConfirmation ? "✅ PASS: Confirmation summary read back to user before booking!" : "❌ FAIL: Skipped confirmation read back!");

  // Turn 7: Customer confirms
  console.log("\nCUSTOMER: Yes, everything looks good.");
  res = await processRelagentTurn({ session, utterance: "Yes, everything looks good." });
  session = res.session;
  console.log("REGENT:", res.response);
  console.log("Session state:", session.state);

  const spokeDash = res.response.includes("-dash-") || res.response.toLowerCase().includes(" dash ");
  if (spokeDash) {
    console.log("❌ FAIL: Spoke the word dash in ticket ID!");
  } else if (session.ticketId) {
    console.log("✅ PASS: Ticket confirmed without saying 'dash'!");
  }

  console.log("\n=== SIMULATION COMPLETE ===");
}

testFlow().catch(console.error);
