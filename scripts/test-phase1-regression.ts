/**
 * test-phase1-regression.ts
 *
 * Phase 1 regression test suite.
 * Tests all invariants specified in §25, §26, §35-§38.
 *
 * Run: npx ts-node -r dotenv/config --project tsconfig.json scripts/test-phase1-regression.ts dotenv_config_path=.env.local
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// We test the engine purely at the application layer (no HTTP calls)
import { makeEmptySession, ConversationSession } from "../src/lib/demo-engine/types";
import { canonicalizeService, canonicalizeRequestType, inferTrade } from "../src/lib/demo-engine/controller/service-canonicalizer";
import { getMissingRequiredFields, getRequiredFields } from "../src/lib/demo-engine/controller/required-fields";
import { mergeLeadFields } from "../src/lib/demo-engine/controller/field-merger";
import { validatePhone, validateAddress, validateName } from "../src/lib/demo-engine/controller/validators";
import { resolveNextAction } from "../src/lib/demo-engine/controller/next-action";

// ─── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } catch (err: any) {
    console.log(`  ❌ FAIL  ${name}`);
    console.log(`           ${err.message}`);
    failed++;
    failures.push(`${name}: ${err.message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEq<T>(actual: T, expected: T, field: string) {
  if (actual !== expected) {
    throw new Error(`${field}: expected "${expected}", got "${actual}"`);
  }
}

function makeSession(
  trade: "HVAC" | "PLUMBING" | "ELECTRICAL" | null,
  opts: Partial<ConversationSession> = {}
): ConversationSession {
  return { ...makeEmptySession(trade), ...opts };
}

// ─── 1. Service Canonicalization Tests ───────────────────────────────────────

console.log("\n═══ 1. SERVICE CANONICALIZATION ═══");

test("'I need AC installation' → AC_INSTALLATION", () => {
  const r = canonicalizeService("AC installation", "HVAC", "INSTALLATION", "I need AC installation");
  assert(r.serviceId === "AC_INSTALLATION", `got ${r.serviceId}`);
});

test("'I bought a new AC and need someone to install it' → AC_INSTALLATION", () => {
  const r = canonicalizeService(null, "HVAC", "INSTALLATION", "I bought a new AC and need someone to install it");
  assert(r.serviceId === "AC_INSTALLATION", `got ${r.serviceId}`);
});

test("'Put my new air conditioner in' → AC_INSTALLATION", () => {
  const r = canonicalizeService(null, "HVAC", "INSTALLATION", "Put my new air conditioner in");
  assert(r.serviceId === "AC_INSTALLATION", `got ${r.serviceId}`);
});

test("'Can you install the unit that was just delivered?' → AC_INSTALLATION", () => {
  const r = canonicalizeService(null, "HVAC", "INSTALLATION", "Can you install the unit that was just delivered?");
  assert(r.serviceId === "AC_INSTALLATION", `got ${r.serviceId}`);
});

test("'hook up this air conditioner' → AC_INSTALLATION", () => {
  const r = canonicalizeService("AC installation", "HVAC", "INSTALLATION", "hook up this air conditioner");
  assert(r.serviceId === "AC_INSTALLATION", `got ${r.serviceId}`);
});

test("'My AC stopped cooling' → AC_REPAIR", () => {
  const r = canonicalizeService(null, "HVAC", "REPAIR", "My AC stopped cooling");
  assert(r.serviceId === "AC_REPAIR", `got ${r.serviceId}`);
});

test("'It's blowing warm air' → AC_REPAIR", () => {
  const r = canonicalizeService("AC repair", "HVAC", "REPAIR", "blowing warm air");
  assert(r.serviceId === "AC_REPAIR", `got ${r.serviceId}`);
});

test("'My air conditioner died' → AC_REPAIR", () => {
  const r = canonicalizeService(null, "HVAC", "REPAIR", "My air conditioner died");
  assert(r.serviceId === "AC_REPAIR", `got ${r.serviceId}`);
});

test("'I want to get my AC serviced' → AC_MAINTENANCE", () => {
  const r = canonicalizeService(null, "HVAC", "MAINTENANCE", "I want to get my AC serviced");
  assert(r.serviceId === "AC_MAINTENANCE", `got ${r.serviceId}`);
});

test("'I want to replace my old AC' → AC_REPLACEMENT (or AC_INSTALLATION)", () => {
  const r = canonicalizeService("AC replacement", "HVAC", "REPLACEMENT", "I want to replace my old AC");
  assert(r.serviceId === "AC_REPLACEMENT" || r.serviceId === "AC_INSTALLATION", `got ${r.serviceId}`);
});

test("Plumbing: 'I have a water leak' → LEAK_REPAIR", () => {
  const r = canonicalizeService(null, "PLUMBING", "REPAIR", "I have a water leak");
  assert(r.serviceId === "LEAK_REPAIR", `got ${r.serviceId}`);
});

test("Electrical: 'my outlet isn't working' → OUTLET_REPAIR", () => {
  const r = canonicalizeService(null, "ELECTRICAL", "REPAIR", "my outlet isn't working");
  assert(r.serviceId === "OUTLET_REPAIR", `got ${r.serviceId}`);
});

// ─── 2. Request Type Canonicalization ─────────────────────────────────────────

console.log("\n═══ 2. REQUEST TYPE CANONICALIZATION ═══");

test("'INSTALLATION' → INSTALLATION", () => {
  assertEq(canonicalizeRequestType("INSTALLATION"), "INSTALLATION", "requestType");
});

test("'installation' → INSTALLATION", () => {
  assertEq(canonicalizeRequestType("installation"), "INSTALLATION", "requestType");
});

test("'install' in utterance → INSTALLATION", () => {
  assertEq(canonicalizeRequestType(null, "I need someone to install my AC"), "INSTALLATION", "requestType");
});

test("'repair' → REPAIR", () => {
  assertEq(canonicalizeRequestType("REPAIR"), "REPAIR", "requestType");
});

test("'maintenance' → MAINTENANCE", () => {
  assertEq(canonicalizeRequestType("MAINTENANCE"), "MAINTENANCE", "requestType");
});

test("'how much would it cost' → ESTIMATE", () => {
  assertEq(canonicalizeRequestType(null, "how much would it cost to replace my AC"), "ESTIMATE", "requestType");
});

// ─── 3. Required Fields — Installation MUST NOT require problem ──────────────

console.log("\n═══ 3. REQUIRED FIELDS ═══");

test("HVAC+INSTALLATION: problem is NOT required", () => {
  const session = makeSession("HVAC", {
    requestType: "INSTALLATION",
    primaryService: "AC_INSTALLATION",
  });
  const required = getRequiredFields(session);
  assert(!required.includes("problem"), `problem should not be required for INSTALLATION; got: ${required}`);
});

test("HVAC+REPAIR: problem IS required", () => {
  const session = makeSession("HVAC", {
    requestType: "REPAIR",
    primaryService: "AC_REPAIR",
  });
  const required = getRequiredFields(session);
  assert(required.includes("problem"), `problem should be required for REPAIR`);
});

test("HVAC+MAINTENANCE: problem is NOT required", () => {
  const session = makeSession("HVAC", {
    requestType: "MAINTENANCE",
    primaryService: "AC_MAINTENANCE",
  });
  const required = getRequiredFields(session);
  assert(!required.includes("problem"), `problem should not be required for MAINTENANCE`);
});

test("HVAC+ESTIMATE: problem is NOT required", () => {
  const session = makeSession("HVAC", {
    requestType: "ESTIMATE",
    primaryService: "HVAC_ESTIMATE",
  });
  const required = getRequiredFields(session);
  assert(!required.includes("problem"), `problem should not be required for ESTIMATE`);
});

// ─── 4. Hard Invariant — Service Already Captured → NOT in missing fields ─────

console.log("\n═══ 4. ACTION GUARD INVARIANT ═══");

test("§26: AC_INSTALLATION captured → ASK_FIELD(service) is impossible", () => {
  const session: ConversationSession = {
    ...makeSession("HVAC"),
    requestType: "INSTALLATION",
    primaryService: "AC_INSTALLATION",
    lead: {
      ...makeEmptySession("HVAC").lead,
      name: { value: null, status: "MISSING", confidence: 0, sourceTurn: 0, updatedTurn: 0 }
    }
  };
  const resolution = resolveNextAction(session);
  assert(resolution.targetField !== "service", `Should not ask for service when primaryService=AC_INSTALLATION; got targetField=${resolution.targetField}`);
  assert(resolution.action === "ASK_FIELD", `Should be asking for something; got ${resolution.action}`);
  assert(resolution.targetField === "name" || resolution.targetField === "phone" || resolution.targetField === "address",
    `Should ask for name/phone/address next; got ${resolution.targetField}`);
});

test("§25: CAPTURED field is never selected as missing", () => {
  const session: ConversationSession = {
    ...makeSession("HVAC"),
    requestType: "REPAIR",
    primaryService: "AC_REPAIR",
    lead: {
      ...makeEmptySession("HVAC").lead,
      name: { value: "Ayush", status: "CAPTURED", confidence: 0.99, sourceTurn: 1, updatedTurn: 1 },
      phone: { value: "1234567890", status: "CAPTURED", confidence: 0.99, sourceTurn: 1, updatedTurn: 1 },
      address: { value: "123 Main St, New York", status: "CAPTURED", confidence: 0.99, sourceTurn: 1, updatedTurn: 1 },
      problem: { value: null, status: "MISSING", confidence: 0, sourceTurn: 0, updatedTurn: 0 },
      urgency: { value: null, status: "MISSING", confidence: 0, sourceTurn: 0, updatedTurn: 0 },
    }
  };
  const missing = getMissingRequiredFields(session);
  assert(!missing.includes("name"), "name should not be in missing when CAPTURED");
  assert(!missing.includes("phone"), "phone should not be in missing when CAPTURED");
  assert(!missing.includes("address"), "address should not be in missing when CAPTURED");
  assert(!missing.includes("service"), "service should not be in missing when primaryService is set");
});

// ─── 5. Field Validators ──────────────────────────────────────────────────────

console.log("\n═══ 5. FIELD VALIDATORS ═══");

test("Phone: 10-digit → CAPTURED", () => {
  const r = validatePhone("1234567890");
  assertEq(r.status, "CAPTURED", "phone status");
});

test("Phone: 9-digit → INVALID", () => {
  const r = validatePhone("848848833");
  assertEq(r.status, "INVALID", "phone status");
  assert(!r.isValid, "should be invalid");
});

test("Phone: 8-digit → INVALID", () => {
  const r = validatePhone("12345678");
  assertEq(r.status, "INVALID", "phone status");
});

test("Phone: 11-digit with leading 1 → CAPTURED (normalized to 10)", () => {
  const r = validatePhone("11234567890");
  assertEq(r.status, "CAPTURED", "phone status");
  assertEq(r.normalizedValue, "1234567890", "normalized");
});

test("Address: 'Bihar' → AMBIGUOUS", () => {
  const r = validateAddress("Bihar");
  assertEq(r.status, "AMBIGUOUS", "address status");
});

test("Address: 'New York' → AMBIGUOUS (city + state only)", () => {
  const r = validateAddress("New York");
  assertEq(r.status, "AMBIGUOUS", "address status");
});

test("Address: '123 Main Street' → CAPTURED", () => {
  const r = validateAddress("123 Main Street");
  assertEq(r.status, "CAPTURED", "address status");
});

test("Name: 'Ayush' → CAPTURED", () => {
  const r = validateName("Ayush");
  assertEq(r.status, "CAPTURED", "name status");
});

test("Name: 'A' → INVALID (too short)", () => {
  const r = validateName("A");
  assertEq(r.status, "INVALID", "name status");
});

// ─── 6. Field Merger — Never Erases Settled Fields ───────────────────────────

console.log("\n═══ 6. FIELD MERGER INVARIANTS ═══");

test("Settled field not erased when LLM returns null", () => {
  const session = makeSession("HVAC");
  const lead = {
    ...session.lead,
    name: { value: "Ayush", status: "CAPTURED" as const, confidence: 0.99, sourceTurn: 1, updatedTurn: 1 }
  };
  const { lead: merged } = mergeLeadFields(lead, { name: { value: null, status: "MISSING", confidence: 0, sourceTurn: 0, updatedTurn: 0 } }, 2);
  assertEq(merged.name.value, "Ayush", "name.value should not be erased");
  assertEq(merged.name.status, "CAPTURED", "name.status should not be erased");
});

test("Settled field updated as correction when new non-empty value given", () => {
  const session = makeSession("HVAC");
  const lead = {
    ...session.lead,
    address: { value: "123 Oak", status: "CAPTURED" as const, confidence: 0.9, sourceTurn: 1, updatedTurn: 1 }
  };
  const { lead: merged, corrections } = mergeLeadFields(
    lead,
    { address: { value: "132 Oak Street", status: "CAPTURED", confidence: 0.9, sourceTurn: 2, updatedTurn: 2 } },
    2
  );
  assertEq(merged.address.value, "132 Oak Street", "address.value should be updated");
  assertEq(merged.address.status, "CORRECTED", "address.status should be CORRECTED");
  assert(corrections.length > 0, "Should have a correction record");
  assertEq(corrections[0].field, "address", "correction field");
  assertEq(corrections[0].oldValue, "123 Oak", "old value");
});

test("Invalid field (INVALID phone) not treated as settled", () => {
  const session = makeSession("HVAC");
  const lead = {
    ...session.lead,
    phone: { value: "12345", status: "INVALID" as const, confidence: 0.5, sourceTurn: 1, updatedTurn: 1 }
  };
  const { lead: merged } = mergeLeadFields(
    lead,
    { phone: { value: "1234567890", status: "CAPTURED", confidence: 0.99, sourceTurn: 2, updatedTurn: 2 } },
    2
  );
  assertEq(merged.phone.value, "1234567890", "phone should be updated");
  assertEq(merged.phone.status, "CAPTURED", "phone status");
});

// ─── 7. Trade Inference ───────────────────────────────────────────────────────

console.log("\n═══ 7. TRADE INFERENCE ═══");

test("'AC installation' → HVAC", () => {
  assertEq(inferTrade("I need AC installation"), "HVAC", "trade");
});

test("'leaking pipe' → PLUMBING", () => {
  assertEq(inferTrade("I have a leaking pipe"), "PLUMBING", "trade");
});

test("'outlet not working' → ELECTRICAL", () => {
  assertEq(inferTrade("my outlet is not working"), "ELECTRICAL", "trade");
});

// ─── 8. Multi-field extraction (structural test) ───────────────────────────────

console.log("\n═══ 8. MULTI-FIELD MERGE ═══");

test("Multi-field: merge name+phone+address+service in one pass", () => {
  const session = makeSession("HVAC");
  const { lead: merged } = mergeLeadFields(session.lead, {
    name: { value: "Ayush", status: "CAPTURED", confidence: 0.99, sourceTurn: 1, updatedTurn: 1 },
    phone: { value: "1234567890", status: "CAPTURED", confidence: 0.99, sourceTurn: 1, updatedTurn: 1 },
    address: { value: "123 Main Street, New York 10001", status: "CAPTURED", confidence: 0.9, sourceTurn: 1, updatedTurn: 1 },
  }, 1);
  assertEq(merged.name.status, "CAPTURED", "name.status");
  assertEq(merged.phone.status, "CAPTURED", "phone.status");
  assertEq(merged.address.status, "CAPTURED", "address.status");
});

// ─── 9. Complete Installation Flow ────────────────────────────────────────────

console.log("\n═══ 9. INSTALLATION FLOW REGRESSION (§38) ═══");

test("§38: 'Hi I am Ayush and I need AC installation' → does NOT produce ASK_FIELD(service) or ASK_FIELD(requestType)", () => {
  // Simulate what happens after NLU + policy for this utterance
  const session: ConversationSession = {
    ...makeSession("HVAC"),
    requestType: "INSTALLATION",
    primaryService: "AC_INSTALLATION",
    lead: {
      ...makeEmptySession("HVAC").lead,
      name: { value: "Ayush", status: "CAPTURED", confidence: 0.99, sourceTurn: 1, updatedTurn: 1 },
    }
  };
  const resolution = resolveNextAction(session);
  assert(resolution.targetField !== "service",
    `Should NOT ask for service (primaryService=AC_INSTALLATION); got ${resolution.targetField}`);
  assert(
    !["service", "requestType"].includes(resolution.targetField ?? ""),
    `Should NOT ask for service/requestType; got ${resolution.targetField}`
  );
});

test("§38: After name given, next ask should be phone (not service)", () => {
  const session: ConversationSession = {
    ...makeSession("HVAC"),
    requestType: "INSTALLATION",
    primaryService: "AC_INSTALLATION",
    lead: {
      ...makeEmptySession("HVAC").lead,
      name: { value: "Ayush", status: "CAPTURED", confidence: 0.99, sourceTurn: 1, updatedTurn: 1 },
    }
  };
  const resolution = resolveNextAction(session);
  assertEq(resolution.targetField, "phone", "next field after name");
});

test("§38: After name+phone given, next ask should be address", () => {
  const session: ConversationSession = {
    ...makeSession("HVAC"),
    requestType: "INSTALLATION",
    primaryService: "AC_INSTALLATION",
    lead: {
      ...makeEmptySession("HVAC").lead,
      name: { value: "Ayush", status: "CAPTURED", confidence: 0.99, sourceTurn: 1, updatedTurn: 1 },
      phone: { value: "1234567890", status: "CAPTURED", confidence: 0.99, sourceTurn: 1, updatedTurn: 1 },
    }
  };
  const resolution = resolveNextAction(session);
  assertEq(resolution.targetField, "address", "next field after name+phone");
});

test("§38: After name+phone+address given for INSTALLATION → next is urgency (not problem, not service)", () => {
  const session: ConversationSession = {
    ...makeSession("HVAC"),
    requestType: "INSTALLATION",
    primaryService: "AC_INSTALLATION",
    lead: {
      ...makeEmptySession("HVAC").lead,
      name: { value: "Ayush", status: "CAPTURED", confidence: 0.99, sourceTurn: 1, updatedTurn: 1 },
      phone: { value: "1234567890", status: "CAPTURED", confidence: 0.99, sourceTurn: 1, updatedTurn: 1 },
      address: { value: "123 Main St", status: "CAPTURED", confidence: 0.99, sourceTurn: 1, updatedTurn: 1 },
    }
  };
  const resolution = resolveNextAction(session);
  assert(resolution.targetField !== "service", "Should not ask for service");
  assert(resolution.targetField !== "problem", "Should not ask for problem (INSTALLATION)");
  assert(resolution.targetField === "urgency" || resolution.action === "CONFIRM",
    `Expected urgency or CONFIRM; got action=${resolution.action} targetField=${resolution.targetField}`);
});

// ─── Final Summary ─────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(60));
console.log(`  RESULTS: ${passed} PASS  ${failed} FAIL  (total ${passed + failed})`);
if (failures.length > 0) {
  console.log("\n  FAILURES:");
  failures.forEach(f => console.log(`    - ${f}`));
}
console.log("═".repeat(60));

if (failed > 0) {
  process.exit(1);
} else {
  console.log("\n  ✅ All Phase 1 regression tests passed.\n");
}
