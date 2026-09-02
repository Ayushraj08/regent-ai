import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession, EngineRequest } from "../src/lib/demo-engine/types";

async function runPhase3Harness() {
  console.log("===============================================================");
  console.log("    RELAGENT PHASE 3: DATE/TIME RESOLUTION & AMBIGUITY HARNESS ");
  console.log("===============================================================\n");

  let session = makeEmptySession("HVAC");
  // Set reference date in session context so we can precisely test the "Wednesday on Wednesday" rule
  // 2026-09-02 was a Wednesday
  session.lead.context = {
    value: "REF_DATE:2026-09-02T10:00:00Z",
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

  // Turn 1: Customer provides all contact & issue info, but no date yet
  console.log("\n--- Turn 1: Customer provides Info ---");
  const utterance1 = "Hi, I am Ayush Sharma, phone is 415-555-0199, living at 1200 Market Street, Dallas 75201. My AC unit is blowing hot air.";
  console.log("Customer:", utterance1);
  res = await processDemoUtterance({ session, utterance: utterance1 });
  session = res.session;
  console.log("Agent:", res.response);

  // Turn 2: Customer specifies ambiguous day matching reference date ("Wednesday" on Wednesday)
  console.log("\n--- Turn 2: Ambiguous Day-of-Week Test ('Wednesday' on Wednesday) ---");
  const utterance2 = "Can someone come out on Wednesday?";
  console.log("Customer:", utterance2);
  res = await processDemoUtterance({ session, utterance: utterance2 });
  session = res.session;
  console.log("Agent:", res.response);
  console.log("Timing Status:", session.lead.timing?.status);
  console.log("Timing Reason:", session.lead.timing?.validationReason);

  const askedClarification =
    res.response.toLowerCase().includes("today") &&
    res.response.toLowerCase().includes("next week");
  console.log("✅ Did the agent ask 'Do you mean today, or next week Wednesday?'", askedClarification);

  // Turn 3: Customer clarifies "next week Wednesday"
  console.log("\n--- Turn 3: Customer Clarifies ('next week Wednesday') ---");
  const utterance3 = "I mean next week Wednesday.";
  console.log("Customer:", utterance3);
  res = await processDemoUtterance({ session, utterance: utterance3 });
  session = res.session;
  console.log("Agent:", res.response);
  console.log("Timing Value:", session.lead.timing?.value);
  console.log("Timing Status:", session.lead.timing?.status);
  console.log("Timing Reason:", session.lead.timing?.validationReason);

  const isExactYYYYMMDD = Boolean(session.lead.timing?.value?.includes("2026-09-09"));
  console.log("✅ Resolved to exact date '2026-09-09'?", isExactYYYYMMDD);
  console.log("✅ Timing status is VALID?", session.lead.timing?.status === "VALID");
  console.log("Missing fields now:", session.missingFields);

  // Test 4: Another session testing "tomorrow afternoon"
  console.log("\n--- Test 4: Relative Date 'tomorrow afternoon' ---");
  let session2 = makeEmptySession("PLUMBING");
  session2.lead.context = {
    value: "REF_DATE:2026-09-02T10:00:00Z",
    status: "CAPTURED",
    confidence: 1,
    sourceTurn: 0,
    updatedTurn: 0,
    turn: 0,
  };
  const resTurn0 = await processDemoUtterance({ session: session2, utterance: "" });
  session2 = resTurn0.session;
  const res2 = await processDemoUtterance({
    session: session2,
    utterance: "I need a plumber tomorrow afternoon at 2 PM.",
  });
  console.log("Agent:", res2.response);
  console.log("Timing Value:", res2.session.lead.timing?.value);
  console.log("Timing Reason:", res2.session.lead.timing?.validationReason);
  const tomorrowResolved = Boolean(res2.session.lead.timing?.value?.includes("2026-09-03"));
  console.log("✅ Tomorrow resolved to 2026-09-03?", tomorrowResolved);

  console.log("\n===============================================================");
  console.log("              PHASE 3 VERIFICATION COMPLETE                   ");
  console.log("===============================================================\n");
}

runPhase3Harness().catch(console.error);
