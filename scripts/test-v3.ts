import { evaluatePolicy } from "../src/lib/demo-engine/controller/policy-engine";
import { generateResponse } from "../src/lib/demo-engine/controller/response-generator";
import { EngineRequest, NLUResponse } from "../src/lib/demo-engine/types";

// Base request
const req1: EngineRequest = {
  utterance: "",
  state: "INTENT",
  turnCount: 1,
  trade: "HVAC",
  lead: {
    trade: "HVAC",
    name: { value: "John", status: "CAPTURED", confidence: 1, turn: 1 },
    phone: { value: "5551234567", status: "CAPTURED", confidence: 1, turn: 1 },
    address: { value: "123 Main St", status: "CAPTURED", confidence: 1, turn: 1 },
    requestType: { value: null, status: "MISSING", confidence: 0, turn: 0 },
    service: { value: "AC_REPAIR", status: "CAPTURED", confidence: 1, turn: 1 },
    problem: { value: null, status: "MISSING", confidence: 0, turn: 0 },
    urgency: { value: "Today", status: "CAPTURED", confidence: 1, turn: 1 }
  },
  conversationHistory: []
};

// 1. Installation Regression (Should not ask for problem)
const nluInstall: NLUResponse = {
  intent: "NEW_SERVICE_REQUEST",
  behavior: "NEUTRAL",
  confidence: 0.9,
  safety: { status: "NORMAL", category: null, confidence: 1.0 },
  extracted: {
    requestType: { value: "INSTALLATION", status: "CAPTURED", confidence: 0.9, turn: 1 },
    service: { value: "AC_INSTALLATION", status: "CAPTURED", confidence: 0.9, turn: 1 }
  }
};
console.log("\n--- TEST 1: INSTALLATION (Missing Fields Check) ---");
const policyInstall = evaluatePolicy(req1, nluInstall);
console.log("Missing fields:", policyInstall.missingFields);
console.log("Does it ask for problem?:", policyInstall.missingFields?.includes("problem"));
console.log("Response text:", generateResponse(policyInstall.responseType as string, nluInstall.behavior, policyInstall.missingFields || [], policyInstall.extracted as any));

// 2. Repair Regression
const nluRepair: NLUResponse = {
  intent: "NEW_SERVICE_REQUEST",
  behavior: "NEUTRAL",
  confidence: 0.9,
  safety: { status: "NORMAL", category: null, confidence: 1.0 },
  extracted: {
    requestType: { value: "REPAIR", status: "CAPTURED", confidence: 0.9, turn: 1 },
    service: { value: "AC_REPAIR", status: "CAPTURED", confidence: 0.9, turn: 1 }
  }
};
console.log("\n--- TEST 2: REPAIR (Missing Fields Check) ---");
const policyRepair = evaluatePolicy(req1, nluRepair);
console.log("Missing fields:", policyRepair.missingFields);
console.log("Does it ask for problem?:", policyRepair.missingFields?.includes("problem"));

// 3. Maintenance Regression
const nluMaint: NLUResponse = {
  intent: "NEW_SERVICE_REQUEST",
  behavior: "NEUTRAL",
  confidence: 0.9,
  safety: { status: "NORMAL", category: null, confidence: 1.0 },
  extracted: {
    requestType: { value: "MAINTENANCE", status: "CAPTURED", confidence: 0.9, turn: 1 },
    service: { value: "AC_MAINTENANCE", status: "CAPTURED", confidence: 0.9, turn: 1 }
  }
};
console.log("\n--- TEST 3: MAINTENANCE (Missing Fields Check) ---");
const policyMaint = evaluatePolicy(req1, nluMaint);
console.log("Does it ask for problem?:", policyMaint.missingFields?.includes("problem"));

// 4. End Request Priority
const reqEnd: EngineRequest = {
  ...req1,
  utterance: "That's all, bye.",
  state: "ANYTHING_ELSE",
  lead: {
    ...req1.lead,
    name: { value: "Ayush", status: "CAPTURED", confidence: 1, turn: 1 },
    phone: { value: "5555555555", status: "CAPTURED", confidence: 1, turn: 1 },
    address: { value: "123 Main St", status: "CAPTURED", confidence: 1, turn: 1 },
    requestType: { value: "REPAIR", status: "CAPTURED", confidence: 1, turn: 1 },
    service: { value: "AC_REPAIR", status: "CAPTURED", confidence: 1, turn: 1 },
    problem: { value: "Broken", status: "CAPTURED", confidence: 1, turn: 1 },
    urgency: { value: "Today", status: "CAPTURED", confidence: 1, turn: 1 },
  }
};
const nluEnd: NLUResponse = {
  intent: "CANCELLATION",
  behavior: "NEUTRAL",
  confidence: 0.9,
  safety: { status: "NORMAL", category: null, confidence: 1.0 },
  extracted: {}
};
console.log("\n--- TEST 4: EXPLICIT END SIGNAL ---");
const policyEnd = evaluatePolicy(reqEnd, nluEnd);
console.log("Response Type:", policyEnd.responseType);
console.log("State:", policyEnd.state);
console.log("Response text:", generateResponse(policyEnd.responseType as string, nluEnd.behavior, policyEnd.missingFields || [], policyEnd.extracted as any));
