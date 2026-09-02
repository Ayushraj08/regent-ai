import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Client } from "pg";
import { processDemoUtterance } from "../src/lib/demo-engine/state-machine";
import { makeEmptySession } from "../src/lib/demo-engine/types";

async function runPhase6Harness() {
  console.log("===============================================================");
  console.log("       RELAGENT PHASE 6: INSTANT HUMAN ESCALATION HARNESS      ");
  console.log("===============================================================\n");

  // ─── Test 1: Immediate Human Request on Turn 1 ──────────────────────────────
  console.log("--- Test 1: Immediate Human Escalation ---");
  let session = makeEmptySession("HVAC");
  let res0 = await processDemoUtterance({ session, utterance: "" });
  session = res0.session;
  console.log("Turn 0 (Greeting):", res0.response);

  const escalationUtterance = "I don't want to talk to an AI. Let me speak to a real person right now!";
  console.log("Customer:", escalationUtterance);
  const res1 = await processDemoUtterance({ session, utterance: escalationUtterance });
  session = res1.session;

  console.log("Agent:", res1.response);
  console.log("State:", session.state);
  console.log("Should Transfer?", res1.shouldTransfer);
  console.log("Complete?", res1.complete);
  console.log("Current Action:", res1.currentAction);

  const isGracefulTransfer =
    res1.response.toLowerCase().includes("transfer") ||
    res1.response.toLowerCase().includes("connect");
  console.log("✅ Graceful bridge phrase used?", isGracefulTransfer);
  console.log("✅ res.shouldTransfer is TRUE?", res1.shouldTransfer === true);
  console.log("✅ session.state is ESCALATED?", session.state === "ESCALATED");
  console.log("✅ res.currentAction is HANDLE_HUMAN_REQUEST?", res1.currentAction === "HANDLE_HUMAN_REQUEST");

  // ─── Test 2: Partial Info + Human Request ────────────────────────────────────
  console.log("\n--- Test 2: Partial Info + Escalation ---");
  let session2 = makeEmptySession("PLUMBING");
  const resTurn0 = await processDemoUtterance({ session: session2, utterance: "" });
  session2 = resTurn0.session;

  const partialUtterance = "My name is Sarah Connor, phone 415-555-9876. Just transfer me to a representative please.";
  console.log("Customer:", partialUtterance);
  const res2 = await processDemoUtterance({ session: session2, utterance: partialUtterance });
  session2 = res2.session;

  console.log("Agent:", res2.response);
  console.log("Extracted Name:", session2.lead.name?.value);
  console.log("Extracted Phone:", session2.lead.phone?.value);
  console.log("State:", session2.state);
  console.log("Should Transfer?", res2.shouldTransfer);

  console.log("✅ Partial contact info preserved for human agent?", Boolean(session2.lead.name?.value && session2.lead.phone?.value));
  console.log("✅ shouldTransfer is TRUE?", res2.shouldTransfer === true);

  // ─── Verify Supabase conversation_records escalation flag ───────────────────
  console.log("\n--- Verifying Supabase conversation_records escalation ---");
  const connectionString =
    "postgres://postgres:@Ayushsingh1@db.kezsgmvwkuscdrroucdb.supabase.co:5432/postgres";
  const client = new Client({ connectionString });

  try {
    await client.connect();
    const dbRes = await client.query(
      `SELECT id, session_id, escalated_to_human, situation_context_notes, recommended_next_action
       FROM public.conversation_records
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 1;`,
      [session.sessionId]
    );

    if (dbRes.rows.length > 0) {
      const record = dbRes.rows[0];
      console.log("Found DB record:", record);
      console.log("✅ Escalated to human in database?", record.escalated_to_human === true);
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

  console.log("\n===============================================================");
  console.log("              PHASE 6 VERIFICATION COMPLETE                   ");
  console.log("===============================================================\n");
}

runPhase6Harness().catch(console.error);
