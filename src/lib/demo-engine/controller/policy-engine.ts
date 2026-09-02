/**
 * policy-engine.ts
 *
 * Processes the NLU response and updates the ConversationSession.
 * Delegates to specialized modules for each concern.
 *
 * This module is now a thin orchestrator:
 *   1. Merge extracted fields (field-merger)
 *   2. Canonicalize service + requestType (service-canonicalizer)
 *   3. Compute required/missing fields (required-fields)
 *   4. Resolve next action with action guard (next-action)
 */

import {
  ConversationSession,
  NLUResponse,
  isSettled
} from "../types";
import { mergeLeadFields } from "./field-merger";
import { canonicalizeService, canonicalizeRequestType, inferTrade } from "./service-canonicalizer";
import { resolveNextAction } from "./next-action";
import { getMissingRequiredFields } from "./required-fields";
import { recordFieldAnswered, syncLedgerWithFieldStatus } from "./question-ledger";
import { validateLeadForCompletion } from "./completion-gate";
import { getBusinessConfig, isBusinessOpen, evaluateServiceArea, isServiceSupported, BusinessConfig } from "../../db/services/policy-service";

// ─── Policy Result ─────────────────────────────────────────────────────────────

export interface PolicyResult {
  session: ConversationSession;
  shouldTransfer: boolean;
  complete: boolean;
  ticketId?: string | null;
}

// ─── Main evaluator ────────────────────────────────────────────────────────────

