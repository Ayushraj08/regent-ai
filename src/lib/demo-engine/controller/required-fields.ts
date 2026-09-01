/**
 * required-fields.ts
 *
 * Dynamically computes which fields are required for the current conversation,
 * based on trade, requestType, and primaryService from the service catalog.
 *
 * KEY INVARIANT: Problem is NOT automatically required for installation,
 * replacement, maintenance, inspection, or estimate requests.
 */

import { ConversationSession, isSettled, LeadFields } from "../types";
import { getServiceById, getServicesForTrade } from "../config/taxonomy";
import { getLeadField } from "./field-merger";

// ─── Base fields always required ──────────────────────────────────────────────

const BASE_REQUIRED_FIELDS: string[] = ["name", "phone", "address"];

// ─── Request-type default required fields ─────────────────────────────────────

const REQUEST_TYPE_DEFAULTS: Record<string, string[]> = {
  // Repair/emergency/diagnostic — problem description is meaningful
  REPAIR: ["problem", "urgency"],
  EMERGENCY: ["problem", "urgency"],
  DIAGNOSTIC: ["urgency"],          // problem often not known

  // Installation / replacement / estimate — no problem required
  INSTALLATION: ["urgency"],
  REPLACEMENT: ["urgency"],
  ESTIMATE: ["urgency"],

  // Maintenance / inspection — no problem required
  MAINTENANCE: ["urgency"],
  INSPECTION: ["urgency"],

  // Upgrade — no problem required
  UPGRADE: ["urgency"],

  // General / unknown
  GENERAL_SERVICE: ["problem", "urgency"],
  OTHER: ["problem", "urgency"],
  UNKNOWN: [],  // don't block — we don't know the type yet
};

// ─── Main exports ─────────────────────────────────────────────────────────────

/**
 * Returns the list of field names that must be collected for this session.
 * Service and requestType requirements are determined dynamically.
 */
export function getRequiredFields(session: ConversationSession): string[] {
  const { trade, requestType, primaryService } = session;

  // Start with base fields
  const required = [...BASE_REQUIRED_FIELDS];

  // Case 1: We have a primary service (the best case — most specific)
  if (primaryService && trade) {
    const svcDef = getServiceById(trade, primaryService);
    if (svcDef) {
      // Add service-specific required fields
      for (const field of svcDef.requiredFields) {
        if (!required.includes(field)) required.push(field);
      }
      // requestType is now known via the service, so we don't need to ask for it separately
      // service field itself is already captured (we have primaryService)
      return required;
    }
  }

  // Case 2: We have requestType but no specific service yet
  if (requestType && requestType !== "UNKNOWN") {
    // Need to know which service
    if (!required.includes("service")) required.push("service");

    const defaults = REQUEST_TYPE_DEFAULTS[requestType] ?? ["problem", "urgency"];
    for (const f of defaults) {
      if (!required.includes(f)) required.push(f);
    }
    return required;
  }

  // Case 3: We know trade but not requestType or service
  if (trade) {
    required.push("service"); // ask for service which will determine everything else
    return required;
  }

  // Case 4: We know nothing yet — just ask for service
  required.push("service");
  return required;
}

/**
 * Returns only the fields from getRequiredFields() that are currently
 * in a non-settled state (MISSING, INVALID, AMBIGUOUS, UNKNOWN).
 *
 * HARD INVARIANT: VALID/CAPTURED/CONFIRMED/CORRECTED fields are NEVER returned.
 */
export function getMissingRequiredFields(session: ConversationSession): string[] {
  const required = getRequiredFields(session);
  const missing: string[] = [];

  for (const fieldKey of required) {
    if (fieldKey === "service") {
      // "service" is a virtual field — check primaryService on session
      if (!session.primaryService) {
        missing.push("service");
      }
      continue;
    }

    const fieldData = getLeadField(session.lead, fieldKey);
    if (!fieldData) {
      // Field doesn't exist in lead — treat as missing
      missing.push(fieldKey);
      continue;
    }

    if (!isSettled(fieldData.status)) {
      missing.push(fieldKey);
    }
  }

  return missing;
}

/**
 * Returns a human-readable summary of why each field is required.
 * Used for the dev diagnostic panel.
 */
export function getRequirementReason(session: ConversationSession, field: string): string {
  if (BASE_REQUIRED_FIELDS.includes(field)) {
    return "base requirement";
  }

  const { trade, requestType, primaryService } = session;

  if (primaryService && trade) {
    const svcDef = getServiceById(trade, primaryService);
    if (svcDef?.requiredFields.includes(field)) {
      return `required by ${svcDef.displayName}`;
    }
  }

  if (requestType) {
    const defaults = REQUEST_TYPE_DEFAULTS[requestType] ?? [];
    if (defaults.includes(field)) {
      return `required for ${requestType} requests`;
    }
  }

  return "general requirement";
}
