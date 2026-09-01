/**
 * service-canonicalizer.ts
 *
 * Maps raw LLM output (free text) and customer utterances to canonical
 * service catalog IDs and request types.
 *
 * This is the single point of truth for "what service does the customer want?"
 */

import {
  ServiceCatalog,
  findServiceByAlias,
  getServiceById,
  REQUEST_TYPE_ALIASES,
  ServiceDefinition
} from "../config/taxonomy";
import { RequestType } from "../types";

// ─── Canonicalize Service ──────────────────────────────────────────────────────

/**
 * Convert a raw service string (from LLM or customer utterance) to a catalog ID.
 * 
 * Priority:
 * 1. Already a valid catalog ID → return as-is
 * 2. Alias match in the trade's catalog
 * 3. Fallback using requestType hint
 * 4. Cross-catalog search if trade is unknown
 * 5. null if cannot determine
 */
export function canonicalizeService(
  rawService: string | null | undefined,
  trade: string | null,
  requestType: RequestType | null,
  utterance?: string
): { serviceId: string | null; confidence: number; reason: string } {

  // Nothing to work with
  if (!rawService && !utterance && !requestType) {
    return { serviceId: null, confidence: 0, reason: "no_input" };
  }

  const candidates = rawService ? [rawService] : [];
  if (utterance) candidates.push(utterance);

  // ── 1. Is the raw value already a valid catalog ID? ────────────────────────
  if (rawService && trade) {
    const directMatch = getServiceById(trade, rawService.toUpperCase().replace(/[\s-]/g, "_"));
    if (directMatch) {
      return { serviceId: directMatch.id, confidence: 0.99, reason: "direct_catalog_id" };
    }
    // Try with original casing
    const directMatchOrig = getServiceById(trade, rawService);
    if (directMatchOrig) {
      return { serviceId: directMatchOrig.id, confidence: 0.99, reason: "direct_catalog_id" };
    }
  }

  // ── 2. Alias match on each candidate text ─────────────────────────────────
  const tradeList = trade ? [trade] : ["HVAC", "PLUMBING", "ELECTRICAL"];

  for (const candidateText of candidates) {
    for (const t of tradeList) {
      const match = findServiceByAlias(t, candidateText);
      if (match) {
        return {
          serviceId: match.id,
          confidence: candidateText === rawService ? 0.92 : 0.80,
          reason: "alias_match"
        };
      }
    }
  }

  // ── 3. Request-type hint: if trade + requestType are known, pick the best default ──
  if (trade && requestType) {
    const defaultService = getDefaultServiceForRequestType(trade, requestType);
    if (defaultService) {
      return {
        serviceId: defaultService.id,
        confidence: 0.60,
        reason: "request_type_hint"
      };
    }
  }

  // ── 4. Try partial text matching on display names ─────────────────────────
  for (const candidateText of candidates) {
    const normalized = candidateText.toLowerCase();
    for (const t of tradeList) {
      const services = ServiceCatalog[t] ?? [];
      for (const svc of services) {
        if (svc.id === `OTHER_${t}`) continue; // skip catch-all
        const words = svc.displayName.toLowerCase().split(/\s+/);
        if (words.some(w => w.length > 3 && normalized.includes(w))) {
          return {
            serviceId: svc.id,
            confidence: 0.55,
            reason: "partial_display_name_match"
          };
        }
      }
    }
  }

  return { serviceId: null, confidence: 0, reason: "no_match" };
}

/**
 * Given a trade and request type, pick the most likely default service.
 * Used when the customer says "installation" for HVAC without specifying which equipment.
 */
function getDefaultServiceForRequestType(
  trade: string,
  requestType: RequestType
): ServiceDefinition | undefined {
  const services = ServiceCatalog[trade] ?? [];

  // Prefer services that support this request type and are not the catch-all
  const eligible = services.filter(
    s => s.id !== `OTHER_${trade}` && s.supportedRequestTypes.includes(requestType)
  );

  if (eligible.length === 0) return undefined;

  // For HVAC: if it's INSTALLATION/REPLACEMENT, default to AC_INSTALLATION
  if (trade === "HVAC") {
    if (requestType === "INSTALLATION" || requestType === "REPLACEMENT") {
      return eligible.find(s => s.id === "AC_INSTALLATION") ?? eligible[0];
    }
    if (requestType === "REPAIR" || requestType === "EMERGENCY") {
      return eligible.find(s => s.id === "AC_REPAIR") ?? eligible[0];
    }
    if (requestType === "MAINTENANCE" || requestType === "INSPECTION") {
      return eligible.find(s => s.id === "AC_MAINTENANCE") ?? eligible[0];
    }
  }

  return eligible[0];
}

// ─── Canonicalize Request Type ────────────────────────────────────────────────

/**
 * Convert a raw request type string (from LLM) to a canonical RequestType enum value.
 */
export function canonicalizeRequestType(
  rawRequestType: string | null | undefined,
  utterance?: string
): RequestType | null {

  if (!rawRequestType && !utterance) return null;

  const candidates = rawRequestType ? [rawRequestType] : [];
  if (utterance) candidates.push(utterance);

  const validTypes: RequestType[] = [
    "REPAIR", "INSTALLATION", "REPLACEMENT", "MAINTENANCE", "INSPECTION",
    "DIAGNOSTIC", "UPGRADE", "ESTIMATE", "GENERAL_SERVICE", "EMERGENCY", "OTHER", "UNKNOWN"
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    // Direct match (case-insensitive)
    const upper = candidate.toUpperCase().trim();
    if (validTypes.includes(upper as RequestType)) {
      return upper as RequestType;
    }

    // Alias match
    const lower = candidate.toLowerCase().trim();
    const sortedAliases = Object.entries(REQUEST_TYPE_ALIASES).sort((a, b) => b[0].length - a[0].length);
    for (const [alias, canonical] of sortedAliases) {
      if (lower.includes(alias)) {
        return canonical as RequestType;
      }
    }
  }

  return null;
}

// ─── Infer Trade ──────────────────────────────────────────────────────────────

/**
 * Infer the most likely trade from a raw text if no trade is set.
 */
export function inferTrade(text: string): string | null {
  const lower = text.toLowerCase();

  const hvacSignals = [
    "ac", "air conditioner", "air conditioning", "hvac", "furnace",
    "heating", "cooling", "thermostat", "heat pump", "ductwork", "duct"
  ];
  const plumbingSignals = [
    "plumb", "plumber", "pipe", "drain", "water heater", "toilet", "faucet",
    "leak", "leaking", "sewer", "clog", "clogged", "flood", "sump"
  ];
  const electricalSignals = [
    "electric", "electrician", "outlet", "breaker", "panel", "wiring", "wire",
    "light", "lighting", "switch", "generator", "ev charger", "power"
  ];

  const hvacScore = hvacSignals.filter(s => lower.includes(s)).length;
  const plumbingScore = plumbingSignals.filter(s => lower.includes(s)).length;
  const electricalScore = electricalSignals.filter(s => lower.includes(s)).length;

  const max = Math.max(hvacScore, plumbingScore, electricalScore);
  if (max === 0) return null;

  if (hvacScore === max) return "HVAC";
  if (plumbingScore === max) return "PLUMBING";
  return "ELECTRICAL";
}
