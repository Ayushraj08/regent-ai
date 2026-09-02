import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession, ConversationSession } from "../src/lib/demo-engine/types";
import { db } from "../src/lib/db/db-client";
import { createRequestWithCustomer } from "../src/lib/db/services/request-service";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const businessId = "DEMO-BUSINESS";

async function runTest(testName: string, inputs: string[], callerPhone: string, expectedEndStates?: any) {
  console.log(`\n========================================`);
  console.log(`[TEST] ${testName}`);
  console.log(`========================================`);
  
  let session = makeEmptySession(null, undefined, callerPhone);
  const startResult = await processDemoUtterance({ session, utterance: "START" });
  session = startResult.session;
  console.log(`REGENT  : "${startResult.response}"`);

  for (const input of inputs) {
    console.log(`\nCUSTOMER: "${input}"`);
    const result = await processDemoUtterance({ session, utterance: input });
    session = result.session;
    console.log(`REGENT  : "${result.response}"`);
    console.log(`  State : ${session.state} | Action: ${session.currentAction} | Intent: ${session.intent}`);
    
    if (result.complete || result.shouldTransfer) {
      console.log(`  [CALL ENDED / ESCALATED]`);
      break;
    }
  }

  let passed = true;
  if (expectedEndStates) {
    for (const [key, expectedVal] of Object.entries(expectedEndStates)) {
      const actualVal = key.includes(".") 
        ? key.split('.').reduce((o: any, i: string) => o?.[i], session)
        : (session as any)[key];
        
      if (actualVal !== expectedVal) {
        console.error(`❌ FAILED: ${key} = ${actualVal} (Expected: ${expectedVal})`);
        passed = false;
      }
    }
  }
  
  if (passed) console.log(`\n✅ TEST PASSED`);
  return passed;
}

async function main() {
  if (db.clearDatabase) await db.clearDatabase();
  
  // Create an existing request in the DB
  const { request } = await createRequestWithCustomer(businessId, {
    name: "Ayush",
    phone: "8005559999"
  }, {
    trade: "HVAC",
    requestType: "REPAIR",
    primaryService: "AC_REPAIR",
    problem: "It is blowing hot air",
    address: "123 Oak Street"
  }, "setup-conv");

  console.log(`\nSeeded Request: ${request.ticket_id} for 8005559999\n`);

  let passedCount = 0;
  let failedCount = 0;

  const tests = [
    {
      name: "EXACT RETURNING CUSTOMER TEST (Follow Up)",
      callerPhone: "8005559999",
      inputs: [
        "Yes, the AC is still not cooling."
      ],
      expect: { "intent": "PROVIDE_INFORMATION", "state": "END" } // the utterance will just continue or clarify
    },
    {
      name: "EXACT NO-MATCH TEST",
      callerPhone: "8005550000",
      inputs: [
        "I need a plumber."
      ],
      expect: { "trade": "PLUMBING" }
    }
  ];

  for (const t of tests) {
    const success = await runTest(t.name, t.inputs, t.callerPhone, t.expect);
    if (success) passedCount++;
    else failedCount++;
  }

  console.log(`\n========================================`);
  console.log(`RESULTS: ${passedCount} PASSED | ${failedCount} FAILED`);
  console.log(`========================================`);
}

main().catch(console.error);
