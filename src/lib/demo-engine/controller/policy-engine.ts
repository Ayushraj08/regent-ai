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

// ─── Policy Result ─────────────────────────────────────────────────────────────

export interface PolicyResult {
  session: ConversationSession;
  shouldTransfer: boolean;
  complete: boolean;
  ticketId?: string | null;
}

// ─── Main evaluator ────────────────────────────────────────────────────────────

export function evaluatePolicy(
  session: ConversationSession,
  nlu: NLUResponse,
  utterance: string
): PolicyResult {

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
    const canonRT = canonicalizeRequestType(rawRT, utterance);
    if (canonRT) {
      // Only update if we don't already have a settled requestType
      // (or if it's a correction to a different type)
      if (!updated.requestType || updated.requestType === "UNKNOWN") {
        updated.requestType = canonRT;
      } else if (canonRT !== updated.requestType && canonRT !== "UNKNOWN") {
        // Customer changed request type — treat as correction
        updated.corrections = [...updated.corrections, {
          field: "requestType",
          oldValue: updated.requestType,
          newValue: canonRT,
          turn: updated.turnCount
        }];
        updated.requestType = canonRT;
      }
    }

    // ── 5. Canonicalize primary service ───────────────────────────────────
    const svcCanon = canonicalizeService(
      rawSvc,
      updated.trade,
      updated.requestType,
      utterance
    );

    if (svcCanon.serviceId) {
      if (!updated.primaryService) {
        // First capture
        updated.primaryService = svcCanon.serviceId;
      } else if (svcCanon.serviceId !== updated.primaryService && svcCanon.confidence > 0.7) {
        // Service changed — track correction
        updated.corrections = [...updated.corrections, {
          field: "service",
          oldValue: updated.primaryService,
          newValue: svcCanon.serviceId,
          turn: updated.turnCount
        }];
        updated.primaryService = svcCanon.serviceId;
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
  if (nlu.safety.status === "CRITICAL") {
    updated.state = "ESCALATED";
    updated.currentAction = "ESCALATE";
    updated.diagnosticReason = "Safety critical — escalating";
    return {
      session: updated,
      shouldTransfer: true,
      complete: false
    };
  }

  if (nlu.intent === "HUMAN_REQUEST") {
    updated.state = "TRANSFER";
    updated.currentAction = "TRANSFER";
    updated.diagnosticReason = "Customer requested human transfer";
    return {
      session: updated,
      shouldTransfer: true,
      complete: false
    };
  }

  // ── 9.5. Complaint De-escalation ─────────────────────────────────────
  if (nlu.intent === "COMPLAINT" && !isSettled(updated.lead.problem.status)) {
    updated.currentAction = "HANDLE_COMPLAINT";
    updated.diagnosticReason = "Customer is complaining — attempting de-escalation to get problem details";
    return {
      session: updated,
      shouldTransfer: false,
      complete: false
    };
  }

  // ── 10. Explicit end signal ────────────────────────────────────────────────
  const endSignal = nlu.intent === "END_CALL" || /(bye|that's all|we should end|i need to go|nothing else|end the call)/i.test(utterance);
  if (endSignal && session.state !== "START") {
    const ticketId = session.ticketId || `REG-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    updated.state = "END";
    updated.currentAction = "CLOSE";
    updated.ticketId = ticketId;
    updated.diagnosticReason = "Customer ended call";
    return {
      session: updated,
      shouldTransfer: false,
      complete: true,
      ticketId
    };
  }

  // ── 11. Off-topic handling ─────────────────────────────────────────────────
  if (nlu.intent === "OFF_TOPIC") {
    updated.currentAction = "CLARIFY";
    updated.diagnosticReason = "Off-topic utterance — clarifying";
    return {
      session: updated,
      shouldTransfer: false,
      complete: false
    };
  }

  // ── 12. Resolve next action (with action guard) ───────────────────────────
  const resolution = resolveNextAction(updated);

  updated.state = resolution.nextState;
  updated.currentAction = resolution.action;
  updated.missingFields = resolution.missingFields;
  updated.questionLedger = resolution.questionLedger;
  updated.diagnosticReason = resolution.reason;

  const complete = resolution.missingFields.length === 0;

  // Generate ticket if complete and moving to confirmation
  let ticketId = session.ticketId ?? null;
  if (complete && resolution.nextState !== "COLLECTING" && !ticketId) {
    ticketId = `REG-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    updated.ticketId = ticketId;
  }

  return {
    session: updated,
    shouldTransfer: false,
    complete,
    ticketId
  };
}
