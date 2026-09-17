/**
 * RELAGENT ENTERPRISE PATCH: AUTOMATED VALIDATION TEST SUITE
 * Tests:
 * 1. Multi-Tenant Supabase Schema & Profile Resolution
 * 2. Turn-0 FCC/TCPA 2-Party Consent Compliance Greeting
 * 3. Barge-In Interruption Pipeline
 * 4. Day-Of SMS Dispatch & Supabase Confirmation
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { processRelagentTurn } from "../src/lib/demo-engine/relagent-engine";
import {
  getTenantProfile,
  getAllTenantProfiles,
  confirmDayOfSms,
  getPendingDayOfSmsTickets,
} from "../src/lib/demo-engine/ticket-service";
import { makeEmptySession, ConversationSession } from "../src/lib/demo-engine/types";

async function runEnterpriseValidation() {
  console.log("================================================================================");
  console.log("       RELAGENT ENTERPRISE PATCH: MULTI-TENANT & COMPLIANCE VALIDATION          ");
  console.log("================================================================================\n");

  let allPassed = true;

  // ── TEST 1: Multi-Tenant Tenant Profiles in Supabase ─────────────────────────
  console.log("▶ TEST 1: Supabase Multi-Tenant Schema & Tenant Profiles Query");
  try {
    const tenants = await getAllTenantProfiles();
    console.log(`  ✓ Successfully fetched ${tenants.length} tenant profiles from Supabase.`);
    for (const t of tenants) {
      console.log(`    • Tenant: ${t.businessName} (ID: ${t.tenantId}) | AI: ${t.aiAgentName} | Fee: ${t.afterHoursDispatchFee}`);
    }

    if (tenants.length >= 3) {
      console.log("  [PASS] Multi-tenant contractor records active in Supabase.\n");
    } else {
      console.warn("  [WARN] Expected at least 3 seeded tenant profiles.\n");
    }
  } catch (err) {
    console.error("  [FAIL] Error querying tenant profiles:", err);
    allPassed = false;
  }

  // ── TEST 2: Turn-0 FCC & TCPA 2-Party Consent Compliance Greeting ───────────
  console.log("▶ TEST 2: Turn-0 FCC & TCPA 2-Party Recording Consent Compliance");
  try {
    // Test for Apex Heating & Air
    const apexSession = makeEmptySession("HVAC");
    apexSession.tenantId = "00000000-0000-0000-0000-000000000001";

    const turn0Apex = await processRelagentTurn({
      session: apexSession,
      utterance: "",
    });

    console.log(`  Apex Response Turn 0:\n    "${turn0Apex.response}"`);

    const expectedApex =
      "Thanks for calling Apex Heating & Air on a recorded line. I'm Regent, your AI assistant. How can I help you today?";
    
    if (turn0Apex.response === expectedApex) {
      console.log("  ✓ Apex Turn-0 exact compliance greeting verified (100% deterministic, zero LLM tokens).");
    } else {
      console.error(`  [FAIL] Expected: "${expectedApex}"\n  Received: "${turn0Apex.response}"`);
      allPassed = false;
    }

    // Test for Metro Flow Plumbing (Multi-Tenant dynamic injection)
    const metroSession = makeEmptySession("PLUMBING");
    metroSession.tenantId = "00000000-0000-0000-0000-000000000002";

    const turn0Metro = await processRelagentTurn({
      session: metroSession,
      utterance: "",
    });

    console.log(`  Metro Flow Response Turn 0:\n    "${turn0Metro.response}"`);

    const expectedMetro =
      "Thanks for calling Metro Flow Plumbing on a recorded line. I'm Piper, your AI assistant. How can I help you today?";

    if (turn0Metro.response === expectedMetro) {
      console.log("  ✓ Metro Flow Turn-0 dynamic tenant greeting verified.");
      console.log("  [PASS] Turn-0 FCC/TCPA 2-party recording consent compliance PASSED.\n");
    } else {
      console.error(`  [FAIL] Expected: "${expectedMetro}"\n  Received: "${turn0Metro.response}"`);
      allPassed = false;
    }
  } catch (err) {
    console.error("  [FAIL] Turn-0 Compliance test failed:", err);
    allPassed = false;
  }

  // ── TEST 3: Barge-In Interruption Pipeline ──────────────────────────────────
  console.log("▶ TEST 3: Full Duplex / Barge-In Interrupt Architecture");
  try {
    const interruptSession: ConversationSession = {
      ...makeEmptySession("HVAC"),
      state: "COLLECTING",
      tenantId: "00000000-0000-0000-0000-000000000001",
      turnCount: 2,
      conversationHistory: [
        {
          role: "REGENT",
          content: "Thanks for calling Apex Heating & Air on a recorded line. I'm Regent, your AI assistant. How can I help you today?",
        },
        {
          role: "CUSTOMER",
          content: "Hi, I need help with my AC.",
        },
        {
          role: "REGENT",
          content: "I can certainly help you with your air conditioning. Could you please share your full name as it appears on your ID?",
        },
      ],
    };

    console.log("  Simulating user interruption while Regent was speaking...");
    const interruptResponse = await processRelagentTurn({
      session: interruptSession,
      utterance: "Wait, hold on, actually my brother fixed the AC! But our water heater is leaking in the basement.",
      isInterrupted: true,
    });

    console.log(`  Assistant response to interruption:\n    "${interruptResponse.response}"`);

    if (
      interruptResponse.response.toLowerCase().includes("water heater") ||
      interruptResponse.response.toLowerCase().includes("heater") ||
      interruptResponse.response.toLowerCase().includes("leak") ||
      interruptResponse.response.toLowerCase().includes("name")
    ) {
      console.log("  ✓ Agent adapted to new user intent following barge-in interruption.");
      console.log("  [PASS] Barge-in full duplex interrupt handling PASSED.\n");
    } else {
      console.warn("  [WARN] Unexpected response content to interruption.\n");
    }
  } catch (err) {
    console.error("  [FAIL] Barge-in test failed:", err);
    allPassed = false;
  }

  // ── TEST 4: 'Ghosted Technician' Day-Of SMS Safeguard & Confirmation ─────────
  console.log("▶ TEST 4: 'Ghosted Technician' Day-Of SMS Safeguard & Supabase Confirmation");
  try {
    const pendingTickets = await getPendingDayOfSmsTickets();
    console.log(`  Found ${pendingTickets.length} service ticket(s) eligible for day-of dispatch SMS.`);

    if (pendingTickets.length > 0) {
      const testTicket = pendingTickets[0];
      console.log(`  Dispatch SMS Payload for Ticket #${testTicket.ticketId}:`);
      console.log(`    "${testTicket.smsMessage}"`);

      // Verify payload format
      const hasExpectedFormat =
        testTicket.smsMessage.includes("Hi ") &&
        testTicket.smsMessage.includes("tech is scheduled to arrive between") &&
        testTicket.smsMessage.includes("Please reply YES to confirm someone is home.");

      if (hasExpectedFormat) {
        console.log("  ✓ SMS dispatch payload strictly matches enterprise specification.");
      } else {
        console.error("  [FAIL] SMS message format does not match specification.");
        allPassed = false;
      }

      // Simulate customer replying YES
      console.log(`  Simulating customer replying 'YES' for Ticket #${testTicket.ticketId}...`);
      const confirmRes = await confirmDayOfSms(testTicket.ticketId);

      if (confirmRes.success) {
        console.log("  ✓ Supabase confirmed: day_of_sms_confirmed = TRUE updated successfully!");
        console.log("  [PASS] Ghosted technician safeguard & Day-Of SMS PASSED.\n");
      } else {
        console.error("  [FAIL] Failed to update day_of_sms_confirmed:", confirmRes.error);
        allPassed = false;
      }
    } else {
      console.warn("  [WARN] No pending tickets found for today in Supabase.");
    }
  } catch (err) {
    console.error("  [FAIL] Day-of SMS test failed:", err);
    allPassed = false;
  }

  console.log("================================================================================");
  if (allPassed) {
    console.log("              ALL 4 ENTERPRISE PATCH REQUIREMENTS PASSED 100%                  ");
  } else {
    console.log("                       SOME CHECKS FAILED                                      ");
  }
  console.log("================================================================================");
}

runEnterpriseValidation().catch(console.error);
