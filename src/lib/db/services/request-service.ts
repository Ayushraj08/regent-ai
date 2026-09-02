import { db } from '../db-client';

export async function createRequestWithCustomer(businessId: string, customerData: any, requestData: any, conversationId: string) {
  let customer = null;
  
  // 1. Resolve or create customer
  if (customerData.phone) {
    customer = await db.findCustomerByPhone(customerData.phone, businessId);
  }
  
  if (!customer) {
    customer = await db.createCustomer({
      business_id: businessId,
      name: customerData.name,
      phone: customerData.phone
    });
  } else {
    // Optionally update name if new name is provided and we didn't have one
    if (customerData.name && !customer.name) {
      customer = await db.updateCustomer(customer.id, { name: customerData.name });
    }
  }

  // Determine country code from phone or default to US
  let countryCode = 'US';
  if (customerData.phone) {
    if (customerData.phone.startsWith('+91') || customerData.phone.startsWith('91')) countryCode = 'IND';
    else if (customerData.phone.startsWith('+44')) countryCode = 'UK';
    else if (customerData.phone.startsWith('+1')) countryCode = 'US';
  }
  
  const ticketNum = Math.floor(100 + Math.random() * 900); // 3 digits
  const ticketId = `REG${ticketNum}${countryCode}`;
  
  const request = await db.createServiceRequest({
    customer_id: customer.id,
    business_id: businessId,
    trade: requestData.trade,
    request_type: requestData.requestType,
    primary_service: requestData.primaryService,
    problem: requestData.problem,
    service_address: requestData.address,
    status: 'PENDING'
  });

  const ticket = await db.createTicket({
    service_request_id: request.id,
    business_id: businessId,
    public_reference: ticketId
  });

  // 3. Create Audit Event
  await db.createRequestEvent({
    service_request_id: request.id,
    conversation_id: conversationId,
    event_type: 'REQUEST_CREATED',
    new_value: request,
    source: 'SYSTEM'
  });

  return { customer, request, ticket };
}

export async function updateRequestField(requestId: string, conversationId: string, field: string, oldValue: any, newValue: any, eventType: string = 'FIELD_UPDATED') {
  // Update the request
  const updatePayload = { [field]: newValue };
  const updatedRequest = await db.updateServiceRequest(requestId, updatePayload);
  
  // Audit log
  await db.createRequestEvent({
    service_request_id: requestId,
    conversation_id: conversationId,
    event_type: eventType,
    old_value: { [field]: oldValue },
    new_value: { [field]: newValue },
    source: 'CUSTOMER_REPORTED'
  });

  return updatedRequest;
}

export async function cancelRequest(requestId: string, conversationId: string) {
  return updateRequestField(requestId, conversationId, 'status', 'PENDING', 'CANCELLED', 'CANCEL_REQUESTED');
}
