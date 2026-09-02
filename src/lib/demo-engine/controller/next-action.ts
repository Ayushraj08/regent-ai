/**
 * next-action.ts
 *
 * Resolves the next action for the conversation, with a mandatory Action Guard.
 *
 * This runs AFTER:
 *   1. State extraction (NLU)
 *   2. Field merge (field-merger.ts)
 *   3. Validation (validators.ts)
 *   4. Missing field computation (required-fields.ts)
 *
 * The Action Guard prevents the engine from asking for a field that is already
 * in a settled state. This is a hard invariant — LLM output cannot override it.
 */

import {
  ConversationSession,
  ActionType,
  ConversationState,
  isSettled,
  isTerminalStatus,
  QuestionLedgerEntry
} from "../types";
import { getMissingRequiredFields } from "./required-fields";
import { validateLeadForCompletion } from "./completion-gate";
import {
  isFieldBlockedByLedger,
  recordQuestionAsked,
  syncLedgerWithFieldStatus,
} from "./question-ledger";
import { getLeadField } from "./field-merger";

// ─── Action Resolution Result ─────────────────────────────────────────────────

export interface ActionResolution {
  action: ActionType;
  targetField: string | undefined;
  nextState: ConversationState;
  missingFields: string[];
  questionLedger: QuestionLedgerEntry[];
  reason: string;   // for dev diagnostic
}

// ─── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve the next action for the conversation.
 *
 * Priority order:
 * 1. Safety / human transfer (handled upstream in state-machine.ts)
 * 2. Compute missing fields
 * 3. For each missing field, apply Action Guard
 * 4. Ask for the first genuinely missing field
 * 5. If no missing fields → transition to confirmation
 */
export function resolveNextAction(session: ConversationSession): ActionResolution {
  const currentTurn = session.turnCount;

  // ── Compute settled fields for ledger sync ─────────────────────────────────
  const settledFields: string[] = [];
  for (const [key, fieldData] of Object.entries(session.lead)) {
    if (fieldData && isSettled(fieldData.status)) settledFields.push(key);
  }
  if (session.primaryService) settledFields.push("service");

  // ── Sync ledger with current field status ──────────────────────────────────
  let ledger = syncLedgerWithFieldStatus(
    session.questionLedger,
    settledFields,
    currentTurn
  );

  // ── Get missing required fields via Authoritative Gate ─────────────────────
  const completion = validateLeadForCompletion(session);
  const missingFields = [...completion.missingFields, ...completion.invalidFields, ...completion.ambiguousFields];

  if (completion.complete && session.currentAction !== "CLARIFY_FIELD") {
    // All fields collected — move to confirmation or close
    const resolution = resolveCompletionAction(session);
    return {
      ...resolution,
      missingFields: [],
      questionLedger: ledger,
    };
  }

  // ── 7.5 Check for Ticket Lookup Confirmation ──────────────────────────────
  if (session.lookupStatus === "FOUND") {
    return {
      action: "IDENTIFY_RETURNING_CUSTOMER",
      targetField: undefined,
      nextState: "CONFIRM_LOOKUP",
      missingFields,
      questionLedger: ledger,
      reason: "DB lookup found an existing ticket/customer, need confirmation"
    };
  }

  // ── Action Guard + Field Selection ────────────────────────────────────────
  for (const field of missingFields) {
    // ── HARD INVARIANT: Never ask for a settled field ──────────────────────
    let fieldStatus: string | undefined = undefined;

    if (field === "service") {
      // Virtual field — check session.primaryService
      if (session.primaryService) {
        console.error(
          `[ACTION GUARD] BLOCKED: tried to ask for 'service' but primaryService=${session.primaryService}. This is a bug.`
        );
        continue;
      }
      fieldStatus = session.primaryService ? "CAPTURED" : "MISSING";
    } else {
      const fieldData = getLeadField(session.lead, field);
      fieldStatus = fieldData?.status;
      if (fieldData && isSettled(fieldData.status)) {
        console.error(
          `[ACTION GUARD] BLOCKED: tried to ask for '${field}' but status=${fieldData.status}. This is a bug.`
        );
        continue;
      }
    }

    // ── For COMPLAINT intent, problem is still collected normally.
    // RECOVERY fires only when everything else is done and problem is still missing.
    // Do NOT skip it here.

    // ── Ledger check: skip if blocked ─────────────────────────────────────
    if (isFieldBlockedByLedger(ledger, field, currentTurn, fieldStatus)) {
      // This field was just asked — skip for now (will clarify if customer doesn't answer)
      continue;
    }

    // ── This is the field to ask about ───────────────────────────────────
    ledger = recordQuestionAsked(ledger, field, currentTurn);

    return {
      action: "CAPTURE_INFORMATION",
      targetField: field,
      nextState: "COLLECTING",
      missingFields,
      questionLedger: ledger,
      reason: `Missing field: ${field}`
    };
  }

  // ── COMPLAINT special path: ask about the problem FIRST ──
  if (session.intent === "COMPLAINT" && !isSettled(session.lead.problem?.status)) {
    if (!isFieldBlockedByLedger(ledger, "problem", currentTurn, session.lead.problem?.status)) {
      ledger = recordQuestionAsked(ledger, "problem", currentTurn);
      return {
        action: "RECOVERY",
        targetField: "problem", // explicitly ask for problem
        nextState: "COLLECTING",
        missingFields,
        questionLedger: ledger,
        reason: "Complaint intent — prioritizing problem details before other fields"
      };
    }
  }

  // All missing fields are either blocked or guarded — clarify
  // (This prevents infinite loops where we can't ask anything)
  return {
    action: "CLARIFY_FIELD",
    targetField: undefined,
    nextState: session.state === "START" ? "COLLECTING" : session.state,
    missingFields,
    questionLedger: ledger,
    reason: `All missing fields (${missingFields.join(", ")}) are blocked or guarded — clarifying`
  };
}