export async function evaluatePolicy(
  session: ConversationSession,
  nlu: NLUResponse,
  utterance: string
): Promise<PolicyResult> {

  let updated: ConversationSession = { ...session, turnCount: session.turnCount + 1 };

  // ── 1. Update intent + behavior from NLU ─────────────────────────────────
  updated.intent = nlu.intent;
  updated.customerBehavior = nlu.behavior;
  updated.safety = nlu.safety;

  // ── 2. Infer or update trade ──────────────────────────────────────────────
  if (!updated.trade) {
    const inferred = inferTrade(utterance);
    if (inferred) updated.trade = inferred as any;
  }

  // ── 3. Merge extracted lead fields ────────────────────────────────────────
  if (nlu.extracted) {
    const {
      name, phone, address, problem, urgency, timing, equipment, context,
      requestType: rawRT, service: rawSvc, additionalService: rawAdditional
    } = nlu.extracted;

    // Merge lead fields
    const { lead: mergedLead, corrections: newCorrections } = mergeLeadFields(
      updated.lead,
      { name, phone, address, problem, urgency, timing, equipment, context },
      updated.turnCount
    );
    updated.lead = mergedLead;
    updated.corrections = [...updated.corrections, ...newCorrections];

    // ── 4. Canonicalize requestType ────────────────────────────────────────
    if (rawRT) {
      const canonRT = canonicalizeRequestType(rawRT, utterance);
      if (canonRT) {
        if (!updated.requestType || updated.requestType === "UNKNOWN") {
          updated.requestType = canonRT;
        } else if (canonRT !== updated.requestType && canonRT !== "UNKNOWN") {
          updated.corrections = [...updated.corrections, {
            field: "requestType",
            oldValue: updated.requestType,
            newValue: canonRT,
            turn: updated.turnCount
          }];
          updated.requestType = canonRT;
        }
      }
    }

    // ── 5. Canonicalize primary service ───────────────────────────────────
    if (rawSvc) {
      const svcCanon = canonicalizeService(
        rawSvc,
        updated.trade,
        updated.requestType,
        utterance
      );

      if (svcCanon.serviceId) {
        if (!updated.primaryService) {
          updated.primaryService = svcCanon.serviceId;
        } else if (svcCanon.serviceId !== updated.primaryService && svcCanon.confidence > 0.7) {
          updated.corrections = [...updated.corrections, {
            field: "service",
            oldValue: updated.primaryService,
            newValue: svcCanon.serviceId,
            turn: updated.turnCount
          }];
          updated.primaryService = svcCanon.serviceId;
        }
      }
    }

    // ── 6. Handle additional service ──────────────────────────────────────
    if (rawAdditional) {
      const addlCanon = canonicalizeService(
        rawAdditional,
        updated.trade,
        updated.requestType,
        rawAdditional
      );
      if (addlCanon.serviceId && !updated.additionalServices.includes(addlCanon.serviceId)) {
        updated.additionalServices = [...updated.additionalServices, addlCanon.serviceId];
      }
    }

    // ── 7. Also try to extract service from the utterance directly if not found ──
    if (!updated.primaryService && updated.trade) {
      const directCanon = canonicalizeService(null, updated.trade, updated.requestType, utterance);
      if (directCanon.serviceId && directCanon.confidence >= 0.6) {
        updated.primaryService = directCanon.serviceId;
      }
    }
  }

  // ── 7.1. Explicit Binary Confirmation (Phase 2) ──────────────────────────
  if (session.state === "AWAITING_ISSUE_CONFIRMATION") {
    const textLower = utterance.toLowerCase();
    const isNoOrChange = /\b(no|wait|change|incorrect|wrong|not right)\b/.test(textLower) || nlu.isCorrection;
    
    console.log("[DEBUG] isNoOrChange check:", { isNoOrChange, textLower, isCorrection: nlu.isCorrection, state: session.state });

    if (isNoOrChange) {
      // If they explicitly reject but didn't provide a valid extraction, reset to collecting.
      // We will clear the field they want to correct if we knew it, but for now we just drop them into collecting.
      updated.state = "COLLECTING";
      // Force it to ask clarification
      if (nlu.extracted && Object.keys(nlu.extracted).length === 0) {
        updated.currentAction = "CLARIFY_FIELD";
      }
    }
  }

  // ── 7.5. Dynamic Ticket Lookup ───────────────────────────────────────────
  if (updated.lookupStatus === "FOUND") {
    const text = utterance.toLowerCase();
    const isYes = /\\b(yes|yeah|yep|correct|that's right|exactly|right)\\b/.test(text);
    const isNo = /\\b(no|nope|wrong|incorrect|not)\\b/.test(text);

    if (isYes || (!isNo && nlu.intent === "PROVIDE_INFORMATION")) {
      updated.lookupStatus = "CONFIRMED";
    } else if (isNo) {
      updated.lookupStatus = "REJECTED";
      // Clear the auto-populated data
      updated.lead.name = { ...updated.lead.name, status: "MISSING", value: null };
      updated.lead.phone = { ...updated.lead.phone, status: "MISSING", value: null };
      updated.lead.address = { ...updated.lead.address, status: "MISSING", value: null };
      updated.lead.reference_id = { ...updated.lead.reference_id, status: "MISSING", value: null };
    }
  } else if ((updated.intent === "COMPLAINT" || updated.intent === "EXISTING_CUSTOMER") && updated.lookupStatus === "IDLE") {
    const refId = updated.lead.reference_id?.value;
    const phone = updated.lead.phone?.value;
    
    if (refId && isSettled(updated.lead.reference_id.status)) {
      updated.lookupStatus = "SEARCHING";
      try {
        const { db } = await import("../../db/db-client");
        const ticket = await db.findTicketByPublicReference(refId, "00000000-0000-0000-0000-000000000001");
        if (ticket) {
          const request = await db.findServiceRequestById(ticket.service_request_id);
          if (request) {
            const customer = await db.findCustomerById(request.customer_id);
            if (customer) {
              updated.lookupData = { request, customer, ticket };
              updated.lookupStatus = "FOUND";
              updated.returningCustomer = true;
              updated.followUp = true;
              
              // Auto-populate session
              updated.lead.name = { value: customer.name, status: "CAPTURED", confidence: 1.0, sourceTurn: updated.turnCount, updatedTurn: updated.turnCount };
              updated.lead.phone = { value: customer.phone, status: "CAPTURED", confidence: 1.0, sourceTurn: updated.turnCount, updatedTurn: updated.turnCount };
              updated.lead.address = { value: request.service_address, status: "CAPTURED", confidence: 1.0, sourceTurn: updated.turnCount, updatedTurn: updated.turnCount };
              if (request.trade) updated.trade = request.trade as any;
              if (request.primary_service) updated.primaryService = request.primary_service;
              if (request.request_type) updated.requestType = request.request_type as any;
            } else {
              updated.lookupStatus = "NOT_FOUND";
            }
          } else {
            updated.lookupStatus = "NOT_FOUND";
          }
        } else {
          updated.lookupStatus = "NOT_FOUND";
        }
      } catch (e) {
        console.error("DB Lookup error", e);
        updated.lookupStatus = "NOT_FOUND";
      }
    } else if (phone && isSettled(updated.lead.phone.status)) {
      updated.lookupStatus = "SEARCHING";
      try {
        const { db } = await import("../../db/db-client");
        const customer = await db.findCustomerByPhone(phone, "00000000-0000-0000-0000-000000000001");
        if (customer) {
          const requests = await db.findRequestsByCustomer(customer.id);
          const request = requests.length > 0 ? requests[requests.length - 1] : null;
          
          if (request) {
            updated.lookupData = { request, customer };
            updated.lookupStatus = "FOUND";
            updated.returningCustomer = true;
            updated.lead.name = { value: customer.name, status: "CAPTURED", confidence: 1.0, sourceTurn: updated.turnCount, updatedTurn: updated.turnCount };
            updated.lead.address = { value: request.service_address, status: "CAPTURED", confidence: 1.0, sourceTurn: updated.turnCount, updatedTurn: updated.turnCount };
            
            // If they are calling back about an existing open request, we might auto-fill service.
            // But if it's a NEW request from a returning customer, we still need to ask what they need.
            // For now, let's auto-fill if it's recent (simulated).
            if (request.status !== 'CLOSED') {
               updated.followUp = true;
               if (request.trade) updated.trade = request.trade as any;
               if (request.primary_service) updated.primaryService = request.primary_service;
               if (request.request_type) updated.requestType = request.request_type as any;
            }
          } else {
            // Customer found, but no requests. Still a returning customer!
            updated.lookupData = { customer };
            updated.lookupStatus = "FOUND";
            updated.returningCustomer = true;
            updated.lead.name = { value: customer.name, status: "CAPTURED", confidence: 1.0, sourceTurn: updated.turnCount, updatedTurn: updated.turnCount };
          }
        } else {
          updated.lookupStatus = "NOT_FOUND";
        }
      } catch (e) {
        console.error("DB Lookup error", e);
        updated.lookupStatus = "NOT_FOUND";
      }
    }
  }

  // ── 8. Sync ledger with settled fields ────────────────────────────────────
  const settledFields: string[] = [];
  for (const [key, fieldData] of Object.entries(updated.lead)) {
    if (isSettled(fieldData.status)) settledFields.push(key);
  }
  if (updated.primaryService) settledFields.push("service");

  updated.questionLedger = syncLedgerWithFieldStatus(
    updated.questionLedger,
    settledFields,
    updated.turnCount
  );

  // ── 9. Safety check ───────────────────────────────────────────────────────
  if (nlu.safety.status === "CRITICAL" || nlu.intent === "EMERGENCY" || updated.lead.urgency?.value === "CRITICAL") {
    updated.state = "ESCALATED";
    updated.currentAction = "ESCALATE_SAFETY";
    updated.diagnosticReason = "Safety critical or emergency intent — escalating";
    return {
      session: updated,
      shouldTransfer: true,
      complete: false
    };
  }

  // ── 9.1. Change Limit Check (Phase 2) ─────────────────────────────────────
  if (updated.corrections.length > 2) {
    updated.state = "TRANSFER";
    updated.currentAction = "HANDLE_HUMAN_REQUEST";
    updated.diagnosticReason = "Exceeded 2-change limit — escalating to avoid confusion";
    return {
      session: updated,
      shouldTransfer: true,
      complete: false
    };
  }

  if (nlu.intent === "HUMAN_REQUEST") {
    updated.state = "TRANSFER";
    updated.currentAction = "HANDLE_HUMAN_REQUEST";
    updated.diagnosticReason = "Customer requested human transfer";
    return {
      session: updated,
      shouldTransfer: true,
      complete: false
    };
  }

  // ── 9.5. Complaint detected — mark intent but continue normal flow.
  // The complaint is handled AFTER all fields are merged and the next action is resolved.
  // This way, if the customer provides name/phone/address in the same turn as a complaint,
  // all fields are captured before we decide what to ask next.
  if (nlu.intent === "COMPLAINT") {
    updated.intent = "COMPLAINT";
    // If we have no problem description yet, we'll handle it via the action resolver below.
    // Do NOT early-return here — we must let the field merge + next-action run first.
  }

  // ── 9.8. Business Policy Engine (Phase 5) ──────────────────────────────────
  const businessConfig = await getBusinessConfig("00000000-0000-0000-0000-000000000001");
  if (businessConfig) {
    const isServiceable = evaluateServiceArea(businessConfig, updated.lead.address.value);
    const isOpen = isBusinessOpen(businessConfig);
    const isSupported = updated.primaryService && updated.trade ? isServiceSupported(businessConfig, updated.trade, updated.primaryService) : true;
    
    updated.policyDecision = {
      serviceAreaStatus: isServiceable,
      businessStatus: isOpen ? 'OPEN' : 'CLOSED',
      afterHoursStatus: !isOpen,
      safetyStatus: (nlu.safety.status as string) === "CRITICAL" ? 'CRITICAL' : 'NORMAL',
      serviceEligible: isSupported as boolean | null,
      prohibitedClaims: !isOpen ? ["unverified_arrival_time", "unverified_appointment", "immediate_service"] : [],
      allowedAction: 'CONTINUE'
    };

    if (isServiceable === 'NOT_SERVICEABLE') {
      updated.policyDecision.allowedAction = 'BLOCK';
      updated.currentAction = 'ANSWER_QUESTION';
      updated.state = 'CLOSED';
      updated.diagnosticReason = 'Address is outside service area';
      return { session: updated, shouldTransfer: false, complete: false };
    }

    if (!isSupported && updated.primaryService) {
      updated.policyDecision.allowedAction = 'BLOCK';
      updated.currentAction = 'ANSWER_QUESTION';
      updated.state = 'CLOSED';
      updated.diagnosticReason = 'Requested service is unsupported';
      return { session: updated, shouldTransfer: false, complete: false };
    }
  }

  // ── 10. Explicit end signal ────────────────────────────────────────────────
  const endSignal = nlu.intent === "END_CALL" || /(bye|that's all|we should end|i need to go|nothing else|end the call)/i.test(utterance);
  if (endSignal && session.state !== "START") {
    const completion = validateLeadForCompletion(updated);
    if (completion.complete) {
      // If complete, ensure ticket exists and gracefully close
      let ticketId = updated.ticketId;
      if (!ticketId) {
        let countryCode = 'US';
        if (updated.lead.phone?.value) {
          if (updated.lead.phone.value.startsWith('+91') || updated.lead.phone.value.startsWith('91')) countryCode = 'IND';
          else if (updated.lead.phone.value.startsWith('+44')) countryCode = 'UK';
          else if (updated.lead.phone.value.startsWith('+1')) countryCode = 'US';
        }
        ticketId = `REG${Math.floor(100 + Math.random() * 900)}${countryCode}`;
        updated.ticketId = ticketId;
        updated.finalizationStatus = "COMPLETE";
      }
      updated.state = "CLOSED";
      updated.currentAction = "CLOSE_CALL";
      updated.diagnosticReason = "Customer requested to end call — lead is complete, closing gracefully.";
      return {
        session: updated,
        shouldTransfer: false,
        complete: true,
        ticketId
      };
    } else {
      // Not complete, end early
      updated.state = "END";
      updated.currentAction = "CLOSE_CALL";
      updated.diagnosticReason = "Customer ended call before completion.";
      return {
        session: updated,
        shouldTransfer: false,
        complete: false,
        ticketId: updated.ticketId
      };
    }
  }

  // ── 11. Off-topic handling (Phase 7) ───────────────────────────────────────
  if (nlu.intent === "OFF_TOPIC") {
    updated.offTopicCount++;
    if (updated.offTopicCount >= 3) {
      updated.state = "CLOSED";
      updated.currentAction = "CLOSE_CALL";
      updated.diagnosticReason = "Exceeded 2-chance deflection limit for off-topic questions — ending call";
      return {
        session: updated,
        shouldTransfer: false,
        complete: false
      };
    } else {
      updated.currentAction = "CLARIFY_FIELD";
      updated.diagnosticReason = "Off-topic utterance — deflecting";
      return {
        session: updated,
        shouldTransfer: false,
        complete: false
      };
    }
  }

  // ── 12. Resolve next action (with action guard) ───────────────────────────
  console.log("[DEBUG] State before resolveNextAction:", updated.state);
  const resolution = resolveNextAction(updated);
  console.log("[DEBUG] Action returned by resolveNextAction:", resolution.action, resolution.nextState);

  updated.state = resolution.nextState;
  updated.currentAction = resolution.action;
  updated.missingFields = resolution.missingFields;
  updated.questionLedger = resolution.questionLedger;
  updated.diagnosticReason = resolution.reason;

  const complete = resolution.missingFields.length === 0;

  // Generate ticket if action is REVIEW_REQUIRED or CLOSE_CALL
  let ticketId = updated.ticketId ?? null;
  if ((resolution.action === "REVIEW_REQUIRED" || resolution.action === "CLOSE_CALL") && !ticketId) {
    updated.finalizationStatus = "IN_PROGRESS"; // Simulated lock
    let countryCode = 'US';
    if (updated.lead.phone?.value) {
      if (updated.lead.phone.value.startsWith('+91') || updated.lead.phone.value.startsWith('91')) countryCode = 'IND';
      else if (updated.lead.phone.value.startsWith('+44')) countryCode = 'UK';
      else if (updated.lead.phone.value.startsWith('+1')) countryCode = 'US';
    }
    ticketId = `REG${Math.floor(100 + Math.random() * 900)}${countryCode}`;
    updated.ticketId = ticketId;
    updated.finalizationStatus = "COMPLETE";
  }

  // Track closing counts
  if (resolution.action === "CONFIRM_REQUEST") {
    updated.issueConfirmationCount++;
  }
  if (resolution.action === "REVIEW_REQUIRED") {
    updated.anythingElsePromptCount++;
  }

  return {
    session: updated,
    shouldTransfer: false,
    complete,
    ticketId
  };
}
