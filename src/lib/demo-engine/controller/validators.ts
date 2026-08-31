import { FieldStatus } from "../types";

export interface ValidationResult {
  isValid: boolean;
  status: FieldStatus;
  normalizedValue?: string;
}

export function validateName(name: string | null): ValidationResult {
  if (!name || name.trim().length === 0) {
    return { isValid: false, status: "MISSING" };
  }
  const clean = name.trim();
  // Reject single letters or obvious nonsense
  if (clean.length < 2 || !/[a-zA-Z]/.test(clean)) {
    return { isValid: false, status: "INVALID" };
  }
  return { isValid: true, status: "CAPTURED", normalizedValue: clean };
}

export function validatePhone(phone: string | null): ValidationResult {
  if (!phone || phone.trim().length === 0) {
    return { isValid: false, status: "MISSING" };
  }
  
  // Extract digits
  const digits = phone.replace(/\D/g, "");
  
  if (digits.length === 10) {
    return { isValid: true, status: "CAPTURED", normalizedValue: digits };
  } else if (digits.length === 11 && digits.startsWith("1")) {
    return { isValid: true, status: "CAPTURED", normalizedValue: digits.slice(1) };
  } else if (digits.length > 0) {
    return { isValid: false, status: "INVALID" };
  }
  
  return { isValid: false, status: "MISSING" };
}

export function validateAddress(address: string | null): ValidationResult {
  if (!address || address.trim().length === 0) {
    return { isValid: false, status: "MISSING" };
  }
  const clean = address.trim();
  
  // A naive check: reject single words like "Bihar" or "Texas"
  const wordCount = clean.split(/\s+/).length;
  const hasDigit = /\d/.test(clean);
  
  if (wordCount < 2 || !hasDigit) {
    return { isValid: false, status: "AMBIGUOUS" };
  }
  
  return { isValid: true, status: "CAPTURED", normalizedValue: clean };
}

export function validateUrgency(urgency: string | null): ValidationResult {
  if (!urgency || urgency.trim().length === 0) {
    return { isValid: false, status: "MISSING" };
  }
  const clean = urgency.trim().toUpperCase();
  if (clean === "CRITICAL" || clean === "HIGH" || clean === "MEDIUM" || clean === "LOW" || clean === "ROUTINE") {
    return { isValid: true, status: "CAPTURED", normalizedValue: clean };
  }
  return { isValid: true, status: "CAPTURED", normalizedValue: urgency.trim() };
}

export function validateService(service: string | null): ValidationResult {
  if (!service || service.trim().length === 0) {
    return { isValid: false, status: "MISSING" };
  }
  return { isValid: true, status: "CAPTURED", normalizedValue: service.trim() };
}

export function validateProblem(problem: string | null): ValidationResult {
  if (!problem || problem.trim().length === 0) {
    return { isValid: false, status: "MISSING" };
  }
  if (problem.trim().split(/\s+/).length < 2) {
    return { isValid: false, status: "AMBIGUOUS" };
  }
  return { isValid: true, status: "CAPTURED", normalizedValue: problem.trim() };
}
