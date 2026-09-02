/**
 * field-merger.ts
 *
 * Authoritative merge of NLU-extracted fields into the conversation session.
 *
 * INVARIANTS:
 * 1. A VALID/CAPTURED/CONFIRMED/CORRECTED field is never replaced by null/empty.
 * 2. A VALID/CAPTURED/CONFIRMED/CORRECTED field is only updated if the new value
 *    explicitly differs AND is non-empty (treated as a customer correction).
 * 3. Status is determined by the application validator, not the LLM.
 * 4. sourceTurn is set when first captured; updatedTurn is updated on every merge.
 */

import {
  FieldMetadata,
  FieldStatus,
  LeadFields,
  CorrectionRecord,
  isSettled,
  emptyField
} from "../types";
import {
  validateName,
  validatePhone,
  validateAddress,
  validateUrgency,
  validateProblem,
  validateContext,
  validateTiming
} from "./validators";

type ValidatorFn = (v: string | null) => { isValid: boolean; status: FieldStatus; normalizedValue?: string; reason?: string };

const FIELD_VALIDATORS: Partial<Record<keyof LeadFields, ValidatorFn>> = {
  name: validateName,
  phone: validatePhone,
  address: validateAddress,
  urgency: validateUrgency,
  problem: validateProblem,
  context: validateContext,
  timing: validateTiming,
  equipment: (v) => v && v.trim().length > 0
    ? { isValid: true, status: "CAPTURED", normalizedValue: v.trim() }
    : { isValid: false, status: "MISSING" },
};

/**
 * Merge a single extracted field into the existing field.
 * Returns updated field + optional correction record.
 */
export function mergeField(
  fieldKey: string,
  existing: FieldMetadata,
  extracted: Partial<FieldMetadata> | undefined,
  currentTurn: number
): { updated: FieldMetadata; correction: CorrectionRecord | null } {
  if (!extracted) {
    return { updated: existing, correction: null };
  }

  const newValue = extracted.value?.trim() || null;
  const extractedStatus = extracted.status;

  // Case 1: Explicit REFUSED, NOT_APPLICABLE or UNKNOWN — only accept if not already settled
  if (!newValue && (extractedStatus === "REFUSED" || extractedStatus === "NOT_APPLICABLE" || extractedStatus === "UNKNOWN")) {
    if (!isSettled(existing.status)) {
      return {
        updated: {
          ...existing,
          status: extractedStatus,
          updatedTurn: currentTurn,
          turn: currentTurn
        },
        correction: null
      };
    }
    return { updated: existing, correction: null };
  }

  // Case 2: No new value — preserve existing (never erase)
  if (!newValue) {
    return { updated: existing, correction: null };
  }

  // Case 3: Validate the new value
  const validator = FIELD_VALIDATORS[fieldKey as keyof LeadFields];
  let validatedValue = newValue;
  let validatedStatus: FieldStatus = extractedStatus ?? "CAPTURED";
  let validatedReason: string | undefined = undefined;

  if (validator) {
    const result = validator(newValue);
    validatedValue = result.normalizedValue ?? newValue;
    validatedStatus = result.status;
    validatedReason = result.reason;
  }

  // Case 4: Field was already settled — check if this is a correction
  if (isSettled(existing.status) && existing.value !== null) {
    const isSameValue = existing.value.toLowerCase() === validatedValue.toLowerCase();
    if (isSameValue) {
      // Same value — no update needed
      return { updated: existing, correction: null };
    }

    // Different value — treat as correction
    if (validatedStatus !== "INVALID" && validatedStatus !== "MISSING") {
      const correction: CorrectionRecord = {
        field: fieldKey,
        oldValue: existing.value,
        newValue: validatedValue,
        turn: currentTurn
      };
      return {
        updated: {
          value: validatedValue,
          status: "CORRECTED",
          confidence: extracted.confidence ?? 0.85,
          sourceTurn: existing.sourceTurn,
          updatedTurn: currentTurn,
          turn: currentTurn,
          validationReason: validatedReason
        },
        correction
      };
    }
    // If the new value is invalid, don't replace a settled value
    return { updated: existing, correction: null };
  }

  // Case 5: Field was not settled — update it with validation result
  const sourceTurn = existing.status === "MISSING" ? currentTurn : (existing.sourceTurn || currentTurn);
  return {
    updated: {
      value: validatedValue,
      status: validatedStatus,
      confidence: extracted.confidence ?? 0.85,
      sourceTurn,
      updatedTurn: currentTurn,
      turn: currentTurn,
      validationReason: validatedReason
    },
    correction: null
  };
}

/**
 * Merge all extracted lead fields into the session lead.
 * Returns the updated lead fields + any correction records generated.
 */
export function mergeLeadFields(
  currentLead: LeadFields,
  extracted: Partial<Record<keyof LeadFields, Partial<FieldMetadata> | undefined>> | undefined,
  currentTurn: number
): { lead: LeadFields; corrections: CorrectionRecord[] } {
  if (!extracted) {
    return { lead: currentLead, corrections: [] };
  }

  const updatedLead = { ...currentLead };
  const corrections: CorrectionRecord[] = [];

  const fields: (keyof LeadFields)[] = [
    "name", "phone", "address", "problem", "urgency", "timing", "equipment", "context"
  ];

  for (const field of fields) {
    const existing = currentLead[field] ?? emptyField();
    const extractedField = extracted[field];
    
    if (!extractedField) continue;

    const { updated, correction } = mergeField(
      field,
      existing,
      extractedField,
      currentTurn
    );
    updatedLead[field] = updated;
    if (correction) corrections.push(correction);
  }

  return { lead: updatedLead, corrections };
}

/**
 * Get a specific field from the lead by field name (string key).
 */
export function getLeadField(lead: LeadFields, fieldKey: string): FieldMetadata | null {
  return (lead as Record<string, FieldMetadata>)[fieldKey] ?? null;
}
