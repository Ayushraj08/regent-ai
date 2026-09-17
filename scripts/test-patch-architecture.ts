import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import {
  isWithinOperatingHours,
  checkOutsideOperatingHours,
  resolveArrivalWindow,
  resolveDateTime,
  STANDARD_ARRIVAL_WINDOWS,
} from "../src/lib/demo-engine/date-resolver";
import {
  checkEmergencySafety,
  getAfterHoursGreeting,
} from "../src/lib/demo-engine/safety-policy";
import {
  generateTicketId,
  commitCallConclusion,
} from "../src/lib/demo-engine/ticket-service";
import { processRelagentTurn } from "../src/lib/demo-engine/relagent-engine";
import { makeEmptySession } from "../src/lib/demo-engine/types";
import { Client } from "pg";

const SUPABASE_DB_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:@Ayushsingh1@db.kezsgmvwkuscdrroucdb.supabase.co:5432/postgres";

async function runTests() {
  console.log("================================================================================");
  console.log("🚀 RELAGENT ARCHITECTURAL PATCH VALIDATION SUITE");
  console.log("================================================================================\n");

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` — ${detail}` : ""}`);
    }
  }

  // ── TEST 1: Operating Hours & Windows ──────────────────────────────────────────
  console.log("--- 1. Operating Hours & Time Confirmation Engine ---");

  // Tuesday 10:00 AM
  const tuesday10Am = new Date("2026-09-15T10:00:00Z");
  assert(
    isWithinOperatingHours(tuesday10Am, 10),
    "Tuesday 10:00 AM is inside standard operating window (08:00 - 18:00)"
  );

  // Tuesday 8:00 PM (hour 20)
  assert(
    !isWithinOperatingHours(tuesday10Am, 20),
    "Tuesday 8:00 PM is outside standard operating window"
  );

  // Sunday 11:00 AM
  const sunday11Am = new Date("2026-09-13T11:00:00Z"); // Sep 13, 2026 is Sunday
  assert(
    !isWithinOperatingHours(sunday11Am, 11),
    "Sunday is closed (after-hours protocol applies)"
  );

  // Out of hours prompt check
  const outHoursCheck = checkOutsideOperatingHours("Can I get someone here at 8:00 PM on Tuesday?");
  assert(outHoursCheck.isOutside, "Detects 8:00 PM as outside operating hours");
  assert(
    Boolean(
      outHoursCheck.responsePrompt?.includes("Our standard service hours end at 6:00 PM") &&
      outHoursCheck.responsePrompt?.includes("8:00 AM and 10:00 AM the next day")
    ),
    "Returns polite outside hours guidance with next morning 8-10 AM option or emergency dispatch"
  );

  // Arrival window mapping
  assert(
    resolveArrivalWindow("our morning window") === STANDARD_ARRIVAL_WINDOWS.MORNING_9_12,
    "Maps 'morning window' to '09:00 AM - 12:00 PM'"
  );
  assert(
    resolveArrivalWindow("afternoon window") === STANDARD_ARRIVAL_WINDOWS.AFTERNOON_1_4,
    "Maps 'afternoon window' to '01:00 PM - 04:00 PM'"
  );

  // Date resolution requiring arrival window prompt
  const refDate = new Date("2026-09-10T14:00:00Z"); // Thursday
  const dateRes = resolveDateTime("September 14th", refDate);
  assert(dateRes.isResolved, "Resolves 'September 14th' deterministically");
  assert(dateRes.needsWindowClarification === true, "Flags needsWindowClarification when no window specified");
  assert(
    Boolean(
      dateRes.windowClarificationPrompt?.includes("morning window between 9:00 AM and 12:00 PM") &&
      dateRes.windowClarificationPrompt?.includes("afternoon between 1:00 PM and 4:00 PM")
    ),
    "Generates prompt: 'We have availability on [Date] for either our morning window between 9:00 AM and 12:00 PM, or afternoon between 1:00 PM and 4:00 PM. Which works best for you?'"
  );

  // ── TEST 2: Emergency Triage Protocol ──────────────────────────────────────────
  console.log("\n--- 2. Emergency Triage (Property-Threatening vs Life-Threatening) ---");

  // Level 1: Life-Threatening (Gas smell)
  const l1Gas = checkEmergencySafety("I smell strong natural gas coming from my basement");
  assert(l1Gas.isEmergency && l1Gas.level === "LEVEL_1_LIFE_THREATENING", "Classifies gas leak as Level 1: Life-Threatening");
  assert(
    l1Gas.verbalResponse?.includes("Please step outside to safety immediately and dial emergency services (911 / 999 / 000)") === true,
    "Verbal response commands immediate evacuation and 911"
  );
  assert(l1Gas.callType === "emergency", "Tags call_type = 'emergency'");
  assert(
    l1Gas.actionRequiredByTeam === "IMMEDIATE SAFETY ALERT: Evacuation in progress",
    "Action tag = 'IMMEDIATE SAFETY ALERT: Evacuation in progress'"
  );
  assert(l1Gas.terminateBooking === true, "Terminates booking for Level 1 danger");

  // Level 1: Life-Threatening (Sparking breaker)
  const l1Sparks = checkEmergencySafety("There are sparks coming from breaker box and smoke from outlet");
  assert(l1Sparks.level === "LEVEL_1_LIFE_THREATENING", "Classifies sparking breaker box as Level 1: Life-Threatening");

  // Level 2: Property-Threatening (Burst pipe)
  const l2Pipe = checkEmergencySafety("We have a burst pipe in the basement causing massive flood water everywhere");
  assert(l2Pipe.isEmergency && l2Pipe.level === "LEVEL_2_PROPERTY_THREATENING", "Classifies burst pipe as Level 2: Property-Threatening");
  assert(
    l2Pipe.verbalResponse?.includes("This is an urgent situation. I am putting an immediate priority flag on this and dispatching an emergency technician alert to our on-call team right now.") === true,
    "Verbal response flags immediate urgent priority dispatch"
  );
  assert(
    l2Pipe.actionRequiredByTeam === "EMERGENCY DISPATCH: Urgent on-site technician required within 60 mins",
    "Action tag = 'EMERGENCY DISPATCH: Urgent on-site technician required within 60 mins'"
  );
  assert(l2Pipe.terminateBooking === false, "Does not terminate; proceeds to collect address for rapid dispatch");

  // ── TEST 3: After-Hours Intake Protocol ─────────────────────────────────────────
  console.log("\n--- 3. After-Hours Enterprise Intake Protocol ---");

  const sundayRef = new Date("2026-09-13T20:00:00Z"); // Sunday 8 PM
  let ahSession = makeEmptySession("HVAC");
  ahSession.lead.context = {
    value: `REF_DATE:${sundayRef.toISOString()}`,
    status: "VALID",
    confidence: 1.0,
    sourceTurn: 0,
    updatedTurn: 0,
  };

  const ahTurn0 = await processRelagentTurn({ session: ahSession, utterance: "" });
  assert(
    ahTurn0.response.includes("You have reached our after-hours reception desk") &&
    ahTurn0.response.includes("earliest priority appointment for tomorrow morning") &&
    ahTurn0.response.includes("active emergency requiring immediate on-call dispatch"),
    "Turn 0 uses exact after-hours opening context outside business hours"
  );

  // ── TEST 4: Verbal Closure Script & Call Conclusion Pipeline ──────────────────
  console.log("\n--- 4. Verbal Closure Script & Supabase Audit Pipeline ---");

  const testTicketId = generateTicketId(new Date());
  assert(/^TKT-\d{8}-[A-Z0-9]{4}$/.test(testTicketId), `Ticket format is valid: ${testTicketId}`);

  // Test full commitCallConclusion pipeline against Supabase
  const testCustomerMobile = `555${Math.floor(1000000 + Math.random() * 9000000)}`;
  const conclusionRes = await commitCallConclusion({
    customer: {
      fullLegalName: "Eleanor Vance",
      firstName: "Eleanor",
      mobileNumber: testCustomerMobile,
      serviceAddress: "742 Evergreen Terrace",
      city: "Austin",
      postalCode: "78701",
    },
    ticket: {
      ticketId: testTicketId,
      serviceCategory: "HVAC",
      reportedIssue: "AC unit blowing lukewarm air in master bedroom",
      scheduledDate: "2026-09-14",
      arrivalWindow: "09:00 AM - 12:00 PM",
      bookingStatus: "confirmed",
      isAfterHours: false,
    },
    callRecord: {
      ticketId: testTicketId,
      customerMobile: testCustomerMobile,
      callerMood: "pleasant",
      whyCustomerIsUpset: null,
      summaryForBusinessOwner: "New homeowner scheduled AC cooling diagnostic for Monday morning.",
      actionRequiredByTeam: "Assign diagnostic van for 09:00 AM - 12:00 PM arrival.",
      callTranscript: "Customer: Hi I need AC repair... Regent: Booked Ticket #TKT...",
      smsConfirmationSent: true,
      callType: "standard_booking",
    },
  });

  assert(conclusionRes.success, "Call conclusion pipeline successfully committed to Supabase");

  // Verify in PostgreSQL
  const client = new Client({ connectionString: SUPABASE_DB_URL });
  try {
    await client.connect();

    const checkCust = await client.query(
      "SELECT * FROM public.customers WHERE mobile_number = $1;",
      [testCustomerMobile]
    );
    assert(checkCust.rows.length === 1 && checkCust.rows[0].first_name === "Eleanor", "Customer record verified in Supabase");

    const checkTicket = await client.query(
      "SELECT * FROM public.service_tickets WHERE ticket_id = $1;",
      [testTicketId]
    );
    assert(
      checkTicket.rows.length === 1 &&
      checkTicket.rows[0].arrival_window === "09:00 AM - 12:00 PM",
      "Service ticket verified with arrival window in Supabase"
    );

    const checkRecord = await client.query(
      "SELECT * FROM public.call_records WHERE ticket_id = $1;",
      [testTicketId]
    );
    assert(
      checkRecord.rows.length === 1 &&
      checkRecord.rows[0].sms_confirmation_sent === true &&
      checkRecord.rows[0].call_type === "standard_booking",
      "Call record verified in Supabase with sms_confirmation_sent = true"
    );
  } finally {
    await client.end();
  }

  // ── TEST 5: Conversational Verification of Verbal Closure ──────────────────────
  console.log("\n--- 5. Regent Spoken Closure Script Verification ---");
  let confirmSession = makeEmptySession("HVAC");
  confirmSession.turnCount = 5;
  confirmSession.conversationHistory = [
    { role: "CUSTOMER", content: "Hi my AC is blowing warm air." },
    { role: "REGENT", content: "Got it! Here is what I have for your service request... Does that look correct, or do you need to change anything?" },
  ];
  confirmSession.lead.name = { value: "Eleanor Vance", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1 };
  confirmSession.lead.phone = { value: "5552345678", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1 };
  confirmSession.lead.address = { value: "742 Evergreen Terrace, Austin 78701", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1 };
  confirmSession.lead.problem = { value: "AC blowing warm air", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1 };
  confirmSession.lead.timing = { value: "2026-09-14 (09:00 AM - 12:00 PM)", status: "VALID", confidence: 1.0, sourceTurn: 1, updatedTurn: 1 };
  confirmSession.state = "READY_FOR_CONFIRMATION";

  const confirmTurn = await processRelagentTurn({
    session: confirmSession,
    utterance: "Yes, that looks correct!",
  });

  assert(
    confirmTurn.session.state === "CONFIRMED",
    "Session transitions to CONFIRMED state"
  );
  assert(
    Boolean(confirmTurn.session.ticketId),
    `Ticket ID generated: ${confirmTurn.session.ticketId}`
  );
  assert(
    confirmTurn.response.includes("Eleanor, you're all set!") &&
    confirmTurn.response.includes("Your appointment is confirmed under Ticket #") &&
    confirmTurn.response.includes("I have just sent a confirmation text message with your arrival window and technician details") &&
    confirmTurn.response.includes("have a wonderful rest of your day!"),
    "Regent speaks the exact required Verbal Closure Script"
  );

  console.log("\n================================================================================");
  console.log(`RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("================================================================================\n");

  if (passed === total) {
    console.log("🎉 ALL ARCHITECTURAL PATCH INVARIANTS VERIFIED SUCCESSFULLY!");
    process.exit(0);
  } else {
    console.error("❌ SOME TESTS FAILED");
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
