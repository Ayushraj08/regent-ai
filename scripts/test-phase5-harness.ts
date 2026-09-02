import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Client } from "pg";
import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession } from "../src/lib/demo-engine/types";

async function runPhase5Harness() {
  console.log("===============================================================");
  console.log("    RELAGENT PHASE 5: MOOD HANDLING & BAD EXPERIENCE DIAGNOSIS ");
  console.log("===============================================================\n");

  let session = makeEmptySession("HVAC");
  session.lead.context = {
    value: "REF_DATE:2026-09-03T10:00:00Z",
    status: "CAPTURED",
    confidence: 1,
    sourceTurn: 0,
    updatedTurn: 0,
    turn: 0,
  };

  // Turn 0: Greeting
  let res = await processDemoUtterance({ session, utterance: "" });
  session = res.session;
  console.log("Turn 0 (Greeting):", res.response);

  // Turn 1: Frustrated customer complaining about a past bad experience
  console.log("\n--- Turn 1: Angry Customer with Past Bad Experience ---");
  const angryUtterance =
    "Your technician came last week, charged me $300, and didn't fix my AC! It's still blowing hot air and I've been waiting all morning. This is completely ridiculous!";
  console.log("Customer:", angryUtterance);
  res = await processDemoUtterance({ session, utterance: angryUtterance });
  session = res.session;
  console.log("Agent:", res.response);

  console.log("\n--- Diagnostics Extracted in State ---");
  console.log("Sentiment Tag:", session.moodDiagnostics?.sentimentTag);
  console.log("Why Customer is Upset:", session.moodDiagnostics?.whyCustomerIsUpset);
  console.log("Situation Context Notes:", session.moodDiagnostics?.situationContextNotes);
  console.log("Recommended Next Action:", session.moodDiagnostics?.recommendedNextAction);

  const lowerReply = res.response.toLowerCase();
  const expressedEmpathy =
    lowerReply.includes("understand") ||
    lowerReply.includes("frustrat") ||
    lowerReply.includes("sorry") ||
    lowerReply.includes("apologiz");

  console.log("✅ Agent expressed genuine empathy without arguing?", expressedEmpathy);
  console.log("✅ Sentiment marked as 'angry'?", session.moodDiagnostics?.sentimentTag === "angry");
  console.log("✅ Root cause diagnosed?", Boolean(session.moodDiagnostics?.whyCustomerIsUpset));
  console.log("✅ Actionable next step recommended for owner?", Boolean(session.moodDiagnostics?.recommendedNextAction));

  // Turn 2: Customer provides name, phone, address, and schedule to resolve the issue
  console.log("\n--- Turn 2: Calming Down and Scheduling Recall Visit ---");
  const infoUtterance =
    "Fine. My name is Marcus Vance, phone 415-555-4321, 500 Pine Street, Dallas 75201. Please send someone tomorrow afternoon at 1 PM to fix it right.";
  console.log("Customer:", infoUtterance);
  res = await processDemoUtterance({ session, utterance: infoUtterance });
  session = res.session;
  console.log("Agent:", res.response);
  console.log("Session State:", session.state);

  // Turn 3: Customer Confirms Summary
  console.log("\n--- Turn 3: Customer Confirms ---");
  res = await processDemoUtterance({ session, utterance: "Yes, that looks correct." });
  session = res.session;
  console.log("Agent:", res.response);
  console.log("Ticket ID:", session.ticketId);

  // Turn 4: Close Call
  console.log("\n--- Turn 4: Wrap-up ---");
  res = await processDemoUtterance({ session, utterance: "No, that's all. Just make sure they fix it." });
  session = res.session;
  console.log("Agent:", res.response);
  console.log("Call Complete?", res.complete);

  // ─── Verify Supabase conversation_records table ─────────────────────────────
  console.log("\n--- Verifying Supabase conversation_records ---");
  const connectionString =
    "postgres://postgres:@Ayushsingh1@db.kezsgmvwkuscdrroucdb.supabase.co:5432/postgres";
  const client = new Client({ connectionString });

  try {
    await client.connect();
    const dbRes = await client.query(
      `SELECT id, session_id, sentiment_tag, why_customer_is_upset, situation_context_notes, recommended_next_action
       FROM public.conversation_records
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 1;`,
      [session.sessionId]
    );

    if (dbRes.rows.length > 0) {
      const record = dbRes.rows[0];
      console.log("Found DB record:", record);
      console.log("✅ Record written to Supabase conversation_records?", true);
      console.log("✅ DB sentiment_tag matches 'angry'?", record.sentiment_tag === "angry");
      console.log("✅ DB why_customer_is_upset saved?", Boolean(record.why_customer_is_upset));
      console.log("✅ DB recommended_next_action saved?", Boolean(record.recommended_next_action));
    } else {
      console.log("❌ Record not found in Supabase conversation_records table.");
    }
  } catch (err) {
    console.error("Supabase query error:", err);
  } finally {
    try {
      await client.end();
    } catch {}
  }

  // ─── Test Happy Sentiment ───────────────────────────────────────────────────
  console.log("\n--- Sub-test: Happy / Positive Sentiment ---");
  let happySession = makeEmptySession("PLUMBING");
  const res0 = await processDemoUtterance({ session: happySession, utterance: "" });
  const happyRes = await processDemoUtterance({
    session: res0.session,
    utterance: "Thank you so much, you guys always have wonderful fantastic service!",
  });
  console.log("Happy Agent:", happyRes.response);
  console.log("Happy Sentiment Tag:", happyRes.session.moodDiagnostics?.sentimentTag);
  console.log("✅ Happy sentiment detected?", happyRes.session.moodDiagnostics?.sentimentTag === "happy");

  console.log("\n===============================================================");
  console.log("              PHASE 5 VERIFICATION COMPLETE                   ");
  console.log("===============================================================\n");
}

runPhase5Harness().catch(console.error);
