/**
 * question-ledger.ts
 *
 * Tracks which fields have been asked about, when, and whether they've been answered.
 *
 * INVARIANT: Once a field is answered (status = ANSWERED), it cannot be asked again
 * unless an explicit correction or invalidation occurs.
 */

import { QuestionLedgerEntry } from "../types";

/**
 * Record that a question was asked about a field.
 * If a PENDING entry already exists for this field, increment its clarification count.
 */
export function recordQuestionAsked(
  ledger: QuestionLedgerEntry[],
  field: string,
  turn: number
): QuestionLedgerEntry[] {
  const existing = ledger.find(e => e.field === field && e.status === "PENDING");

  if (existing) {
    // Already asked — increment clarification count
    return ledger.map(e =>
      e.questionId === existing.questionId
        ? { ...e, clarificationCount: e.clarificationCount + 1 }
        : e
    );
  }

  // New question
  const entry: QuestionLedgerEntry = {
    questionId: `${field}-${turn}-${crypto.randomUUID().slice(0, 8)}`,
    field,
    turnAsked: turn,
    answerTurn: null,
    status: "PENDING",
    clarificationCount: 0
  };

  return [...ledger, entry];
}

/**
 * Mark a field's pending question as answered.
 */
export function recordFieldAnswered(
  ledger: QuestionLedgerEntry[],
  field: string,
  turn: number
): QuestionLedgerEntry[] {
  return ledger.map(e =>
    e.field === field && e.status === "PENDING"
      ? { ...e, status: "ANSWERED", answerTurn: turn }
      : e
  );
}

/**
 * If a field is corrected, reset its ledger entry so it can be asked again
 * (or just mark the old one as answered and let a new one be created if needed).
 */
export function recordFieldCorrected(
  ledger: QuestionLedgerEntry[],
  field: string,
  turn: number
): QuestionLedgerEntry[] {
  return ledger.map(e =>
    e.field === field && e.status === "ANSWERED"
      ? { ...e, status: "ANSWERED", answerTurn: turn } // keep as answered — correction doesn't need re-asking
      : e
  );
}

/**
 * Check if a field is currently blocked by the ledger (already asked and pending answer).
 * A field is blocked only if there is a PENDING entry and we've already asked it recently
 * (within the last 2 turns) — prevents re-asking in rapid succession.
 */
export function isFieldBlockedByLedger(
  ledger: QuestionLedgerEntry[],
  field: string,
  currentTurn: number,
  fieldStatus?: string
): boolean {
  if (fieldStatus === "INVALID" || fieldStatus === "AMBIGUOUS") return false;

  const pending = ledger.find(e => e.field === field && e.status === "PENDING");
  if (!pending) return false;

  // Block if asked in the last turn (give the customer a chance to answer)
  // If more than 1 turn has passed, they didn't answer it despite clarification, so unblock and ask again naturally.
  if (currentTurn - pending.turnAsked <= 1) {
    return true;
  }

  return false;
}

/**
 * Check if a field has been answered at any point in the conversation.
 */
export function wasFieldAnswered(
  ledger: QuestionLedgerEntry[],
  field: string
): boolean {
  return ledger.some(e => e.field === field && e.status === "ANSWERED");
}

/**
 * Get the pending question for a field (if any).
 */
export function getPendingQuestion(
  ledger: QuestionLedgerEntry[],
  field: string
): QuestionLedgerEntry | undefined {
  return ledger.find(e => e.field === field && e.status === "PENDING");
}

/**
 * Sync the ledger: mark all fields with settled status as answered.
 * This is called after every state merge to keep the ledger in sync.
 */
export function syncLedgerWithFieldStatus(
  ledger: QuestionLedgerEntry[],
  settledFields: string[],
  currentTurn: number
): QuestionLedgerEntry[] {
  return ledger.map(e => {
    if (e.status === "PENDING" && settledFields.includes(e.field)) {
      return { ...e, status: "ANSWERED", answerTurn: currentTurn };
    }
    return e;
  });
}
