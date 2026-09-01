import { evaluatePolicy } from "../src/lib/demo-engine/controller/policy-engine";
import { generateResponse } from "../src/lib/demo-engine/controller/response-generator";
import { makeEmptySession, NLUResponse } from "../src/lib/demo-engine/types";

const session = makeEmptySession(null);
session.lead.name = { value: "Ayush", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 };
session.turnCount = 1;
session.conversationHistory = [
  { role: "REGENT", content: "Welcome to our service center! How may I help you today?" }
];

const nlu: NLUResponse = {
  intent: "COMPLAINT",
  behavior: "ANGRY",
  confidence: 0.9,
  safety: { status: "NORMAL", category: null, confidence: 1 },
  extracted: {}
};

try {
  const policyResult = evaluatePolicy(session, nlu, "Your service is very, very poor, and I'm giving you a rating of zero out of five.");
  console.log("Policy Action:", policyResult.session.currentAction);

  const response = generateResponse(
    policyResult.session.currentAction,
    policyResult.session.questionLedger.find(q => q.status === "PENDING")?.field,
    policyResult.session.customerBehavior,
    policyResult.session.missingFields,
    policyResult.session
  );
  console.log("Response Text:", response);
} catch (e) {
  console.error("CRASH:", e);
}
