import { evaluatePolicy } from "../src/lib/demo-engine/controller/policy-engine";
import { generateResponse } from "../src/lib/demo-engine/controller/response-generator";
import { EngineRequest, NLUResponse } from "../src/lib/demo-engine/types";
import { GeminiProvider } from "../src/lib/demo-engine/providers/gemini";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function run() {
  const provider = new GeminiProvider("gemini-2.5-flash");
  
  let req: EngineRequest = {
    utterance: "Yeah, I am Ayush and I need an help in AC installation and my address is 123 Main Street, USA, New York 90001.",
    state: "START",
    turnCount: 1,
    trade: "HVAC",
    lead: {
      trade: "HVAC",
      name: { value: null, status: "MISSING", confidence: 0, turn: 0 },
      phone: { value: null, status: "MISSING", confidence: 0, turn: 0 },
      address: { value: null, status: "MISSING", confidence: 0, turn: 0 },
      requestType: { value: null, status: "MISSING", confidence: 0, turn: 0 },
      service: { value: null, status: "MISSING", confidence: 0, turn: 0 },
      problem: { value: null, status: "MISSING", confidence: 0, turn: 0 },
      urgency: { value: null, status: "MISSING", confidence: 0, turn: 0 }
    },
    conversationHistory: [],
    counters: { issueConfirmations: 0, recaps: 0, anythingElsePrompts: 0, endCallPrompts: 0 }
  };

  console.log("USER:", req.utterance);
  const controller = new AbortController();
  const nlu1 = await provider.generate(req, { signal: controller.signal });
  console.log("NLU 1 extracted:", JSON.stringify(nlu1.extracted, null, 2));

  const policy1 = evaluatePolicy(req, nlu1);
  console.log("Policy 1 missingFields:", policy1.missingFields);
  console.log("Policy 1 action:", policy1.action);
  console.log("Policy 1 targetField:", policy1.targetField);
  const resp1 = generateResponse(policy1.action as any, policy1.targetField, nlu1.behavior, policy1.missingFields || [], policy1.extracted as any);
  console.log("REGENT:", resp1);

  console.log("\n--- TURN 2 ---");
  // Update request state with extracted fields
  req.lead = policy1.extracted as any;
  req.utterance = "Installation.";
  req.state = policy1.state as any;
  req.turnCount = 2;

  console.log("USER:", req.utterance);
  const nlu2 = await provider.generate(req, { signal: controller.signal });
  console.log("NLU 2 extracted:", JSON.stringify(nlu2.extracted, null, 2));

  const policy2 = evaluatePolicy(req, nlu2);
  console.log("Policy 2 missingFields:", policy2.missingFields);
  console.log("Policy 2 action:", policy2.action);
  console.log("Policy 2 targetField:", policy2.targetField);
  const resp2 = generateResponse(policy2.action as any, policy2.targetField, nlu2.behavior, policy2.missingFields || [], policy2.extracted as any);
  console.log("REGENT:", resp2);
}

run();
