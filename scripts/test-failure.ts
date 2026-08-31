import { evaluatePolicy } from "../src/lib/demo-engine/controller/policy-engine";
import { generateResponse } from "../src/lib/demo-engine/controller/response-generator";
import { EngineRequest, NLUResponse } from "../src/lib/demo-engine/types";

// Setup initial state
const req: EngineRequest = {
  utterance: "Hi, I am Ayush and I need a AC installation service from your end.",
  state: "START",
  turnCount: 1,
  trade: "HVAC",
  lead: {
    name: { value: null, status: "MISSING", confidence: 0, turn: 0, updatedAt: "" },
    phone: { value: null, status: "MISSING", confidence: 0, turn: 0, updatedAt: "" },
    address: { value: null, status: "MISSING", confidence: 0, turn: 0, updatedAt: "" },
    requestType: { value: null, status: "MISSING", confidence: 0, turn: 0, updatedAt: "" },
    service: { value: null, status: "MISSING", confidence: 0, turn: 0, updatedAt: "" },
    problem: { value: null, status: "MISSING", confidence: 0, turn: 0, updatedAt: "" },
    urgency: { value: null, status: "MISSING", confidence: 0, turn: 0, updatedAt: "" },
    trade: "HVAC",
    ticketId: undefined
  },
  conversationHistory: []
};

console.log("=== TURN 1 ===");
const nlu1: NLUResponse = {
  intent: "NEW_SERVICE_REQUEST",
  behavior: "NEUTRAL",
  confidence: 1.0,
  extracted: {
    name: { value: "Ayush", status: "CAPTURED", confidence: 1.0, turn: 1 },
    requestType: { value: "INSTALLATION", status: "CAPTURED", confidence: 1.0, turn: 1 },
    service: { value: "AC_INSTALLATION", status: "CAPTURED", confidence: 1.0, turn: 1 },
    phone: { value: null, status: "MISSING", confidence: 0, turn: 1 },
    address: { value: null, status: "MISSING", confidence: 0, turn: 1 },
    problem: { value: null, status: "MISSING", confidence: 0, turn: 1 },
    urgency: { value: null, status: "MISSING", confidence: 0, turn: 1 },
  },
  safety: { status: "NORMAL", category: null, confidence: 1.0 }
};

const policy1 = evaluatePolicy(req, nlu1);
console.log("Turn 1 Extracted requestType:", policy1.extracted?.requestType);
console.log("Turn 1 Extracted service:", policy1.extracted?.service);
console.log("Turn 1 Action:", policy1.action, policy1.targetField);
console.log("Turn 1 Response:", generateResponse(policy1.action as any, policy1.targetField, "NEUTRAL", policy1.missingFields || [], policy1.extracted as any));

console.log("\n=== TURN 2 ===");
req.lead = policy1.extracted as any;
req.utterance = "1234567890";
req.state = policy1.state as any;
req.turnCount = 2;

const nlu2: NLUResponse = {
  intent: "NEW_SERVICE_REQUEST",
  behavior: "NEUTRAL",
  confidence: 1.0,
  extracted: {
    name: { value: null, status: "MISSING", confidence: 0, turn: 2 },
    requestType: { value: null, status: "UNKNOWN", confidence: 0, turn: 2 },
    service: { value: null, status: "UNKNOWN", confidence: 0, turn: 2 },
    phone: { value: "1234567890", status: "CAPTURED", confidence: 1.0, turn: 2 },
    address: { value: null, status: "MISSING", confidence: 0, turn: 2 },
    problem: { value: null, status: "MISSING", confidence: 0, turn: 2 },
    urgency: { value: null, status: "MISSING", confidence: 0, turn: 2 },
  },
  safety: { status: "NORMAL", category: null, confidence: 1.0 }
};

const policy2 = evaluatePolicy(req, nlu2);
console.log("Turn 2 Extracted requestType:", policy2.extracted?.requestType);
console.log("Turn 2 Extracted service:", policy2.extracted?.service);
console.log("Turn 2 Action:", policy2.action, policy2.targetField);
console.log("Turn 2 Response:", generateResponse(policy2.action as any, policy2.targetField, "NEUTRAL", policy2.missingFields || [], policy2.extracted as any));

console.log("\n=== TURN 3 ===");
req.lead = policy2.extracted as any;
req.utterance = "123 Main Street, New York, US 90001.";
req.state = policy2.state as any;
req.turnCount = 3;

const nlu3: NLUResponse = {
  intent: "NEW_SERVICE_REQUEST",
  behavior: "MINIMAL",
  confidence: 1.0,
  extracted: {
    name: { value: null, status: "MISSING", confidence: 0, turn: 3 },
    requestType: { value: null, status: "MISSING", confidence: 0, turn: 3 },
    service: { value: null, status: "MISSING", confidence: 0, turn: 3 },
    phone: { value: null, status: "MISSING", confidence: 0, turn: 3 },
    address: { value: "123 Main Street, New York, US 90001", status: "CAPTURED", confidence: 1.0, turn: 3 },
    problem: { value: null, status: "MISSING", confidence: 0, turn: 3 },
    urgency: { value: null, status: "MISSING", confidence: 0, turn: 3 },
  },
  safety: { status: "NORMAL", category: null, confidence: 1.0 }
};

const policy3 = evaluatePolicy(req, nlu3);
console.log("Turn 3 Extracted requestType:", policy3.extracted?.requestType);
console.log("Turn 3 Extracted service:", policy3.extracted?.service);
console.log("Turn 3 Action:", policy3.action, policy3.targetField);
console.log("Turn 3 Response:", generateResponse(policy3.action as any, policy3.targetField, "MINIMAL", policy3.missingFields || [], policy3.extracted as any));
