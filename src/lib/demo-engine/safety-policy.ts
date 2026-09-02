/**
 * Relagent Phase 7 & 8: Safety, Out-of-Scope, Abuse & Emergency Policy Engine
 *
 * Rules:
 * Phase 7:
 * - Abuse: Strike 1 = Warning. Strike 2 = Polite disconnect.
 * - Out-of-scope: Polite decline + pivot back to home services.
 * Phase 8:
 * - Emergency (gas leak, active fire/smoke, sparking electrical panel, major flood):
 *   Immediate safety instruction (evacuate / 911 / shutoff) + priority dispatch flag.
 */

const SEVERE_ABUSE_PATTERNS = [
  /\b(fuck you|fuck off|fucking idiot|bitch|asshole|bastard|piece of shit|go to hell|shut the fuck up|cunt|motherfucker)\b/i,
];

const OUT_OF_SCOPE_TOPICS: { pattern: RegExp; topic: string }[] = [
  {
    pattern: /\b(legal advice|sue|lawyer|court|lawsuit|divorce|attorney)\b/i,
    topic: "legal matters",
  },
  {
    pattern: /\b(homework|essay|write me a poem|math problem|history of)\b/i,
    topic: "general academic or creative tasks",
  },
  {
    pattern: /\b(recipe|how to cook|bake|ingredients for)\b/i,
    topic: "cooking recipes",
  },
  {
    pattern: /\b(crypto|bitcoin|stock market|investment advice|buy shares)\b/i,
    topic: "financial or investment advice",
  },
  {
    pattern: /\b(diagnose my rash|prescription|medical advice|chest pain symptoms)\b/i,
    topic: "medical advice",
  },
  {
    pattern: /\b(who will win the election|vote for|president|political party)\b/i,
    topic: "politics",
  },
];

const EMERGENCY_SAFETY_PATTERNS: {
  pattern: RegExp;
  emergencyType: string;
  safetyInstruction: string;
}[] = [
  {
    pattern: /\b(smell(?:ing)?\s+gas|gas\s+leak|rotten\s+egg\s+odor|natural\s+gas)\b/i,
    emergencyType: "GAS_LEAK",
    safetyInstruction:
      "If you suspect a natural gas leak, please evacuate everyone from the building immediately. Do not use any light switches or open flames, and call your gas utility or 911 from a safe distance outside.",
  },
  {
    pattern: /\b(sparks?\s+(?:coming from|flying|at)\s+(?:breaker|panel|outlet)|electrical\s+fire|smoke\s+from\s+outlet)\b/i,
    emergencyType: "ELECTRICAL_FIRE_HAZARD",
    safetyInstruction:
      "If there are active electrical sparks or smoke from your panel or outlets, please shut off your main circuit breaker if safe to reach, keep everyone away from the area, and call 911 if there is active fire.",
  },
  {
    pattern: /\b(water\s+pouring\s+(?:through|from)\s+ceiling|burst\s+pipe\s+flooding|massive\s+flood)\b/i,
    emergencyType: "MAJOR_WATER_FLOOD",
    safetyInstruction:
      "Please locate your main water shutoff valve immediately and turn it clockwise to stop the water flow. Keep away from any light fixtures or outlets that water is touching.",
  },
];

export function checkAbuse(utterance: string): boolean {
  for (const pattern of SEVERE_ABUSE_PATTERNS) {
    if (pattern.test(utterance)) return true;
  }
  return false;
}

export function checkOutOfScope(
  utterance: string
): { isOutOfScope: boolean; topic?: string } {
  for (const entry of OUT_OF_SCOPE_TOPICS) {
    if (entry.pattern.test(utterance)) {
      return { isOutOfScope: true, topic: entry.topic };
    }
  }
  return { isOutOfScope: false };
}

export function checkEmergencySafety(
  utterance: string
): {
  isEmergency: boolean;
  emergencyType?: string;
  safetyInstruction?: string;
} {
  for (const entry of EMERGENCY_SAFETY_PATTERNS) {
    if (entry.pattern.test(utterance)) {
      return {
        isEmergency: true,
        emergencyType: entry.emergencyType,
        safetyInstruction: entry.safetyInstruction,
      };
    }
  }
  return { isEmergency: false };
}
