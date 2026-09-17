import { checkOutsideOperatingHours, resolveArrivalWindow, resolveDateTime, normalizeTimeText } from "../src/lib/demo-engine/date-resolver";

function testCustomerScenario() {
  console.log("=== TESTING EXACT CUSTOMER SCENARIO ===");

  const inputs = [
    "Uh, yeah, you can schedule my call at 2:00 p.m..",
    "2:00 p.m.",
    "2:00 pm",
    "2pm",
    "at 2",
    "2:00",
    "1:00 p.m.",
    "afternoon",
    "8:00 pm",
    "at 7",
    "123 Main Street, 78701, Austin",
  ];

  for (const input of inputs) {
    const normalized = normalizeTimeText(input);
    const outCheck = checkOutsideOperatingHours(input);
    const window = resolveArrivalWindow(input);
    console.log(`\nInput: "${input}"`);
    console.log(`  Normalized: "${normalized}"`);
    console.log(`  isOutside: ${outCheck.isOutside}${outCheck.reason ? " (" + outCheck.reason + ")" : ""}`);
    console.log(`  Arrival Window: ${window}`);
  }

  // Test full flow:
  console.log("\n=== FULL TIMING RESOLUTION TEST ===");
  const refDate = new Date("2026-09-12T13:30:00-04:00"); // 1:30 PM EDT (afternoon)
  
  // Turn 1: "And I want to get this fixed today if there is any slot available."
  const t1 = resolveDateTime("And I want to get this fixed today if there is any slot available.", refDate);
  console.log("Turn 1 ('today if any slot available'):", {
    isResolved: t1.isResolved,
    exactDate: t1.exactDate,
    needsWindowClarification: t1.needsWindowClarification,
    clarificationPrompt: t1.windowClarificationPrompt,
  });

  // Turn 2: Customer responds "Uh, yeah, you can schedule my call at 2:00 p.m.."
  const customerReply = "Uh, yeah, you can schedule my call at 2:00 p.m..";
  const out2 = checkOutsideOperatingHours(customerReply);
  const win2 = resolveArrivalWindow(customerReply);
  console.log("Turn 2 ('Uh, yeah, you can schedule my call at 2:00 p.m..'):", {
    isOutside: out2.isOutside,
    resolvedWindow: win2,
    combinedResult: t1.exactDate && win2 ? `${t1.exactDate} (${win2})` : null,
  });

  if (out2.isOutside === false && win2 === "02:00 PM - 05:00 PM") {
    console.log("\n>>> PASS: 2:00 PM is correctly validated within operating hours and mapped to Late Afternoon arrival window!");
  } else {
    console.error("\n>>> FAIL: Expected isOutside=false and window='02:00 PM - 05:00 PM'");
    process.exit(1);
  }
}

testCustomerScenario();
