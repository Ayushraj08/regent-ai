import { config } from 'dotenv';
config({ path: '.env.local' });
import { processDemoUtterance } from '../src/lib/demo-engine/state-machine';
import { EngineRequest } from '../src/lib/demo-engine/types';

const createEmptyField = () => ({ value: null, status: 'MISSING', confidence: 0, turn: 0 });

async function runScenario(name: string, turns: { utterance: string, expectedFieldStates: Record<string, string>, expectedResponseType: string }[]) {
  console.log(`\n--- Scenario: ${name} ---`);
  let req: any = {
    state: 'GREETING',
    trade: 'HVAC',
    lead: {
      name: createEmptyField(), phone: createEmptyField(), address: createEmptyField(), 
      service: createEmptyField(), problem: createEmptyField(), urgency: createEmptyField(), trade: 'HVAC'
    },
    conversationHistory: [],
    turnCount: 0
  };

  let passed = true;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    req.utterance = turn.utterance;
    req.turnCount++;
    console.log(`Turn ${i+1} User: "${turn.utterance}"`);
    
    const res = await processDemoUtterance(req as EngineRequest, `test-turn-${i}`);
    
    let turnPassed = true;
    const actualFields = res.extracted as any;
    
    // Check field states
    for (const [key, expectedStatus] of Object.entries(turn.expectedFieldStates)) {
      if (actualFields[key].status !== expectedStatus) {
        console.log(`  ❌ ${key} status expected: ${expectedStatus}, got: ${actualFields[key].status}`);
        turnPassed = false;
      }
    }

    if (res.responseType !== turn.expectedResponseType) {
      console.log(`  ❌ Response Type expected: ${turn.expectedResponseType}, got: ${res.responseType}`);
      turnPassed = false;
    }

    if (turnPassed) {
      console.log(`  ✅ Regent: "${res.response}"`);
    } else {
      passed = false;
      console.log(`  ❌ Regent (failed state): "${res.response}"`);
    }

    // Update req for next turn
    req.state = res.state;
    req.lead = res.extracted;
    req.conversationHistory.push({ role: "CUSTOMER", content: turn.utterance });
    req.conversationHistory.push({ role: "REGENT", content: res.response });
  }
  
  if (passed) {
    console.log(`✅ Scenario ${name} PASSED.`);
  } else {
    console.log(`❌ Scenario ${name} FAILED.`);
  }
}

async function main() {
  console.log("Starting Regent V2 Behavior Tests...\n");
  
  await runScenario("Screenshot Regression 1 (Narrow Asking & Address Validation)", [
    {
      utterance: "I'm Ayush.",
      expectedFieldStates: { name: 'CAPTURED', phone: 'MISSING', address: 'MISSING' },
      expectedResponseType: 'ASK_PHONE'
    },
    {
      utterance: "856573838", // Invalid phone (9 digits)
      expectedFieldStates: { phone: 'INVALID' },
      expectedResponseType: 'ASK_PHONE'
    },
    {
      utterance: "8565738381", // Valid phone
      expectedFieldStates: { phone: 'CAPTURED' },
      expectedResponseType: 'ASK_ADDRESS'
    }
  ]);

  await runScenario("Screenshot Regression 2 (Multi-Field Extraction)", [
    {
      utterance: "Hi, I'm Ayush. My AC completely stopped working. It's really hot inside. I'm at 123 Oak Street.",
      expectedFieldStates: { name: 'CAPTURED', address: 'CAPTURED', problem: 'CAPTURED' },
      expectedResponseType: 'ASK_PHONE'
    }
  ]);
  
  await runScenario("Bihar Address Ambiguity Test", [
    {
      utterance: "I'm Ayush and my number is 1234567890. AC is broken.",
      expectedFieldStates: { name: 'CAPTURED', phone: 'CAPTURED', problem: 'CAPTURED' },
      expectedResponseType: 'ASK_ADDRESS'
    },
    {
      utterance: "HVAC repair. My address is Bihar.",
      expectedFieldStates: { service: 'CAPTURED', address: 'AMBIGUOUS' },
      expectedResponseType: 'ASK_ADDRESS'
    }
  ]);
  
  console.log("\nDone testing.");
}

main();


