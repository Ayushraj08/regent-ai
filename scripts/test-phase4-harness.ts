import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession, EngineRequest } from "../src/lib/demo-engine/types";

async function runPhase4Harness() {
  console.log("===============================================================");
  console.log("    RELAGENT PHASE 4: CONFIRMATION, TICKET ID & WRAP-UP HARNESS ");
  console.log("===============================================================\n");

  let session = makeEmptySession("HVAC");
  session.lead.context = {
    value: "REF_DATE:2026-09-03T10:00:00Z",
    status: "CAPTURED",
    confidence: 1,
    sourceTurn: 0,
    updatedTurn: 0,
    turn: 0,
  };

  // Turn 0: Greeting
  let res = await processDemoUtterance({ session, utterance: "" });
  session = res.session;
  console.log("Turn 0 (Greeting):", res.response);

  // Turn 1: Customer provides all required details
  console.log("\n--- Turn 1: Customer Provides All Slots ---");
  const utterance1 =
    "Hi, I'm Sarah Connor. My phone is 415-555-0199 and I'm at 1200 Market Street, Dallas 75201. My AC is blowing warm air and I need someone tomorrow afternoon at 2 PM.";
  console.log("Customer:", utterance1);
  res = await processDemoUtterance({ session, utterance: utterance1 });
  session = res.session;
  console.log("Agent:", res.response);
  console.log("State after Turn 1:", session.state);
  console.log("Missing fields:", session.missingFields);

  const askedConfirmation =
    res.response.toLowerCase().includes("does that look correct") ||
    res.response.toLowerCase().includes("need to change anything");
  console.log("✅ Summarized and asked binary confirmation?", askedConfirmation);

  // Turn 2: Customer requests Change #1 (Phone change)
  console.log("\n--- Turn 2: Change #1 (Updating Phone Number) ---");
  const utterance2 = "Actually, could you change the phone number to 415-555-8888 instead?";
  console.log("Customer:", utterance2);
  res = await processDemoUtterance({ session, utterance: utterance2 });
  session = res.session;
  console.log("Agent:", res.response);
  console.log("Updated Phone in State:", session.lead.phone?.value);
  console.log("Corrections Count:", session.corrections.length);

  const phoneUpdated = session.lead.phone?.value === "4155558888";
  console.log("✅ Phone updated correctly?", phoneUpdated);
  console.log("✅ Re-asked confirmation?", res.response.toLowerCase().includes("does that look correct") || res.response.toLowerCase().includes("change anything"));

  // Turn 3: Customer Confirms ("Yes, that looks correct")
  console.log("\n--- Turn 3: Customer Confirms ---");
  const utterance3 = "Yes, that looks correct!";
  console.log("Customer:", utterance3);
  res = await processDemoUtterance({ session, utterance: utterance3 });
  session = res.session;
  console.log("Agent:", res.response);
  console.log("Session State:", session.state);
  console.log("Generated Ticket ID:", session.ticketId);

  const ticketRegex = /^TKT-\d{8}-[A-Z0-9]{4}$/;
  const isTicketValid = Boolean(session.ticketId && ticketRegex.test(session.ticketId));
  console.log("✅ Deterministic ticket ID matches format TKT-YYYYMMDD-XXXX?", isTicketValid, `(${session.ticketId})`);
  console.log("✅ Agent asked to wrap up ('anything else')?", res.response.toLowerCase().includes("anything else"));

  // Turn 4: Wrap-up and End Call
  console.log("\n--- Turn 4: Wrap-up and End Call ---");
  const utterance4 = "No, that's all. Thank you!";
  console.log("Customer:", utterance4);
  res = await processDemoUtterance({ session, utterance: utterance4 });
  session = res.session;
  console.log("Agent:", res.response);
  console.log("Session State:", session.state);
  console.log("Call Complete?", res.complete);

  console.log("✅ State is CLOSED?", session.state === "CLOSED");
  console.log("✅ res.complete is TRUE?", res.complete === true);

  // ─── Test Max 2 Changes Flow ────────────────────────────────────────────────
  console.log("\n--- Sub-test: Max 2 Changes Enforcement ---");
  let sessionMax = makeEmptySession("HVAC");
  sessionMax.lead.context = {
    value: "REF_DATE:2026-09-03T10:00:00Z",
    status: "CAPTURED",
    confidence: 1,
    sourceTurn: 0,
    updatedTurn: 0,
    turn: 0,
  };
  let r = await processDemoUtterance({ session: sessionMax, utterance: "" });
  r = await processDemoUtterance({
    session: r.session,
    utterance: "I am John Doe, phone 555-123-4567, address 100 Elm St, Dallas 75201, AC broken, tomorrow at 3pm.",
  });
  console.log("Initial state:", r.session.state);
  console.log("Initial missing fields:", r.session.missingFields);
  console.log("Initial timing:", r.session.lead.timing);

  // Change 1
  r = await processDemoUtterance({
    session: r.session,
    utterance: "Change my name to Johnny Doe.",
  });
  console.log("After Change 1:", r.session.corrections.length, "corrections. State:", r.session.state);

  // Change 2
  r = await processDemoUtterance({
    session: r.session,
    utterance: "Change my phone to 555-987-6543.",
  });
  console.log("After Change 2:", r.session.corrections.length, "corrections. State:", r.session.state);

  // Attempt Change 3 (Limit reached)
  r = await processDemoUtterance({
    session: r.session,
    utterance: "Change my address to 200 Oak St.",
  });
  console.log("After Attempting Change 3 Agent:", r.response);
  console.log("State:", r.session.state, "| Ticket ID:", r.session.ticketId);

  const maxChangesLocked = r.session.ticketId && ticketRegex.test(r.session.ticketId);
  console.log("✅ Max 2 changes enforced and ticket locked in?", Boolean(maxChangesLocked));

  console.log("\n===============================================================");
  console.log("              PHASE 4 VERIFICATION COMPLETE                   ");
  console.log("===============================================================\n");
}

runPhase4Harness().catch(console.error);
