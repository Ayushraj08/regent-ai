import { validateAddress, validatePhone } from "../src/lib/demo-engine/controller/validators";
import { generateResponse } from "../src/lib/demo-engine/controller/response-generator";
import { makeEmptySession } from "../src/lib/demo-engine/types";
import { mergeField } from "../src/lib/demo-engine/controller/field-merger";

function runTests() {
  console.log("=== PHASE 4 TEST: Input Validation ===");

  // Test 1: Phone missing area code
  const phoneRes = validatePhone("5551234");
  console.log(`Phone '5551234': isValid=${phoneRes.isValid}, reason=${phoneRes.reason}`);
  
  const session1 = makeEmptySession("HVAC");
  const mergedPhone = mergeField("phone", session1.lead.phone, { value: "5551234", status: "CAPTURED", confidence: 1.0 }, 1);
  session1.lead.phone = mergedPhone.updated;
  
  const prompt1 = generateResponse("CAPTURE_INFORMATION", "phone", "NEUTRAL", [], session1);
  console.log(`Phone Prompt: "${prompt1}"\n`);

  // Test 2: Address missing city/zip
  const addrRes = validateAddress("123 Main St");
  console.log(`Address '123 Main St': isValid=${addrRes.isValid}, reason=${addrRes.reason}`);
  
  const session2 = makeEmptySession("HVAC");
  const mergedAddr = mergeField("address", session2.lead.address, { value: "123 Main St", status: "CAPTURED", confidence: 1.0 }, 1);
  session2.lead.address = mergedAddr.updated;
  
  const prompt2 = generateResponse("CAPTURE_INFORMATION", "address", "NEUTRAL", [], session2);
  console.log(`Address Prompt: "${prompt2}"\n`);
}

runTests();
