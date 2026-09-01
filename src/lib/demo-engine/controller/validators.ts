import { FieldStatus } from "../types";

export interface ValidationResult {
  isValid: boolean;
  status: FieldStatus;
  normalizedValue?: string;
  reason?: string;
}

// ─── Name ─────────────────────────────────────────────────────────────────────

export function validateName(name: string | null): ValidationResult {
  if (!name || name.trim().length === 0) {
    return { isValid: false, status: "MISSING", reason: "empty" };
  }
  const clean = name.trim();

  // Reject single characters, numbers-only, or obviously non-name strings
  if (clean.length < 2) {
    return { isValid: false, status: "INVALID", reason: "too_short" };
  }
  if (!/[a-zA-Z]/.test(clean)) {
    return { isValid: false, status: "INVALID", reason: "no_letters" };
  }
  // Reject very long strings that are probably utterances, not names (> 50 chars)
  if (clean.length > 60) {
    return { isValid: false, status: "AMBIGUOUS", reason: "too_long" };
  }

  return { isValid: true, status: "CAPTURED", normalizedValue: clean };
}

// ─── Phone ────────────────────────────────────────────────────────────────────

export function validatePhone(phone: string | null): ValidationResult {
  if (!phone || phone.trim().length === 0) {
    return { isValid: false, status: "MISSING", reason: "empty" };
  }

  // Extract digits only
  const digits = phone.replace(/\D/g, "");

  // Standard 10-digit US number
  if (digits.length === 10) {
    return { isValid: true, status: "CAPTURED", normalizedValue: digits };
  }

  // 11-digit with leading 1 (US country code)
  if (digits.length === 11 && digits.startsWith("1")) {
    return { isValid: true, status: "CAPTURED", normalizedValue: digits.slice(1) };
  }

  // Any other digit count is invalid
  if (digits.length > 0) {
    return {
      isValid: false,
      status: "INVALID",
      reason: `got ${digits.length} digits, need 10`
    };
  }

  return { isValid: false, status: "MISSING", reason: "no_digits" };
}

// ─── Address ──────────────────────────────────────────────────────────────────

export function validateAddress(address: string | null): ValidationResult {
  if (!address || address.trim().length === 0) {
    return { isValid: false, status: "MISSING", reason: "empty" };
  }
  const clean = address.trim();

  // Single word like "Bihar", "Texas", "California" — city/state only, insufficient
  const wordCount = clean.split(/\s+/).length;
  const hasDigit = /\d/.test(clean);

  if (wordCount === 1) {
    return { isValid: false, status: "AMBIGUOUS", reason: "single_word_only" };
  }

  // Two-word state+city but no house number
  if (wordCount <= 2 && !hasDigit) {
    return { isValid: false, status: "AMBIGUOUS", reason: "city_state_only" };
  }

  // Needs at least a number (street address)
  if (!hasDigit) {
    return { isValid: false, status: "AMBIGUOUS", reason: "no_street_number" };
  }

  return { isValid: true, status: "CAPTURED", normalizedValue: clean };
}

// ─── Urgency ──────────────────────────────────────────────────────────────────

const URGENCY_MAP: Record<string, string> = {
  "critical": "CRITICAL",
  "emergency": "CRITICAL",
  "asap": "CRITICAL",
  "right now": "CRITICAL",
  "immediately": "CRITICAL",
  "high": "HIGH",
  "urgent": "HIGH",
  "today": "HIGH",
  "as soon as possible": "HIGH",
  "medium": "MEDIUM",
  "soon": "MEDIUM",
  "this week": "MEDIUM",
  "low": "LOW",
  "routine": "LOW",
  "no rush": "LOW",
  "whenever": "LOW",
  "flexible": "LOW",
  "anytime": "LOW",
  "not urgent": "LOW",
};

export function validateUrgency(urgency: string | null): ValidationResult {
  if (!urgency || urgency.trim().length === 0) {
    return { isValid: false, status: "MISSING", reason: "empty" };
  }
  const clean = urgency.trim().toLowerCase();

  // Check our map
  for (const [pattern, normalized] of Object.entries(URGENCY_MAP)) {
    if (clean === pattern || clean.includes(pattern)) {
      return { isValid: true, status: "CAPTURED", normalizedValue: normalized };
    }
  }

  // Accept any non-empty string but normalize to uppercase
  const upper = urgency.trim().toUpperCase();
  return { isValid: true, status: "CAPTURED", normalizedValue: upper };
}

// ─── Problem ──────────────────────────────────────────────────────────────────

export function validateProblem(problem: string | null): ValidationResult {
  if (!problem || problem.trim().length === 0) {
    return { isValid: false, status: "MISSING", reason: "empty" };
  }
  const clean = problem.trim();

  // Reject single-word problems that are too vague (< 2 words)
  if (clean.split(/\s+/).length < 2) {
    return { isValid: false, status: "AMBIGUOUS", reason: "too_vague" };
  }

  return { isValid: true, status: "CAPTURED", normalizedValue: clean };
}

// ─── Service (generic) ────────────────────────────────────────────────────────

export function validateService(service: string | null): ValidationResult {
  if (!service || service.trim().length === 0) {
    return { isValid: false, status: "MISSING", reason: "empty" };
  }
  return { isValid: true, status: "CAPTURED", normalizedValue: service.trim() };
}

// ─── Context (freeform, always valid if non-empty) ────────────────────────────

export function validateContext(ctx: string | null): ValidationResult {
  if (!ctx || ctx.trim().length === 0) {
    return { isValid: false, status: "MISSING", reason: "empty" };
  }
  return { isValid: true, status: "CAPTURED", normalizedValue: ctx.trim() };
}

// ─── Request Type ─────────────────────────────────────────────────────────────

export function validateRequestType(req: string | null): ValidationResult {
  if (!req || req.trim().length === 0) {
    return { isValid: false, status: "MISSING", reason: "empty" };
  }
  return { isValid: true, status: "CAPTURED", normalizedValue: req.trim().toUpperCase() };
}
