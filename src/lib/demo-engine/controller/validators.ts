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
    return { isValid: false, status: "INVALID", reason: "The name provided was too short to be a valid name" };
  }
  if (!/\p{L}/u.test(clean)) {
    return { isValid: false, status: "INVALID", reason: "The name provided did not contain any letters" };
  }
  // Reject very long strings that are probably utterances, not names (> 50 chars)
  if (clean.length > 60) {
    return { isValid: false, status: "AMBIGUOUS", reason: "I did not catch a clear name in that sentence" };
  }

  // Reject common NLU hallucinations
  const blacklist = ["facing", "issue", "problem", "yes", "no", "yeah", "nope", "hello", "hi", "im", "i'm", "my"];
  const words = clean.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/);
  
  // If the extracted name contains ONLY blacklisted words (e.g. "facing" or "yes hi")
  if (words.every(word => blacklist.includes(word))) {
    return { isValid: false, status: "INVALID", reason: "I did not catch a valid human name in your previous response" };
  }
  
  // If the extracted name STARTS with a blacklisted word, and it's 3 words or more, it's probably a whole sentence hallucinated as a name.
  if (blacklist.includes(words[0]) && words.length >= 3) {
    return { isValid: false, status: "AMBIGUOUS", reason: "I did not catch a clear name in your previous response" };
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
    const reason = digits.length === 7 ? "I need a full 10-digit phone number including the area code" : `I received ${digits.length} digits, but I need a full 10-digit phone number`;
    return {
      isValid: false,
      status: "INVALID",
      reason: reason
    };
  }

  return { isValid: false, status: "MISSING", reason: "I did not hear any numbers in your response" };
}

// ─── Address ──────────────────────────────────────────────────────────────────

export function validateAddress(address: string | null): ValidationResult {
  if (!address || address.trim().length === 0) {
    return { isValid: false, status: "MISSING", reason: "I need your address to proceed, could you please share it?" };
  }
  const clean = address.trim();

  const wordCount = clean.split(/\s+/).length;
  const hasDigit = /\d/.test(clean);

  if (wordCount === 1) {
    return { isValid: false, status: "AMBIGUOUS", reason: "I need a complete street address, not just a single word" };
  }

  // Two-word state+city but no house number
  if (wordCount <= 2 && !hasDigit) {
    return { isValid: false, status: "AMBIGUOUS", reason: "I need a complete street address, not just the city and state" };
  }

  // Needs at least a number (street address)
  if (!hasDigit) {
    return { isValid: false, status: "AMBIGUOUS", reason: "I need the house number or zip code to complete your address" };
  }
  
  // Phase 4: Detect missing city/zip. If it doesn't have a 5-digit zip or typical multi-part structure (like a comma)
  const hasZip = /\b\d{5}\b/.test(clean);
  const hasComma = clean.includes(",");
  if (!hasZip && !hasComma && wordCount <= 4) {
    return { isValid: false, status: "AMBIGUOUS", reason: "I need the city and zip code to complete your address" };
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

// ─── Timing (Phase 3) ─────────────────────────────────────────────────────────

export function validateTiming(timing: string | null): ValidationResult {
  if (!timing || timing.trim().length === 0) {
    return { isValid: false, status: "MISSING", reason: "empty" };
  }
  const clean = timing.trim().toLowerCase();
  
  // Basic relative date parsing logic
  const now = new Date(); 
  let targetDate = new Date(now);
  let timeOfDay = "";

  if (clean.includes("morning")) timeOfDay = "Morning";
  else if (clean.includes("afternoon")) timeOfDay = "Afternoon";
  else if (clean.includes("evening") || clean.includes("night") || clean.includes("tonight")) timeOfDay = "Evening";

  const daysOfWeek = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  let resolved = false;
  
  if (clean.includes("tomorrow")) {
    targetDate.setDate(targetDate.getDate() + 1);
    resolved = true;
  } else if (clean.includes("today") || clean.includes("tonight")) {
    // targetDate is already today
    resolved = true;
  } else {
    // Check for days of week
    let foundDay = -1;
    for (let i = 0; i < daysOfWeek.length; i++) {
      if (clean.includes(daysOfWeek[i])) {
        foundDay = i;
        break;
      }
    }
    
    if (foundDay !== -1) {
      const currentDay = targetDate.getDay();
      let daysAhead = foundDay - currentDay;
      // If it's the same day, or it explicitly says 'next', or the day already passed this week
      if (daysAhead <= 0 || clean.includes("next")) {
        daysAhead += 7; 
      }
      targetDate.setDate(targetDate.getDate() + daysAhead);
      resolved = true;
    }
  }

  if (!resolved && !timeOfDay) {
    // If no relative day or time is found, just return it as captured
    return { isValid: true, status: "CAPTURED", normalizedValue: timing.trim() };
  }

  // Format: "YYYY-MM-DD (DayOfWeek) TimeOfDay"
  const formattedDate = targetDate.toISOString().split('T')[0];
  const dayName = daysOfWeek[targetDate.getDay()];
  const dayNameCapitalized = dayName.charAt(0).toUpperCase() + dayName.slice(1);
  
  let result = resolved ? `${formattedDate} (${dayNameCapitalized})` : timing.trim();
  if (resolved && timeOfDay) {
    result += ` ${timeOfDay}`;
  } else if (!resolved && timeOfDay) {
    result = `${timeOfDay} (${timing.trim()})`;
  }

  return { isValid: true, status: "CAPTURED", normalizedValue: result };
}