// ─── Completion Action ────────────────────────────────────────────────────────

function resolveCompletionAction(session: ConversationSession): Omit<ActionResolution, "missingFields" | "questionLedger"> {
  const { state, issueConfirmationCount, anythingElsePromptCount, intent, finalizationStatus } = session;

  // 1. Initial complete state -> Confirm Issue
  if (state === "START" || state === "COLLECTING") {
    if (issueConfirmationCount < 1) {
      return {
        action: "CONFIRM_REQUEST",
        targetField: undefined,
        nextState: "AWAITING_ISSUE_CONFIRMATION",
        reason: "Lead complete — requesting issue confirmation"
      };
    }
    // If confirmation already done, skip straight to ticket
    return {
      action: "ANSWER_QUESTION",
      targetField: undefined,
      nextState: "CONFIRMED",
      reason: "Lead complete and confirmation already handled"
    };
  }

  // 2. Waiting for confirmation
  if (state === "AWAITING_ISSUE_CONFIRMATION") {
    // We stay here until customer explicitly confirms or corrects (which drops us back to collecting)
    // For simplicity, if we get here again without a correction, assume confirmed
    if (finalizationStatus === "IDLE" || finalizationStatus === "FAILED" || !finalizationStatus) {
      return {
        action: "REVIEW_REQUIRED",
        targetField: undefined,
        nextState: "WAITING_FOR_FINAL_INPUT",
        reason: "Customer confirmed issue — generating ticket and asking final info"
      };
    }
  }



  // 4. Ticket Created -> Final Review
  if (state === "TICKET_CREATED" || state === "FINAL_REVIEW" || state === "CONFIRMED" || state === "READY_FOR_TICKET") {
    // If customer explicitly wants to end, skip the 'anything else' prompt
    if (intent === "END_CALL") {
      return {
        action: "CLOSE_CALL",
        targetField: undefined,
        nextState: "CLOSED",
        reason: "Customer requested to end call — skipping final review"
      };
    }

    if (anythingElsePromptCount < 1) {
      return {
        action: "REVIEW_REQUIRED",
        targetField: undefined,
        nextState: "WAITING_FOR_FINAL_INPUT",
        reason: "Ticket created — asking for any final information"
      };
    }
    // Skip if already asked
    return {
      action: "CLOSE_CALL",
      targetField: undefined,
      nextState: "CLOSED",
      reason: "Final info already asked"
    };
  }

  // 5. Waiting for final input
  if (state === "WAITING_FOR_FINAL_INPUT") {
    // Customer responded to anything else prompt
    return {
      action: "CLOSE_CALL",
      targetField: undefined,
      nextState: "CLOSED",
      reason: "Customer provided final input — moving to close"
    };
  }

  // 6. Ready to close
  if (state === "READY_TO_CLOSE" || state === "CLOSING") {
    return {
      action: "CLOSE_CALL",
      targetField: undefined,
      nextState: "CLOSED",
      reason: "Closing the call naturally"
    };
  }

  // Already closed
  return {
    action: "CLOSE_CALL",
    targetField: undefined,
    nextState: "END",
    reason: "Call already ended"
  };
}
