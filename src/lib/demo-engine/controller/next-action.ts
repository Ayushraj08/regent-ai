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
  QuestionLedgerEntry
} from "../types";
import { getMissingRequiredFields } from "./required-fields";
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
    if (isSettled(fieldData.status)) settledFields.push(key);
  }
  if (session.primaryService) settledFields.push("service");

  // ── Sync ledger with current field status ──────────────────────────────────
  let ledger = syncLedgerWithFieldStatus(
    session.questionLedger,
    settledFields,
    currentTurn
  );

  // ── Get missing required fields ────────────────────────────────────────────
  const missingFields = getMissingRequiredFields(session);

  if (missingFields.length === 0) {
    // All fields collected — move to confirmation or close
    const resolution = resolveCompletionAction(session);
    return {
      ...resolution,
      missingFields: [],
      questionLedger: ledger,
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

    // ── Ledger check: skip if blocked ─────────────────────────────────────
    if (isFieldBlockedByLedger(ledger, field, currentTurn, fieldStatus)) {
      // This field was just asked — skip for now (will clarify if customer doesn't answer)
      continue;
    }

    // ── This is the field to ask about ───────────────────────────────────
    ledger = recordQuestionAsked(ledger, field, currentTurn);

    return {
      action: "ASK_FIELD",
      targetField: field,
      nextState: "COLLECTING",
      missingFields,
      questionLedger: ledger,
      reason: `Missing field: ${field}`
    };
  }

  // All missing fields are either blocked or guarded — clarify
  // (This prevents infinite loops where we can't ask anything)
  return {
    action: "CLARIFY",
    targetField: undefined,
    nextState: session.state === "START" ? "COLLECTING" : session.state,
    missingFields,
    questionLedger: ledger,
    reason: `All missing fields (${missingFields.join(", ")}) are blocked or guarded — clarifying`
  };
}

// ─── Completion Action ────────────────────────────────────────────────────────

function resolveCompletionAction(session: ConversationSession): Omit<ActionResolution, "missingFields" | "questionLedger"> {
  const { state } = session;

  if (state === "START" || state === "COLLECTING") {
    return {
      action: "CONFIRM",
      targetField: undefined,
      nextState: "ISSUE_CONFIRMATION",
      reason: "All fields collected — requesting confirmation"
    };
  }

  if (state === "ISSUE_CONFIRMATION") {
    return {
      action: "CONTINUE",
      targetField: undefined,
      nextState: "CLOSING",
      reason: "Confirmation received — presenting recap"
    };
  }

  if (state === "CLOSING") {
    return {
      action: "CLOSE",
      targetField: undefined,
      nextState: "END",
      reason: "Closing the call"
    };
  }

  // Already ended
  return {
    action: "CLOSE",
    targetField: undefined,
    nextState: "END",
    reason: "Call already ended"
  };
}
