/**
 * Relagent Emergency & After-Hours Enterprise Protocols
 *
 * Emergency Triage:
 * - Level 1: Life-Threatening (Gas smell, smoke, sparks, fire)
 *   "Please step outside to safety immediately and dial emergency services (911 / 999 / 000). We will log this for our emergency team, but personal safety comes first."
 *   Terminate booking. Tag: call_type = 'emergency', action_required_by_team = 'IMMEDIATE SAFETY ALERT: Evacuation in progress'.
 *
 * - Level 2: Property-Threatening (Burst pipe flooding house, no heat in sub-zero winter)
 *   "This is an urgent situation. I am putting an immediate priority flag on this and dispatching an emergency technician alert to our on-call team right now."
 *   Tag: call_type = 'emergency', action_required_by_team = 'EMERGENCY DISPATCH: Urgent on-site technician required within 60 mins'. Send instant high-priority team notification.
 *
 * After-Hours Intake Protocol:
 * - Outside business hours context:
 *   "Thank you for calling [Business Name]. You have reached our after-hours reception desk. I can book you the earliest priority appointment for tomorrow morning, or if this is an active emergency requiring immediate on-call dispatch, I can route your ticket directly to our on-call technician. Which would you prefer?"
 */

export type EmergencyLevel = "LEVEL_1_LIFE_THREATENING" | "LEVEL_2_PROPERTY_THREATENING";

export interface EmergencyTriageResult {
  isEmergency: boolean;
  level?: EmergencyLevel;
  emergencyType?: string;
  verbalResponse?: string;
  callType: "emergency" | "standard_booking";
  actionRequiredByTeam?: string;
  terminateBooking: boolean;
}

const SEVERE_ABUSE_PATTERNS = [
  /\b(fuck you|fuck off|fucking idiot|bitch|asshole|bastard|piece of shit|go to hell|shut the fuck up|cunt|motherfucker)\b/i,
];

const OUT_OF_SCOPE_TOPICS: { pattern: RegExp; topic: string }[] = [
  {
    // Jokes, riddles, entertainment
    pattern: /\b(?:jokes?|tell\b.*?\bjokes?|funny\s+story|make\s+me\s+laugh|say\s+something\s+funny|sing(?:\s+me)?\s+a\s+song|entertain\s+me|riddle\s+me)\b/i,
    topic: "jokes and entertainment",
  },
  {
    // Trivia, geography, history, general knowledge
    pattern: /\b(?:who\s+is\s+(?:the\s+)?president|what\s+is\s+the\s+capital\s+of|capital\s+of\s+[A-Za-z]+|who\s+invented|who\s+discovered|who\s+wrote|tallest\s+mountain|how\s+many\s+planets|distance\s+to\s+the\s+moon|speed\s+of\s+light|what\s+year\s+did|history\s+of\s+[A-Za-z]+|trivia)\b/i,
    topic: "trivia or general knowledge",
  },
  {
    pattern: /\b(legal advice|sue|lawyer|court|lawsuit|divorce|attorney)\b/i,
    topic: "legal matters",
  },
  {
    pattern: /\b(homework|essay|write me a poem|math problem|calculate\s+\d+|solve\s+(?:for|this)|what\s+is\s+\d+\s*[\+\-\*\/]\s*\d+)\b/i,
    topic: "general academic or creative tasks",
  },
  {
    pattern: /\b(recipe|how to cook|bake|ingredients for|dinner ideas)\b/i,
    topic: "cooking recipes",
  },
  {
    pattern: /\b(crypto|bitcoin|ethereum|stock market|investment advice|buy shares)\b/i,
    topic: "financial or investment advice",
  },
  {
    pattern: /\b(diagnose my rash|prescription|medical advice|chest pain symptoms)\b/i,
    topic: "medical advice",
  },
  {
    pattern: /\b(who will win the election|vote for|president|political party|democrat|republican)\b/i,
    topic: "politics",
  },
  {
    pattern: /\b(weather\s+in\s+(?!our\s+area|austin|texas|here)[A-Za-z]+|forecast\s+for\s+[A-Za-z]+)\b/i,
    topic: "general weather forecasts",
  },
  {
    pattern: /\b(are\s+you\s+sentient|meaning\s+of\s+life|chat\s+with\s+me\s+about\s+movies|recommend\s+a\s+movie)\b/i,
    topic: "general personal chit-chat",
  },
];

