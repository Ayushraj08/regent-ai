import { makeEmptySession } from "../src/lib/demo-engine/types";
import { processRelagentTurn } from "../src/lib/demo-engine/relagent-engine";
import { getOutOfScopeStrikeResponse, checkOutOfScope } from "../src/lib/demo-engine/safety-policy";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

async function runTests() {
  console.log("==================================================================");
  console.log("🚀 RELAGENT MODULE 5: ADAPTIVE HUMAN INTELLIGENCE & EMOTIONAL SYNTHESIS");
  console.log("==================================================================\n");

  // ── TEST 1: ZERO-TOLERANCE OUT-OF-SCOPE 3-STRIKE ENFORCEMENT ─────────────────
  console.log("TEST 1: Zero-Tolerance Out-of-Scope (OOS) & Trivia Enforcement");

  let session = makeEmptySession("HVAC");
  session.tenantId = "00000000-0000-0000-0000-000000000001";

  // Turn 0: TCPA Greeting
  const turn0 = await processRelagentTurn({ session, utterance: "" });
  session = turn0.session;
  assert(turn0.response.includes("Apex Heating & Air"), "Turn 0 TCPA Greeting delivered");

  // Strike 1: "Who is the president?"
  console.log("\n  -> Simulating Strike 1: 'Who is the president?'");
  const turn1 = await processRelagentTurn({
    session,
    utterance: "Who is the president of the United States?",
  });
  session = turn1.session;

  console.log(`  Regent response: "${turn1.response}"`);
  assert(
    turn1.response === "I'm specifically here to help with your Apex Heating & Air service needs. Do you have an issue I can help book a technician for?",
    "Strike 1 response strictly matches specified business-only redirect"
  );
  assert(session.offTopicCount === 1, "Session recorded strike 1 (offTopicCount = 1)");
  assert(session.state !== "CLOSED" && !turn1.complete, "Line remains open after Strike 1");

  // Strike 2: "Tell me a joke"
  console.log("\n  -> Simulating Strike 2: 'Tell me a joke'");
  const turn2 = await processRelagentTurn({
    session,
    utterance: "Can you please tell me a funny joke?",
  });
  session = turn2.session;

  console.log(`  Regent response: "${turn2.response}"`);
  assert(
    turn2.response === "I can only assist with our business services. If you don't need a technician, I will need to clear this line for other customers.",
    "Strike 2 response strictly matches specified line-clearing warning"
  );
  assert(session.offTopicCount === 2, `Session recorded strike 2 (offTopicCount = ${session.offTopicCount})`);
  assert(session.state !== "CLOSED" && !turn2.complete, "Line remains open after Strike 2");

  // Strike 3: "What is the capital of France?" -> Trigger disconnect_and_block
  console.log("\n  -> Simulating Strike 3: 'What is the capital of France?'");
  const turn3 = await processRelagentTurn({
    session,
    utterance: "What is the capital of France?",
  });
  session = turn3.session;

  console.log(`  Regent response: "${turn3.response}"`);
  assert(
    turn3.response.includes("disconnect") && turn3.response.includes("clear the line"),
    "Strike 3 politely disconnects caller"
  );
  assert(session.offTopicCount === 3, "Session recorded strike 3 (offTopicCount = 3)");
  assert(session.state === "CLOSED", "Session state marked CLOSED");
  assert(turn3.complete === true, "Engine marked complete = true");
  assert(turn3.currentAction === "CLOSE_CALL", "currentAction is CLOSE_CALL");
  assert(
    turn3.diagnosticReason?.includes("disconnect_and_block"),
    "Diagnostic reports disconnect_and_block triggered"
  );

  // ── TEST 2: PSYCHOLOGICAL ADAPTATION (DYNAMIC EMPATHY) ───────────────────────
  console.log("\n\nTEST 2: Psychological Adaptation (Dynamic Empathy)");

  // Scenario A: Rushed Caller
  console.log("\n  -> Scenario A: Rushed Caller ('I have no time hurry up')");
  const rushedSession = makeEmptySession("HVAC");
  const rushedTurn0 = await processRelagentTurn({ session: rushedSession, utterance: "" });
  const rushedTurn1 = await processRelagentTurn({
    session: rushedTurn0.session,
    utterance: "I have no time to chat, hurry up and fix my AC!",
  });
  console.log(`  Caller Style: ${rushedTurn1.callerStyle}`);
  console.log(`  Regent response: "${rushedTurn1.response}"`);
  assert(
    rushedTurn1.callerStyle === "rushed" || rushedTurn1.session.callerStyle === "rushed",
    "Detected rushed caller style"
  );
  assert(
    !rushedTurn1.response.startsWith("Certainly!") && !rushedTurn1.response.startsWith("I would be glad to help"),
    "Fluff and conversational filler eliminated for rushed caller"
  );

  // Scenario B: Elderly / Confused Caller
  console.log("\n  -> Scenario B: Elderly / Confused Caller ('I'm an elderly senior, speak slower')");
  const confusedSession = makeEmptySession("HVAC");
  const confusedTurn0 = await processRelagentTurn({ session: confusedSession, utterance: "" });
  const confusedTurn1 = await processRelagentTurn({
    session: confusedTurn0.session,
    utterance: "I'm an elderly senior citizen and I'm very confused, could you please speak slower?",
  });
  console.log(`  Caller Style: ${confusedTurn1.callerStyle}`);
  console.log(`  Sentiment State: ${confusedTurn1.sentimentState}`);
  assert(
    confusedTurn1.callerStyle === "elderly_confused" || confusedTurn1.session.callerStyle === "elderly_confused",
    "Detected elderly_confused caller style"
  );
  assert(
    confusedTurn1.sentimentState === "calm" || confusedTurn1.session.sentimentState === "calm",
    "Calm prosody assigned for elderly/confused caller"
  );

  // Scenario C: Angry / Frustrated Caller
  console.log("\n  -> Scenario C: Angry / Frustrated Caller ('Your tech never showed up, furious!')");
  const angrySession = makeEmptySession("HVAC");
  const angryTurn0 = await processRelagentTurn({ session: angrySession, utterance: "" });
  const angryTurn1 = await processRelagentTurn({
    session: angryTurn0.session,
    utterance: "Your technician never showed up yesterday and I am furious! This service is completely unacceptable!",
  });
  console.log(`  Caller Style: ${angryTurn1.callerStyle}`);
  console.log(`  Sentiment State: ${angryTurn1.sentimentState}`);
  console.log(`  Regent response: "${angryTurn1.response}"`);
  assert(
    angryTurn1.sentimentState === "empathetic" || angryTurn1.session.sentimentState === "empathetic",
    "Empathetic prosody assigned for angry/frustrated caller"
  );
  assert(
    angryTurn1.response.toLowerCase().includes("understand") &&
    (angryTurn1.response.toLowerCase().includes("upset") || angryTurn1.response.toLowerCase().includes("frustrat")),
    "De-escalation psychological validation delivered ('I completely understand why you're upset...')"
  );

  // ── TEST 3: EMOTIONAL TEXT-TO-SPEECH PROSODY PIPELINE ───────────────────────
  console.log("\n\nTEST 3: Emotional Text-to-Speech (TTS) Pipeline");

  // Scenario: Flooding basement emergency
  console.log("\n  -> Scenario: Flooding basement property emergency");
  const floodSession = makeEmptySession("PLUMBING");
  const floodTurn0 = await processRelagentTurn({ session: floodSession, utterance: "" });
  const floodTurn1 = await processRelagentTurn({
    session: floodTurn0.session,
    utterance: "A pipe burst in my basement and water is pouring through the ceiling! It's flooding everywhere!",
  });
  console.log(`  Sentiment State: ${floodTurn1.sentimentState}`);
  console.log(`  Safety Category: ${floodTurn1.safety.category}`);
  console.log(`  Regent response: "${floodTurn1.response}"`);
  assert(
    floodTurn1.sentimentState === "urgent" || floodTurn1.session.sentimentState === "urgent",
    "Urgent voice prosody assigned for flooded basement emergency"
  );

  console.log("\n==================================================================");
  console.log("✅ ALL MODULE 5 CONVERSATIONAL INTELLIGENCE TESTS PASSED!");
  console.log("==================================================================\n");
}

runTests().catch((e) => {
  console.error("Test error:", e);
  process.exit(1);
});
