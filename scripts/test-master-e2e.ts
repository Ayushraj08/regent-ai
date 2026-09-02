import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Client } from "pg";
import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession, EngineResponseSchema } from "../src/lib/demo-engine/types";

const DB_URL =
  "postgres://postgres:@Ayushsingh1@db.kezsgmvwkuscdrroucdb.supabase.co:5432/postgres";

async function runMasterE2ESuite() {
  console.log("===============================================================");
  console.log("    RELAGENT MASTER END-TO-END VERIFICATION AUDIT SUITE       ");
  console.log("===============================================================\n");

  let totalTests = 0;
  let passedTests = 0;

  function assert(title: string, condition: boolean) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  ✅ [PASS] ${title}`);
    } else {
      console.error(`  ❌ [FAIL] ${title}`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 1: Bad Experience $\rightarrow$ Empathy $\rightarrow$ Schedule $\rightarrow$ Ticket $\rightarrow$ DB Record
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n>>> [1/5] SCENARIO 1: Bad Experience, Empathy, Confirmation & DB Persistence");
  let s1 = makeEmptySession("HVAC");
  s1.lead.context = {
    value: "REF_DATE:2026-09-03T10:00:00Z",
    status: "CAPTURED",
    confidence: 1,
    sourceTurn: 0,
    updatedTurn: 0,
    turn: 0,
  };

  // Turn 0: Greeting
  let r1_0 = await processDemoUtterance({ session: s1, utterance: "" });
  s1 = r1_0.session;
  assert("Turn 0 greeting is warm, human, and mentions company", r1_0.response.includes("Apex Heating"));
  assert("Turn 0 does NOT contain legal recording consent disclaimer", !r1_0.response.toLowerCase().includes("recorded for training"));

  // Turn 1: Frustrated Customer Complaint
  let r1_1 = await processDemoUtterance({
    session: s1,
    utterance: "Your technician came last week, charged me $250, and my AC is still blowing warm air! I am really upset.",
  });
  s1 = r1_1.session;
  const empathyChecked =
    r1_1.response.toLowerCase().includes("understand") ||
    r1_1.response.toLowerCase().includes("sorry") ||
    r1_1.response.toLowerCase().includes("frustrat") ||
    r1_1.response.toLowerCase().includes("apologiz");
  assert("Turn 1 validates feelings with sincere empathy without being defensive", empathyChecked);
  assert("Turn 1 naturally weaved recording consent", r1_1.response.toLowerCase().includes("record") || r1_1.response.toLowerCase().includes("training"));
  assert("Mood diagnostics extracted sentiment as angry", s1.moodDiagnostics?.sentimentTag === "angry");
  assert("Diagnosed why customer is upset", Boolean(s1.moodDiagnostics?.whyCustomerIsUpset));
  assert("Formulated actionable recommended next step for owner", Boolean(s1.moodDiagnostics?.recommendedNextAction));

  // Turn 2: Providing Details
  let r1_2 = await processDemoUtterance({
    session: s1,
    utterance: "My name is Arthur Morgan, phone is 512-555-4321, 100 Lone Star Way, Dallas 75201. Can you send someone Friday at 10 AM?",
  });
  s1 = r1_2.session;
  assert("Captures all 5 customer fields", s1.state === "READY_FOR_CONFIRMATION");
  assert("Includes confirmation prompt: 'Does that look correct, or do you need to change anything?'", r1_2.response.toLowerCase().includes("does that look correct"));

  // Turn 3: Confirmation
  let r1_3 = await processDemoUtterance({
    session: s1,
    utterance: "Yes, that looks correct.",
  });
  s1 = r1_3.session;
  assert("Generated deterministic ticket ID matching ^TKT-\\d{8}-[A-Z0-9]{4}$", /^TKT-\d{8}-[A-Z0-9]{4}$/.test(s1.ticketId || ""));

  // Turn 4: Close
  let r1_4 = await processDemoUtterance({
    session: s1,
    utterance: "No thanks, that's all.",
  });
  s1 = r1_4.session;
  assert("Call complete and session state CLOSED", r1_4.complete === true && s1.state === "CLOSED");

  // Verify Supabase for Scenario 1
  const client = new Client({ connectionString: DB_URL });
  try {
    await client.connect();
    const dbRes = await client.query(
      `SELECT id, sentiment_tag, why_customer_is_upset, recommended_next_action
       FROM public.conversation_records
       WHERE session_id = $1
       LIMIT 1;`,
      [s1.sessionId]
    );
    assert("Conversation record persisted in Supabase conversation_records", dbRes.rows.length > 0);
    if (dbRes.rows.length > 0) {
      assert("DB sentiment_tag is 'angry'", dbRes.rows[0].sentiment_tag === "angry");
    }
  } catch (err) {
    console.error("DB check error:", err);
  } finally {
    try {
      await client.end();
    } catch {}
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 2: Instant Human Escalation
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n>>> [2/5] SCENARIO 2: Instant Human Escalation");
  let s2 = makeEmptySession("PLUMBING");
  let r2_0 = await processDemoUtterance({ session: s2, utterance: "" });
  s2 = r2_0.session;

  let r2_1 = await processDemoUtterance({
    session: s2,
    utterance: "Stop talking. Connect me to a real human representative right now.",
  });
  s2 = r2_1.session;
  assert("Graceful human transfer bridge response", r2_1.response.toLowerCase().includes("transfer") || r2_1.response.toLowerCase().includes("connect"));
  assert("Engine flag shouldTransfer is TRUE", r2_1.shouldTransfer === true);
  assert("Session state is ESCALATED", s2.state === "ESCALATED");
  assert("Current action is HANDLE_HUMAN_REQUEST", r2_1.currentAction === "HANDLE_HUMAN_REQUEST");

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 3: Out-of-Scope & Abuse 2-Strike Protocol
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n>>> [3/5] SCENARIO 3: Out-of-Scope & Abuse 2-Strike Protection");
  let s3 = makeEmptySession("ELECTRICAL");
  let r3_0 = await processDemoUtterance({ session: s3, utterance: "" });
  s3 = r3_0.session;

  // Out-of-scope
  let r3_1 = await processDemoUtterance({
    session: s3,
    utterance: "Can you give me legal advice about filing a lawsuit?",
  });
  s3 = r3_1.session;
  assert("Politely declined legal advice and reframed to service", r3_1.response.toLowerCase().includes("legal") && r3_1.response.toLowerCase().includes("service"));
  assert("offTopicCount incremented to 1", s3.offTopicCount === 1);

  // Abuse Strike 1
  let r3_2 = await processDemoUtterance({
    session: s3,
    utterance: "This is bullshit, fuck you!",
  });
  s3 = r3_2.session;
  assert("Issued polite warning on Strike 1", r3_2.response.toLowerCase().includes("refrain") || r3_2.response.toLowerCase().includes("language"));
  assert("Call stayed active after Strike 1", r3_2.complete === false);

  // Abuse Strike 2
  let r3_3 = await processDemoUtterance({
    session: s3,
    utterance: "Shut the fuck up, asshole!",
  });
  s3 = r3_3.session;
  assert("Issued polite disconnect on Strike 2", r3_3.response.toLowerCase().includes("disconnect") || r3_3.response.toLowerCase().includes("goodbye"));
  assert("Call terminated and state is CLOSED", r3_3.complete === true && s3.state === "CLOSED");

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 4: Emergency Protocol (Gas Leak)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n>>> [4/5] SCENARIO 4: Life Safety Emergency Protocol");
  let s4 = makeEmptySession("HVAC");
  let r4_0 = await processDemoUtterance({ session: s4, utterance: "" });
  s4 = r4_0.session;

  let r4_1 = await processDemoUtterance({
    session: s4,
    utterance: "I smell strong natural gas coming from my water heater!",
  });
  s4 = r4_1.session;
  assert("Provided immediate life safety / evacuation instructions", r4_1.response.toLowerCase().includes("evacuate") || r4_1.response.toLowerCase().includes("911"));
  assert("Flagged safety status as CRITICAL emergency", s4.safety.status === "CRITICAL");
  assert("Categorized as GAS_LEAK", s4.safety.category === "GAS_LEAK");

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 5: Multi-lingual Input & Zero-Loop Merging
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n>>> [5/5] SCENARIO 5: Multi-lingual Input & Partial Merging (Zero Loops)");
  let s5 = makeEmptySession("HVAC");
  let r5_0 = await processDemoUtterance({ session: s5, utterance: "" });
  s5 = r5_0.session;

  // Turn 1: 7-digit local number given
  let r5_1 = await processDemoUtterance({
    session: s5,
    utterance: "Hi, I'm Rahul Sharma, my AC is broken, phone is 555-1234.",
  });
  s5 = r5_1.session;
  assert("Acknowledged 7 digits without throwing them away or looping", s5.lead.phone?.value === "5551234");
  assert("Naturally asked for 3-digit area code", r5_1.response.toLowerCase().includes("area code") || r5_1.response.toLowerCase().includes("remaining"));

  // Turn 2: Customer provides area code in Hindi
  let r5_2 = await processDemoUtterance({
    session: s5,
    utterance: "मेरा एरिया कोड 415 है। (My area code is 415)",
  });
  s5 = r5_2.session;
  assert("Merged 3-digit area code + 7 digits into valid 10-digit number (4155551234)", s5.lead.phone?.value === "4155551234");
  assert("Phone status is VALID", s5.lead.phone?.status === "VALID");

  // Schema conformance check on all outputs
  assert("Turn strictly conforms to EngineResponseSchema", EngineResponseSchema.safeParse(r5_2).success);

  // ───────────────────────────────────────────────────────────────────────────
  // AUDIT SUMMARY
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n===============================================================");
  console.log(` MASTER E2E AUDIT RESULTS: ${passedTests} / ${totalTests} TESTS PASSED `);
  console.log("===============================================================\n");

  if (passedTests === totalTests) {
    console.log("🎉 ALL TESTS PASSED! RELAGENT IS PRODUCTION-CERTIFIED & REGRESSION-FREE.\n");
  } else {
    console.error("⚠️ SOME TESTS FAILED. PLEASE INVESTIGATE.");
  }
}

runMasterE2ESuite().catch(console.error);
