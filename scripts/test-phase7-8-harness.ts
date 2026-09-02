import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession } from "../src/lib/demo-engine/types";

async function runPhase7And8Harness() {
  console.log("===============================================================");
  console.log("    RELAGENT PHASE 7 & 8: ABUSE, OUT-OF-SCOPE & EMERGENCY HARNESS ");
  console.log("===============================================================\n");

  // ─── 1. Out-of-Scope Handling ───────────────────────────────────────────────
  console.log("--- Test 1: Out-of-Scope Query (Legal Advice) ---");
  let sessionScope = makeEmptySession("HVAC");
  let res0 = await processDemoUtterance({ session: sessionScope, utterance: "" });
  sessionScope = res0.session;

  const scopeUtterance = "Can you give me legal advice? I want to sue my landlord in court.";
  console.log("Customer:", scopeUtterance);
  const resScope = await processDemoUtterance({ session: sessionScope, utterance: scopeUtterance });
  console.log("Agent:", resScope.response);
  console.log("Off-topic Count:", resScope.session.offTopicCount);

  const declinedPolitely =
    resScope.response.toLowerCase().includes("legal") ||
    resScope.response.toLowerCase().includes("plumbing") ||
    resScope.response.toLowerCase().includes("heating") ||
    resScope.response.toLowerCase().includes("service");
  console.log("✅ Politely declined out-of-scope and reframed to service?", declinedPolitely);
  console.log("✅ offTopicCount incremented?", resScope.session.offTopicCount === 1);

  // ─── 2. Abuse Handling (2-Strike Rule) ──────────────────────────────────────
  console.log("\n--- Test 2: Abuse Handling (Strike 1 Warning) ---");
  let sessionAbuse = makeEmptySession("PLUMBING");
  res0 = await processDemoUtterance({ session: sessionAbuse, utterance: "" });
  sessionAbuse = res0.session;

  const abuseStrike1 = "This is total bullshit, fuck you!";
  console.log("Customer (Strike 1):", abuseStrike1);
  let resAbuse = await processDemoUtterance({ session: sessionAbuse, utterance: abuseStrike1 });
  sessionAbuse = resAbuse.session;
  console.log("Agent:", resAbuse.response);
  console.log("Abuse Count:", sessionAbuse.abuseCount);
  console.log("Call Complete?", resAbuse.complete);

  const warnedPolitely =
    resAbuse.response.toLowerCase().includes("refrain") ||
    resAbuse.response.toLowerCase().includes("language");
  console.log("✅ Strike 1 warning issued?", warnedPolitely);
  console.log("✅ Call still active after Strike 1?", resAbuse.complete === false);

  console.log("\n--- Test 2b: Abuse Handling (Strike 2 Disconnect) ---");
  const abuseStrike2 = "Shut the fuck up, asshole!";
  console.log("Customer (Strike 2):", abuseStrike2);
  resAbuse = await processDemoUtterance({ session: sessionAbuse, utterance: abuseStrike2 });
  sessionAbuse = resAbuse.session;
  console.log("Agent:", resAbuse.response);
  console.log("Abuse Count:", sessionAbuse.abuseCount);
  console.log("Session State:", sessionAbuse.state);
  console.log("Call Complete?", resAbuse.complete);

  const disconnected =
    resAbuse.response.toLowerCase().includes("disconnect") ||
    resAbuse.response.toLowerCase().includes("goodbye");
  console.log("✅ Strike 2 disconnect message provided?", disconnected);
  console.log("✅ Call terminated (complete: true)?", resAbuse.complete === true);
  console.log("✅ State is CLOSED?", sessionAbuse.state === "CLOSED");

  // ─── 3. Phase 8: Emergency Safety Protocol ─────────────────────────────────
  console.log("\n--- Test 3: Emergency Protocol (Natural Gas Leak) ---");
  let sessionEmerg = makeEmptySession("HVAC");
  res0 = await processDemoUtterance({ session: sessionEmerg, utterance: "" });
  sessionEmerg = res0.session;

  const emergencyUtterance = "I smell strong natural gas and rotten eggs coming from the furnace!";
  console.log("Customer:", emergencyUtterance);
  const resEmerg = await processDemoUtterance({ session: sessionEmerg, utterance: emergencyUtterance });
  sessionEmerg = resEmerg.session;
  console.log("Agent:", resEmerg.response);
  console.log("Safety Status:", sessionEmerg.safety.status);
  console.log("Safety Category:", sessionEmerg.safety.category);

  const safetyInstructionProvided =
    resEmerg.response.toLowerCase().includes("evacuate") ||
    resEmerg.response.toLowerCase().includes("911");
  console.log("✅ Immediate life safety / evacuation instructions provided?", safetyInstructionProvided);
  console.log("✅ Safety status marked as EMERGENCY?", sessionEmerg.safety.status === "EMERGENCY");
  console.log("✅ Safety category identified as GAS_LEAK?", sessionEmerg.safety.category === "GAS_LEAK");

  console.log("\n===============================================================");
  console.log("            PHASE 7 & 8 VERIFICATION COMPLETE                  ");
  console.log("===============================================================\n");
}

runPhase7And8Harness().catch(console.error);
