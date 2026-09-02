import { ConversationSession } from "../types";
import { getRequiredFields } from "./required-fields";
import { getLeadField } from "./field-merger";

export interface CompletionResult {
  complete: boolean;
  missingFields: string[];
  invalidFields: string[];
  ambiguousFields: string[];
  completionReason: string;
}

/**
 * Authoritative gate that determines if the current lead satisfies all business requirements.
 * This ensures we never declare a lead "complete" before it actually is.
 */
export function validateLeadForCompletion(session: ConversationSession): CompletionResult {
  const required = getRequiredFields(session);
  
  const result: CompletionResult = {
    complete: true,
    missingFields: [],
    invalidFields: [],
    ambiguousFields: [],
    completionReason: "All required fields are settled."
  };

  for (const field of required) {
    if (field === "service") {
      if (!session.primaryService) {
        result.missingFields.push("service");
        result.complete = false;
      }
      continue;
    }

    const data = getLeadField(session.lead, field);
    
    if (!data || data.status === "MISSING" || data.status === "UNKNOWN") {
      result.missingFields.push(field);
      result.complete = false;
    } else if (data.status === "INVALID") {
      result.invalidFields.push(field);
      result.complete = false;
    } else if (data.status === "AMBIGUOUS") {
      result.ambiguousFields.push(field);
      result.complete = false;
    }
    // VALID, CAPTURED, CONFIRMED, CORRECTED, NOT_APPLICABLE are treated as settled.
  }

  if (!result.complete) {
    if (result.invalidFields.length > 0) {
      result.completionReason = `Lead incomplete — Invalid fields: ${result.invalidFields.join(", ")}`;
    } else if (result.ambiguousFields.length > 0) {
      result.completionReason = `Lead incomplete — Ambiguous fields: ${result.ambiguousFields.join(", ")}`;
    } else {
      result.completionReason = `Lead incomplete — Missing fields: ${result.missingFields.join(", ")}`;
    }
  }

  return result;
}
