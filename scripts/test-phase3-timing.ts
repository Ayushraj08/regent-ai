import { validateTiming } from "../src/lib/demo-engine/controller/validators";

function runTests() {
  console.log("=== PHASE 3 TEST: Date/Time Resolution ===");
  const testCases = [
    "tomorrow morning",
    "Wednesday afternoon",
    "tonight",
    "next Monday",
    "this Friday evening",
    "whenever",
    "ASAP"
  ];

  for (const tc of testCases) {
    const res = validateTiming(tc);
    console.log(`Input: "${tc}" => Resolved: "${res.normalizedValue}"`);
  }
}

runTests();
