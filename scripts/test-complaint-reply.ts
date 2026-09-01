import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession } from "../src/lib/demo-engine/types";

async function testFull() {
  let session = makeEmptySession("HVAC");
  session.turnCount = 1;
  session.state = "COLLECTING"; // Important! Skip START state
  session.conversationHistory = [
    { role: "REGENT", content: "Welcome to our service center! How may I help you today?" }
  ];

  try {
    const r1 = await processDemoUtterance({
      session,
      utterance: "Your service is very, very poor. I regretted to opt for your service."
    }, "turn-1");
    console.log("R1:", r1.response);
    
    const r2 = await processDemoUtterance({
      session: r1.session,
      utterance: "My AC was not working properly, and I opt for your service, and your, uh, support executive came to my home, but my AC is still not working properly, and it's not cooling."
    }, "turn-2");
    console.log("R2:", r2.response);
  } catch (e: any) {
    console.error("FAILED:", e);
  }
}

testFull();
