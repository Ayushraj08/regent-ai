/**
 * Relagent Phase 5: Mood Handling & Bad Experience Diagnosis Engine
 *
 * Requirements:
 * 1. Non-defensive, empathetic acknowledgment of customer frustration or past bad experience.
 * 2. Deterministic mood & sentiment extraction:
 *    - sentiment_tag: 'angry' | 'happy' | 'neutral'
 *    - why_customer_is_upset: short summary of root cause
 *    - situation_context_notes: detailed context for business owner
 *    - recommended_next_action: actionable next step (e.g. 'Assign senior tech', 'Waive dispatch fee', 'Immediate manager callback')
 * 3. Saves diagnostics into session.moodDiagnostics and writes to conversation_records in Supabase.
 */

export interface MoodDiagnosticResult {
  sentimentTag: "angry" | "happy" | "neutral";
  whyCustomerIsUpset: string | null;
  situationContextNotes: string | null;
  recommendedNextAction: string | null;
  isUpset: boolean;
}

const ANGRY_OR_UPSET_PATTERNS = [
  /\b(angry|furious|mad|pissed|ridiculous|terrible|horrible|awful|worst|unacceptable|useless|incompetent|disgusted|upset|frustrated|annoyed|disappointed|unhappy)\b/i,
  /\b(tech|technician|guy)\s+(?:came|was here|visited)\s+.*?\b(didn't fix|did not fix|still broken|failed|messed up|broke|still blowing)\b/i,
  /\b(waiting|waited)\s+for\s+\d+\s+(?:hours|hrs|days)\b/i,
  /\b(nobody|no one)\s+(?:showed up|came|called)\b/i,
  /\b(ripoff|rip off|scam|overcharged|waste of money)\b/i,
  /\b(speak to|talk to|demand)\s+(?:a|the)?\s*(?:manager|supervisor|owner)\b/i,
  /\b(again|second time|third time)\s+.*?\b(broken|leaking|not working)\b/i,
  /\b(still\s+blowing\s+(?:warm|hot)\s+air)\b/i,
];

const HAPPY_PATTERNS = [
  /\b(thank you so much|you are awesome|wonderful|fantastic|great service|love you guys|amazing)\b/i,
];

export function analyzeCustomerMood(
  utterance: string,
  fullHistoryText: string = ""
): MoodDiagnosticResult {
  const combined = `${fullHistoryText}\n${utterance}`.trim();

  // 1. Check for angry or past bad experience
  let isAngryOrFrustrated = false;
  for (const pattern of ANGRY_OR_UPSET_PATTERNS) {
    if (pattern.test(combined)) {
      isAngryOrFrustrated = true;
      break;
    }
  }

  if (isAngryOrFrustrated) {
    // Diagnose root cause
    let whyUpset = "Customer is dissatisfied with service quality or delay.";
    let notes = "Customer expressed strong dissatisfaction.";
    let recommendedAction = "Immediate supervisor review and priority technician assignment.";

    if (/tech.*?(?:didn't fix|still broken|messed up)/i.test(combined)) {
      whyUpset = "Previous technician failed to resolve the issue on recent visit.";
      notes = "Customer states a technician was dispatched previously but the problem persists or was improperly repaired.";
      recommendedAction = "Assign senior lead technician and waive recall dispatch fee.";
    } else if (/(?:waiting|waited).*?\d+\s+hours|nobody showed up/i.test(combined)) {
      whyUpset = "Excessive wait time or technician no-show.";
      notes = "Customer reported waiting extended hours with no arrival or communication from the dispatch team.";
      recommendedAction = "Immediate dispatch manager callback and prioritize next open arrival slot.";
    } else if (/overcharged|ripoff|scam/i.test(combined)) {
      whyUpset = "Disputed billing charges or pricing transparency issue.";
      notes = "Customer believes they were overbilled or received poor value on prior service.";
      recommendedAction = "Owner or billing manager review invoice and contact customer with goodwill adjustment.";
    } else if (/manager|supervisor|owner/i.test(combined)) {
      whyUpset = "Customer demands escalation to management.";
      notes = "Customer explicitly requested to speak with management regarding past unresolved problems.";
      recommendedAction = "Urgent manager callback within 30 minutes.";
    }

    return {
      sentimentTag: "angry",
      whyCustomerIsUpset: whyUpset,
      situationContextNotes: notes,
      recommendedNextAction: recommendedAction,
      isUpset: true,
    };
  }

  // 2. Check for happy/positive sentiment
  for (const pattern of HAPPY_PATTERNS) {
    if (pattern.test(utterance)) {
      return {
        sentimentTag: "happy",
        whyCustomerIsUpset: null,
        situationContextNotes: "Customer is highly satisfied with responsiveness and professionalism.",
        recommendedNextAction: "Maintain standard high-touch service and follow up after completion.",
        isUpset: false,
      };
    }
  }

  return {
    sentimentTag: "neutral",
    whyCustomerIsUpset: null,
    situationContextNotes: null,
    recommendedNextAction: null,
    isUpset: false,
  };
}
