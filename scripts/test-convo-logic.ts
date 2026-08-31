import { evaluatePolicy } from "../src/lib/demo-engine/controller/policy-engine";
import { generateResponse } from "../src/lib/demo-engine/controller/response-generator";
import { EngineRequest, NLUResponse } from "../src/lib/demo-engine/types";

// Simulate a silence request
const req1: EngineRequest = {
  sessionId: "test",
  utterance: "[SILENCE]",
  state: "LISTENING",
  turnCount: 1,
  trade: "HVAC",
  lead: {
    trade: "HVAC",
    name: { status: "MISSING" },
    phone: { status: "MISSING" },
    address: { status: "MISSING" },
    service: { status: "MISSING" },
    problem: { status: "MISSING" },
    urgency: { status: "MISSING" }
  },
  conversationHistory: []
};

const nlu1: NLUResponse = {
  intent: "UNSURE",
  behavior: "CONFUSED",
  confidence: 0.9,
  safety: { status: "NORMAL", category: null, confidence: 1.0 },
  extracted: {}
};

console.log("--- TEST 1: SILENCE ---");
const policy1 = evaluatePolicy(req1, nlu1);
console.log("Policy Response Type:", policy1.responseType);
console.log("Response text:", generateResponse(policy1.responseType as string, nlu1.behavior, policy1.missingFields || [], policy1.extracted as any));

// Simulate an angry user giving problem
const req2: EngineRequest = {
  ...req1,
  utterance: "My AC is broken and I've been waiting all day!",
  state: "COLLECTING_PROBLEM"
};

const nlu2: NLUResponse = {
  intent: "NEW_SERVICE_REQUEST",
  behavior: "ANGRY",
  confidence: 0.9,
  safety: { status: "NORMAL", category: null, confidence: 1.0 },
  extracted: {
    problem: { value: "AC is broken", status: "CAPTURED", confidence: 0.9, turn: 2 }
  }
};

console.log("\n--- TEST 2: ANGRY USER GIVING PROBLEM ---");
const policy2 = evaluatePolicy(req2, nlu2);
console.log("Missing fields:", policy2.missingFields);
console.log("Response Type:", policy2.responseType);
console.log("Response text:", generateResponse(policy2.responseType as string, nlu2.behavior, policy2.missingFields || [], policy2.extracted as any));

// Simulate an anxious user
const nlu3: NLUResponse = {
  intent: "NEW_SERVICE_REQUEST",
  behavior: "ANXIOUS",
  confidence: 0.9,
  safety: { status: "NORMAL", category: null, confidence: 1.0 },
  extracted: {
    problem: { value: "AC is broken", status: "CAPTURED", confidence: 0.9, turn: 3 }
  }
};

console.log("\n--- TEST 3: ANXIOUS USER GIVING PROBLEM ---");
const policy3 = evaluatePolicy(req2, nlu3);
console.log("Response text:", generateResponse(policy3.responseType as string, nlu3.behavior, policy3.missingFields || [], policy3.extracted as any));
