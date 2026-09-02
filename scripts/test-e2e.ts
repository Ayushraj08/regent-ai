import { config } from "dotenv";
config({ path: ".env.local" });
delete process.env.NEXT_PUBLIC_SUPABASE_URL;

import { makeEmptySession, EngineRequest } from "../src/lib/demo-engine/types";

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runScenario(name: string, utterances: string[]) {
  console.log(`\n=== SCENARIO: ${name} ===`);
  
  let session = makeEmptySession("HVAC");
  let req: EngineRequest = { session, utterance: "" };
  const { processDemoUtterance } = await import("../src/lib/demo-engine/state-machine");
  let res = await processDemoUtterance(req, crypto.randomUUID());
  console.log("Regent:", res.response);
  
  for (let i = 0; i < utterances.length; i++) {
    const utterance = utterances[i];
    console.log(`\nCustomer: ${utterance}`);
    req = { session: res.session, utterance };
    res = await processDemoUtterance(req, crypto.randomUUID());
    console.log("Regent:", res.response);
    
    // Check missing fields and intent for debugging
    console.log(`[Intent: ${res.session.intent}]`);
    console.log(`[Missing: ${res.missingFields.join(', ')}]`);
    await sleep(500); // give some buffer
  }
}

async function runAll() {
  await runScenario("Existing Customer Complaint", [
    "I had your service, but the experience I had was very, very bad. I called your executive, but they are not able to fix it.",
    "I don't have my ticket number.",
    "It's about my AC. AC is not working properly. It's not cooling.",
    "I'm John Smith, number is 1234567890.",
    "123 Main St, New York.",
    "No that's all",
    "Tomorrow morning.",
    "Yes, confirmed."
  ]);

  await runScenario("Existing Customer No Ref ID", [
    "Hi. I actually had a very poor experience with you. I tried your service, but I am not satisfied with it.",
    "Uh, sorry, I don't have actually. I cannot remember right now.",
    "I assume my AC is not working properly and your service executive is not able to fix that as well.",
    "I am John Smith.",
    "My number is 1234567890.",
    "My address is 123 Main St, New York."
  ]);
  
  await runScenario("Out of Scope Deflection", [
    "Who is the prime minister of India?",
    "Can you dance for me?",
    "Sing for me."
  ]);
}

runAll().catch(console.error);
