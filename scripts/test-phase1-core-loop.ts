import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession, EngineRequest } from "../src/lib/demo-engine/types";

async function runTest() {
  console.log("=== PHASE 1 TEST: Same-turn extraction & Disclosure ===");
  
  // 1. Initial State
  let session = makeEmptySession("HVAC");
  let req: EngineRequest = {
    session,
    utterance: ""
  };
  
  let res = await processDemoUtterance(req);
  console.log("Regent:", res.response);
  
  // 2. Customer provides multiple fields in one turn
  console.log("\n--- Turn 1 ---");
  const utterance1 = "My AC isn't cooling and I need someone today. I'm John Smith. My number is 9876543210 and I'm at 15 Main Street, Dallas 75201.";
  console.log("Customer:", utterance1);
  
  req = {
    session: res.session,
    utterance: utterance1
  };
  
  res = await processDemoUtterance(req);
  console.log("Regent:", res.response);
  
  if (res.response.includes("this call is recorded")) {
    console.log("✅ Disclosure included in first response.");
  } else {
    console.error("❌ Disclosure missing!");
  }
  
  if (res.session.recordingDisclosureGiven === true) {
    console.log("✅ Session state recorded disclosure.");
  } else {
    console.error("❌ Session state did not record disclosure!");
  }

  const lead = res.session.lead;
  console.log("\nExtracted Fields:");
  console.log("Name:", lead.name?.value, "Status:", lead.name?.status);
  console.log("Phone:", lead.phone?.value, "Status:", lead.phone?.status);
  console.log("Address:", lead.address?.value, "Status:", lead.address?.status);
  console.log("Problem:", lead.problem?.value, "Status:", lead.problem?.status);
  console.log("Urgency:", lead.urgency?.value, "Status:", lead.urgency?.status);
  console.log("Request Type:", res.session.requestType);
  console.log("Primary Service:", res.session.primaryService);
  
  const hasName = lead.name?.status === "VALID" || lead.name?.status === "CAPTURED";
  const hasPhone = lead.phone?.status === "VALID" || lead.phone?.status === "CAPTURED";
  const hasAddress = lead.address?.status === "VALID" || lead.address?.status === "CAPTURED";
  const hasProblem = lead.problem?.status === "VALID" || lead.problem?.status === "CAPTURED";
  const hasUrgency = lead.urgency?.status === "VALID" || lead.urgency?.status === "CAPTURED";
  
  if (hasName && hasPhone && hasAddress && hasProblem && hasUrgency && res.session.primaryService === "AC_REPAIR" && res.session.requestType === "REPAIR") {
    console.log("✅ All fields correctly extracted in one turn!");
  } else {
    console.error("❌ Failed to extract all fields in one turn.");
  }
  
  // 3. Customer answers the follow-up
  console.log("\n--- Turn 2 ---");
  const utterance2 = "I need it installed today.";
  console.log("Customer:", utterance2);
  req = {
    session: res.session,
    utterance: utterance2
  };
  res = await processDemoUtterance(req);
  console.log("Regent:", res.response);
  
  if (!res.response.includes("this call is recorded")) {
    console.log("✅ Disclosure NOT repeated on second turn.");
  } else {
    console.error("❌ Disclosure was repeated!");
  }
  
  console.log("\n=== TEST COMPLETE ===");
}

runTest().catch(console.error);
