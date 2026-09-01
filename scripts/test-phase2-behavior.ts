import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession, ConversationSession } from "../src/lib/demo-engine/types";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function runTest(testName: string, inputs: string[], expectedEndStates?: any) {
  console.log(`\n========================================`);
  console.log(`[TEST] ${testName}`);
  console.log(`========================================`);
  
  let session = makeEmptySession(null);
  // Start state initialization
  const startResult = await processDemoUtterance({ session, utterance: "START" });
  session = startResult.session;

  for (const input of inputs) {
    console.log(`\nCUSTOMER: "${input}"`);
    const result = await processDemoUtterance({ session, utterance: input });
    session = result.session;
    console.log(`REGENT  : "${result.response}"`);
    console.log(`  State : ${session.state} | Action: ${session.currentAction} | Intent: ${session.intent} | Behavior: ${session.customerBehavior}`);
    
    if (result.complete || result.shouldTransfer) {
      console.log(`  [CALL ENDED / ESCALATED]`);
      break;
    }
  }

  // Final check
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
  let passedCount = 0;
  let failedCount = 0;

  console.log("Starting Phase 2 Behavior Matrix...\n");

  const tests = [
    {
      name: "NORMAL AC INSTALLATION",
      inputs: [
        "Hi, I need an AC installation.",
        "I'm Ayush.",
        "It's 1234567890.",
        "123 Main Street.",
        "It's flexible.",
        "Yeah that's correct.",
        "No thanks."
      ],
      expect: { "lead.name.value": "Ayush", "trade": "HVAC", "requestType": "INSTALLATION", "state": "END" }
    },
    {
      name: "MULTI-FIELD INITIAL",
      inputs: [
        "I'm Ayush, need AC installation, I'm at 123 Main, and my number is 1234567890.",
        "Timing is flexible.",
        "Yes.",
        "No."
      ],
      expect: { "lead.name.value": "Ayush", "lead.address.value": "123 Main", "lead.phone.value": "1234567890", "state": "END" }
    },
    {
      name: "OUT OF ORDER",
      inputs: [
        "I need service at 123 Main.",
        "An AC repair.",
        "I'm Ayush.",
        "My number is 1234567890.",
        "It stopped cooling.",
        "Not very urgent.",
        "Yes.",
        "No."
      ],
      expect: { "lead.address.value": "123 Main", "requestType": "REPAIR", "state": "END" }
    },
    {
      name: "EMOTIONAL FRUSTRATION",
      inputs: [
        "You guys never answer the phone. I need my AC fixed now.",
        "My name is Ayush and I'm very annoyed.",
        "1234567890",
        "123 Main St.",
        "It's just blowing hot air.",
        "Today.",
        "Yes that's correct.",
        "No."
      ],
      expect: { "customerBehavior": "FRUSTRATED", "requestType": "REPAIR", "state": "END" }
    },
    {
      name: "CONVERSATIONAL / BUSINESS",
      inputs: [
        "How are you?",
        "Do you service Queens?",
        "I need AC repair in Queens at 123 Main.",
        "I'm Ayush.",
        "1234567890",
        "It's blowing hot air.",
        "Flexible.",
        "Yes.",
        "No."
      ],
      expect: { "lead.address.value": "123 Main", "state": "END" }
    },
    {
      name: "INTERRUPTION / BRANCH",
      inputs: [
        "I need an AC installation.",
        "I'm Ayush.",
        "Wait, what time do you guys close?",
        "Okay my number is 1234567890.",
        "123 Main",
        "Flexible.",
        "Yes.",
        "No."
      ],
      expect: { "lead.name.value": "Ayush", "lead.phone.value": "1234567890", "state": "END" }
    },
    {
      name: "HUMAN REQUEST",
      inputs: [
        "I need AC repair.",
        "I want a real person."
      ],
      expect: { "state": "TRANSFER" }
    },
    {
      name: "EXPLICIT END",
      inputs: [
        "I need AC repair.",
        "Actually, forget it, we should end the call."
      ],
      expect: { "state": "END" }
    },
    {
      name: "SILENCE RECOVERY",
      inputs: [
        "I need an AC repair.",
        "" // silence
      ],
      expect: { "currentAction": "CLARIFY" }
    }
  ];

  for (const t of tests) {
    const success = await runTest(t.name, t.inputs, t.expect);
    if (success) passedCount++;
    else failedCount++;
  }

  console.log(`\n========================================`);
  console.log(`RESULTS: ${passedCount} PASSED | ${failedCount} FAILED`);
  console.log(`========================================`);
}

main().catch(console.error);
