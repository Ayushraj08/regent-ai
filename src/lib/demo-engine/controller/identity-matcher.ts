import { db } from '../../db/db-client';
import { ConversationSession, Trade, Intent } from '../types';

export type MatchConfidence = 'MATCH_CONFIRMED' | 'MATCH_HIGH_CONFIDENCE' | 'MATCH_AMBIGUOUS' | 'NO_MATCH';

export interface MatchResult {
  confidence: "NO_MATCH" | "MATCH_UNLIKELY" | "MATCH_POSSIBLE" | "MATCH_HIGH_CONFIDENCE" | "MATCH_CONFIRMED" | "MATCH_AMBIGUOUS";
  customer?: any;
  request?: any;
  ticket?: any;
  reason?: string;
}

export async function resolveExistingRequest(
  businessId: string,
  providedPhone: string | null,
  providedTicketId: string | null,
  trade: Trade | null
): Promise<MatchResult> {
  // 1. Exact Ticket Match
  if (providedTicketId) {
    const ticket = await db.findTicketByPublicReference(providedTicketId, businessId);
    if (ticket) {
      const request = await db.findServiceRequestById(ticket.service_request_id);
      if (request) {
        const customer = await db.findCustomerById(request.customer_id);
        return {
          confidence: 'MATCH_CONFIRMED',
          customer,
          request,
          ticket,
          reason: 'TICKET_MATCH'
        };
      }
    }
  }

  // 2. Exact Phone Match
  if (providedPhone) {
    const customer = await db.findCustomerByPhone(providedPhone, businessId);
    if (customer) {
      const requests = await db.findRequestsByCustomer(customer.id);
      
      // Filter by trade if known
      const relevantRequests = trade 
        ? requests.filter((r: any) => r.trade === trade && r.status !== 'CLOSED')
        : requests.filter((r: any) => r.status !== 'CLOSED');

      if (relevantRequests.length === 1) {
        return { confidence: 'MATCH_HIGH_CONFIDENCE', customer, request: relevantRequests[0], reason: 'PHONE_SINGLE_ACTIVE' };
      } else if (relevantRequests.length > 1) {
        return { confidence: 'MATCH_AMBIGUOUS', customer, request: null, reason: 'PHONE_MULTIPLE_ACTIVE' };
      } else {
        // No active requests, but customer exists
        return { confidence: 'MATCH_CONFIRMED', customer, request: null, reason: 'PHONE_NO_ACTIVE' };
      }
    }
  }

  return { confidence: 'NO_MATCH', customer: null, request: null, reason: 'NOT_FOUND' };
}