// Level 1: Life-Threatening (Gas smell, smoke, sparks, fire)
const LEVEL_1_LIFE_THREATENING_PATTERNS = [
  {
    pattern: /\b(smell(?:ing)?\s+gas|gas\s+leak|rotten\s+egg\s+odor|natural\s+gas|gas\s+odor)\b/i,
    type: "GAS_LEAK",
  },
  {
    pattern: /\b(smoke\s+from\s+(?:outlet|breaker|panel|furnace|wall)|active\s+fire|flames|electrical\s+fire)\b/i,
    type: "SMOKE_OR_FIRE",
  },
  {
    pattern: /\b(sparks?\s+(?:coming from|flying|at)\s+(?:breaker|panel|outlet)|sparking\s+panel|panel\s+sparks?)\b/i,
    type: "SPARKING_PANEL",
  },
];

// Level 2: Property-Threatening (Burst pipe flooding house, no heat in sub-zero winter)
const LEVEL_2_PROPERTY_THREATENING_PATTERNS = [
  {
    pattern: /\b(burst\s+pipe|pipe\s+burst|flooding\s+(?:house|basement|kitchen|bathroom)|standing\s+water|water\s+pouring\s+(?:through|from)\s+ceiling|massive\s+flood|water\s+everywhere)\b/i,
    type: "BURST_PIPE_FLOODING",
  },
  {
    pattern: /\b(no\s+heat\s+in\s+sub-?zero|freezing\s+inside|no\s+heat\s+and\s+freezing|sub-?zero\s+winter\s+no\s+heat)\b/i,
    type: "SUB_ZERO_NO_HEAT",
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

/**
 * Module 5: 3-Strike Out-of-Scope Enforcement
 * Strike 1: "I'm specifically here to help with your [tenant.business_name] service needs. Do you have an issue I can help book a technician for?"
 * Strike 2: "I can only assist with our business services. If you don't need a technician, I will need to clear this line for other customers."
 * Strike 3: Trigger disconnect_and_block webhook and end call.
 */
export function getOutOfScopeStrikeResponse(
  currentStrikes: number,
  businessName: string
): {
  strikeNumber: number;
  response: string;
  action: "STRIKE_1" | "STRIKE_2" | "DISCONNECT_AND_BLOCK";
} {
  if (currentStrikes === 0) {
    return {
      strikeNumber: 1,
      response: `I'm specifically here to help with your ${businessName} service needs. Do you have an issue I can help book a technician for?`,
      action: "STRIKE_1",
    };
  } else if (currentStrikes === 1) {
    return {
      strikeNumber: 2,
      response:
        "I can only assist with our business services. If you don't need a technician, I will need to clear this line for other customers.",
      action: "STRIKE_2",
    };
  } else {
    return {
      strikeNumber: 3,
      response:
        "Since you do not need our technician services, I will now disconnect this call to clear the line for other customers. Thank you, goodbye.",
      action: "DISCONNECT_AND_BLOCK",
    };
  }
}

/**
 * Evaluates utterance against Emergency Triage standards.
 */
export function checkEmergencySafety(utterance: string): EmergencyTriageResult {
  // Check Level 1: Life-Threatening
  for (const entry of LEVEL_1_LIFE_THREATENING_PATTERNS) {
    if (entry.pattern.test(utterance)) {
      return {
        isEmergency: true,
        level: "LEVEL_1_LIFE_THREATENING",
        emergencyType: entry.type,
        verbalResponse:
          "Please step outside to safety immediately and dial emergency services (911 / 999 / 000). We will log this for our emergency team, but personal safety comes first.",
        callType: "emergency",
        actionRequiredByTeam: "IMMEDIATE SAFETY ALERT: Evacuation in progress",
        terminateBooking: true,
      };
    }
  }

  // Check Level 2: Property-Threatening
  for (const entry of LEVEL_2_PROPERTY_THREATENING_PATTERNS) {
    if (entry.pattern.test(utterance)) {
      return {
        isEmergency: true,
        level: "LEVEL_2_PROPERTY_THREATENING",
        emergencyType: entry.type,
        verbalResponse:
          "This is an urgent situation. I am putting an immediate priority flag on this and dispatching an emergency technician alert to our on-call team right now.",
        callType: "emergency",
        actionRequiredByTeam: "EMERGENCY DISPATCH: Urgent on-site technician required within 60 mins",
        terminateBooking: false,
      };
    }
  }

  return {
    isEmergency: false,
    callType: "standard_booking",
    terminateBooking: false,
  };
}

/**
 * Formats the after-hours opening greeting.
 */
export function getAfterHoursGreeting(businessName: string): string {
  return `Thank you for calling ${businessName}. You have reached our after-hours reception desk. I can book you the earliest priority appointment for tomorrow morning, or if this is an active emergency requiring immediate on-call dispatch, I can route your ticket directly to our on-call technician. Which would you prefer?`;
}
