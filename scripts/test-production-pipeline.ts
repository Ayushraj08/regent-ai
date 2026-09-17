/**
 * Production Test Script: Step 4 Database Verification & Pipeline Simulation
 * Simulates a call to Business 'b0000000-0000-0000-0000-000000000001',
 * triggers save_customer_info UPSERT and end_call conclusion hook,
 * and asserts that customers, appointments, and call_logs tables populate correctly.
 */

import { Client } from "pg";
import {
  getBusinessProfile,
  upsertCustomer,
  commitCallConclusion,
  generateCallSummary,
} from "../src/lib/demo-engine/ticket-service";
import { makeEmptySession } from "../src/lib/demo-engine/types";
import { executeEndCallConclusionHook } from "../src/lib/demo-engine/relagent-engine";

const SUPABASE_DB_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:@Ayushsingh1@db.kezsgmvwkuscdrroucdb.supabase.co:5432/postgres";

const TEST_BUSINESS_ID = "b0000000-0000-0000-0000-000000000001";

async function runTest() {
  console.log("=== RELAGENT PRODUCTION PIPELINE TEST ===");
  const client = new Client({ connectionString: SUPABASE_DB_URL });
  await client.connect();

  try {
    // 1. Verify Seeded Business
    console.log(`\n[Test 1] Verifying business '${TEST_BUSINESS_ID}'...`);
    const bizRes = await client.query("SELECT * FROM public.businesses WHERE id = $1;", [TEST_BUSINESS_ID]);
    if (bizRes.rows.length === 0) {
      throw new Error(`Business ${TEST_BUSINESS_ID} not found in database!`);
    }
    const biz = bizRes.rows[0];
    console.log(`  Found Business: ${biz.company_name}, Agent: ${biz.ai_agent_name}, Zips: ${biz.service_zip_codes}`);

    // 2. Test Step 3.1: Customer UPSERT Hook (save_customer_info)
    console.log("\n[Test 2] Testing Customer UPSERT Hook (save_customer_info)...");
    const testPhone = "5125559821";
    const initialAddress = "1402 Congress Ave";
    const initialCity = "Austin";
    const initialZip = "78701";

    const upsert1 = await upsertCustomer(TEST_BUSINESS_ID, {
      fullName: "Marcus Vance",
      phoneNumber: testPhone,
      streetAddress: initialAddress,
      city: initialCity,
      zipCode: initialZip,
    });

    if (!upsert1.customerId) {
      throw new Error(`Customer UPSERT 1 failed: ${upsert1.error}`);
    }
    const customerId = upsert1.customerId;
    console.log(`  Customer created with ID: ${customerId}`);

    // Test UPSERT Address Update (Customer already exists, address changed)
    const updatedAddress = "1402 Congress Ave Suite 300";
    const upsert2 = await upsertCustomer(TEST_BUSINESS_ID, {
      fullName: "Marcus Vance",
      phoneNumber: testPhone,
      streetAddress: updatedAddress,
      city: initialCity,
      zipCode: initialZip,
    });

    if (upsert2.customerId !== customerId) {
      throw new Error(`Customer UPSERT 2 did not match existing customer ID! (Got ${upsert2.customerId})`);
    }

    const custCheck = await client.query("SELECT * FROM public.customers WHERE id = $1;", [customerId]);
    if (custCheck.rows[0].street_address !== updatedAddress) {
      throw new Error(`Customer address was not updated! Found: ${custCheck.rows[0].street_address}`);
    }
    console.log(`  Customer UPSERT address update verified: ${custCheck.rows[0].street_address}`);

    // 3. Test Step 3.2: Secondary LLM Summarization Hook
    console.log("\n[Test 3] Testing Fast Secondary LLM Summarizer (Step B)...");
    const sampleTranscript = `USER: Hi, our central AC is making a grinding noise and blowing warm air.
REGENT: Got it, that sounds like an issue with the compressor or blower motor. I can certainly help get a technician out to look at that for you. May I have your full name?
USER: Marcus Vance.
REGENT: Thanks Marcus. What's the best 10-digit phone number to reach you at?
USER: 512-555-9821.
REGENT: Got it. And what is the street address for the service?
USER: 1402 Congress Ave, Austin 78701.
REGENT: Perfect, we service that area. We have an opening tomorrow between 9:00 AM and 12:00 PM. Does that arrival window work for you?
USER: Yes, tomorrow morning between 9 and 12 works great.
REGENT: Marcus, you're all set! Your appointment is confirmed. Thank you for choosing Apex Heating & Air! Have a wonderful day!
USER: Thank you, goodbye!`;

    const summaryRes = await generateCallSummary(sampleTranscript, {
      hasAppointment: true,
      trade: "HVAC",
    });

    console.log(`  AI Summary for Owner: "${summaryRes.aiSummaryForOwner}"`);
    console.log(`  Action Needed: "${summaryRes.actionNeeded}"`);
    console.log(`  Call Category: "${summaryRes.callCategory}"`);

    if (!summaryRes.aiSummaryForOwner || summaryRes.aiSummaryForOwner.length < 10) {
      throw new Error("Invalid ai_summary_for_owner returned!");
    }
    if (!summaryRes.actionNeeded || summaryRes.actionNeeded.length < 5) {
      throw new Error("Invalid action_needed returned!");
    }
    if (summaryRes.callCategory !== "Booking") {
      throw new Error(`Expected call_category 'Booking', got '${summaryRes.callCategory}'`);
    }

    // 4. Test Step 3.2 Full Hook Execution (executeEndCallConclusionHook)
    console.log("\n[Test 4] Testing Full end_call Hook (Step A + Step B + Step C)...");
    const session = makeEmptySession("HVAC", undefined, testPhone, undefined, TEST_BUSINESS_ID);
    session.businessId = TEST_BUSINESS_ID;
    session.customerId = customerId;
    session.lead.name = {
      value: "Marcus Vance",
      status: "VALID",
      confidence: 1.0,
      sourceTurn: 1,
      updatedTurn: 1,
      turn: 1,
    };
    session.lead.phone = {
      value: testPhone,
      status: "VALID",
      confidence: 1.0,
      sourceTurn: 2,
      updatedTurn: 2,
      turn: 2,
    };
    session.lead.address = {
      value: `${updatedAddress}, Austin 78701`,
      status: "VALID",
      confidence: 1.0,
      sourceTurn: 3,
      updatedTurn: 3,
      turn: 3,
    };
    session.lead.problem = {
      value: "Central AC grinding noise and blowing warm air",
      status: "VALID",
      confidence: 1.0,
      sourceTurn: 1,
      updatedTurn: 1,
      turn: 1,
    };
    session.lead.timing = {
      value: "2026-09-13 09:00 AM - 12:00 PM",
      status: "VALID",
      confidence: 1.0,
      sourceTurn: 4,
      updatedTurn: 4,
      turn: 4,
    };
    session.conversationHistory = [
      { role: "CUSTOMER", content: "Hi, our central AC is making a grinding noise and blowing warm air." },
      { role: "REGENT", content: "Got it, I can help get a technician out. May I have your full name?" },
      { role: "CUSTOMER", content: "Marcus Vance." },
      { role: "REGENT", content: "What is your best 10-digit phone number?" },
      { role: "CUSTOMER", content: "512-555-9821." },
      { role: "REGENT", content: "What is the street address?" },
      { role: "CUSTOMER", content: "1402 Congress Ave Suite 300, Austin 78701." },
      { role: "REGENT", content: "We have an opening tomorrow between 9:00 AM and 12:00 PM. Does that work?" },
      { role: "CUSTOMER", content: "Yes, tomorrow morning works." },
      { role: "REGENT", content: "Marcus, you're all set! Have a wonderful day!" },
    ];

    const conclusionResult = await executeEndCallConclusionHook(session, new Date("2026-09-12T10:00:00Z"));
    console.log("  Conclusion result:", JSON.stringify(conclusionResult, null, 2));

    if (!conclusionResult?.success) {
      throw new Error(`end_call conclusion hook failed: ${conclusionResult?.error}`);
    }
    if (!conclusionResult.appointmentId) {
      throw new Error("No appointmentId returned from end_call hook!");
    }
    if (!conclusionResult.ticketId || !conclusionResult.ticketId.startsWith("TKT-")) {
      throw new Error(`Invalid ticketId returned: ${conclusionResult.ticketId}`);
    }
    if (!conclusionResult.callLogId) {
      throw new Error("No callLogId returned from end_call hook!");
    }

    // 5. Database Assertions
    console.log("\n[Test 5] Asserting Database Tables & Relations...");

    // Check Appointments Table
    const apptCheck = await client.query(
      "SELECT * FROM public.appointments WHERE id = $1;",
      [conclusionResult.appointmentId]
    );
    if (apptCheck.rows.length === 0) {
      throw new Error("Appointment not found in DB!");
    }
    const apptRow = apptCheck.rows[0];
    console.log(`  ✓ appointments: id=${apptRow.id}, ticket_id=${apptRow.ticket_id}, customer_id=${apptRow.customer_id}, scheduled_date=${apptRow.scheduled_date.toISOString().split("T")[0]}, arrival_window=${apptRow.arrival_window}`);

    if (apptRow.business_id !== TEST_BUSINESS_ID) {
      throw new Error(`Appointment business_id mismatch! Expected ${TEST_BUSINESS_ID}, got ${apptRow.business_id}`);
    }
    if (apptRow.customer_id !== customerId) {
      throw new Error(`Appointment customer_id mismatch! Expected ${customerId}, got ${apptRow.customer_id}`);
    }

    // Check Call Logs Table
    const logCheck = await client.query(
      "SELECT * FROM public.call_logs WHERE id = $1;",
      [conclusionResult.callLogId]
    );
    if (logCheck.rows.length === 0) {
      throw new Error("Call log not found in DB!");
    }
    const logRow = logCheck.rows[0];
    console.log(`  ✓ call_logs: id=${logRow.id}`);
    console.log(`    appointment_id: ${logRow.appointment_id}`);
    console.log(`    caller_phone: ${logRow.caller_phone}`);
    console.log(`    call_category: ${logRow.call_category}`);
    console.log(`    ai_summary_for_owner: ${logRow.ai_summary_for_owner}`);
    console.log(`    action_needed: ${logRow.action_needed}`);

    if (logRow.business_id !== TEST_BUSINESS_ID) {
      throw new Error(`Call log business_id mismatch! Expected ${TEST_BUSINESS_ID}, got ${logRow.business_id}`);
    }
    if (logRow.appointment_id !== conclusionResult.appointmentId) {
      throw new Error(`Call log appointment_id mismatch! Expected ${conclusionResult.appointmentId}, got ${logRow.appointment_id}`);
    }
    if (logRow.caller_phone !== testPhone) {
      throw new Error(`Call log caller_phone mismatch! Expected ${testPhone}, got ${logRow.caller_phone}`);
    }
    if (logRow.call_category !== "Booking") {
      throw new Error(`Call log call_category mismatch! Expected 'Booking', got ${logRow.call_category}`);
    }

    console.log("\n=============================================");
    console.log("ALL TESTS PASSED PERFECTLY!");
    console.log("Schema verified. API wired. Database assertions passed.");
    console.log("=============================================");
  } finally {
    await client.end();
  }
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
