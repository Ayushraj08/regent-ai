import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession, EngineRequest } from "../src/lib/demo-engine/types";

async function runTest() {
  console.log("=== PHASE 2 TEST: 2-Change Limit & Confirmation ===");
  
  let session = makeEmptySession("HVAC");
  // Pre-fill session to simulate completion
  session.state = "AWAITING_ISSUE_CONFIRMATION";
  session.currentAction = "CONFIRM_REQUEST";
  session.turnCount = 5;
  session.lead.name = { value: "John", status: "CAPTURED", confidence: 1, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session.lead.phone = { value: "1234567890", status: "CAPTURED", confidence: 1, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session.lead.address = { value: "123 St", status: "CAPTURED", confidence: 1, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session.lead.problem = { value: "AC broken", status: "CAPTURED", confidence: 1, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session.lead.urgency = { value: "HIGH", status: "CAPTURED", confidence: 1, sourceTurn: 1, updatedTurn: 1, turn: 1 };
  session.requestType = "REPAIR";
  session.primaryService = "AC_REPAIR";

  let req: EngineRequest = {
    session,
    utterance: "No, actually my name is Jane"
  };
  
  console.log("Customer: ", req.utterance);
  
  let res = await processDemoUtterance(req);
  console.log("Regent State:", res.state, "Action:", res.currentAction);
  console.log("Regent:", res.response);
  
  if (res.state === "COLLECTING" || res.session.corrections.length > 0) {
    console.log("✅ Dropped back into COLLECTING and registered correction.");
  } else {
    console.error("❌ Did not drop back to collecting upon correction.");
  }

  // Force 3 corrections
  res.session.corrections.push({ field: "phone", oldValue: "1", newValue: "2", turn: 6 });
  res.session.corrections.push({ field: "address", oldValue: "1", newValue: "2", turn: 6 });
  res.session.corrections.push({ field: "name", oldValue: "1", newValue: "2", turn: 6 });
  
  req = {
    session: res.session,
    utterance: "Actually, change my address again"
  };
  console.log("\nCustomer: ", req.utterance);
  res = await processDemoUtterance(req);
  console.log("Regent State:", res.state, "Action:", res.currentAction);
  console.log("Regent:", res.response);
  
  if (res.state === "TRANSFER" && res.currentAction === "HANDLE_HUMAN_REQUEST") {
    console.log("✅ Successfully escalated after >2 corrections.");
  } else {
    console.error("❌ Failed to escalate on 3rd correction.");
  }
}

runTest().catch(console.error);
