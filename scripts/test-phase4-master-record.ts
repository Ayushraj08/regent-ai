import { db } from '../src/lib/db/db-client';
import { createRequestWithCustomer, updateRequestField, cancelRequest } from '../src/lib/db/services/request-service';

async function main() {
  console.log("=== PHASE 4: MASTER RECORD PERSISTENCE TEST ===");

  const businessId = "TEST-BUSINESS";
  const conversationId = "test-conv-1";

  // 1. Clear database
  if (db.clearDatabase) {
    await db.clearDatabase();
    console.log("Database cleared.");
  }

  // 2. Create Request (simulating end of Phase 3)
  const { customer, request } = await createRequestWithCustomer(businessId, {
    name: "Ayush Phase 4",
    phone: "8005551234"
  }, {
    trade: "HVAC",
    requestType: "REPAIR",
    primaryService: "AC_REPAIR",
    problem: "It is blowing hot air",
    address: "123 Oak Street"
  }, conversationId);

  console.log(`Created Request: ${request.ticket_id}`);
  console.log(`Customer ID: ${customer.id}`);

  // 3. Verify it persists and can be retrieved
  const foundRequest = await db.findRequestByTicketId(request.ticket_id, businessId);
  if (!foundRequest) throw new Error("Could not find request by ticket ID");
  console.log(`Retrieved Request successfully.`);

  // 4. Update address
  console.log("Updating address to 132 Oak Street...");
  await updateRequestField(request.id, "test-conv-2", "service_address", "123 Oak Street", "132 Oak Street", "ADDRESS_CHANGED");

  // 5. Cancel request
  console.log("Cancelling request...");
  await cancelRequest(request.id, "test-conv-3");

  // 6. Verify final state
  const finalRequest = await db.findRequestByTicketId(request.ticket_id, businessId);
  console.log(`Final Address: ${finalRequest.service_address}`);
  console.log(`Final Status: ${finalRequest.status}`);

  if (finalRequest.service_address !== "132 Oak Street" || finalRequest.status !== "CANCELLED") {
    throw new Error("Persistence test failed.");
  }

  console.log("✅ PERSISTENCE TEST PASSED");
}

main().catch(console.error);
