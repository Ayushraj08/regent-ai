import { ConversationSession, Behavior, ActionType, Intent } from "../types";
import { getServiceById } from "../config/taxonomy";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAck(behavior: Behavior, intent: Intent | null, firstName?: string): string {
  const nameCtx = firstName ? `, ${firstName}` : "";

  if (behavior === "ANGRY" || behavior === "HOSTILE") {
    return "Understood. I'll keep this straightforward.";
  }
  if (behavior === "FRUSTRATED") {
    return "I understand. Let's keep this simple and get it moving.";
  }
  if (behavior === "ANXIOUS" || behavior === "DISTRESSED") {
    return `No problem${nameCtx}. I'll make sure the important details are captured.`;
  }
  if (behavior === "RUSHED" || behavior === "MINIMAL") {
    return "Absolutely. I'll keep this quick.";
  }
  
  if (intent === "NEW_SERVICE_REQUEST") {
    return `Got it${nameCtx}. I can help with that.`;
  }

  const acks = [`Got it${nameCtx}.`, "Okay.", "Understood.", "Alright.", "Thanks."];
  return acks[Math.floor(Math.random() * acks.length)];
}

function getServiceLabel(session: ConversationSession): string {
  const { trade, primaryService, requestType } = session;
  if (primaryService && trade) {
    const svc = getServiceById(trade, primaryService);
    if (svc) {
      return svc.displayName.toLowerCase();
    }
  }
  if (primaryService) {
    return primaryService.replace(/_/g, " ").toLowerCase();
  }
  return "service";
}

function getRequestTypeLabel(rt: string | null): string {
  if (!rt) return "";
  const map: Record<string, string> = {
    INSTALLATION: "installation",
    REPAIR: "repair",
    REPLACEMENT: "replacement",
    MAINTENANCE: "maintenance",
    INSPECTION: "inspection",
    DIAGNOSTIC: "diagnostic",
    UPGRADE: "upgrade",
    ESTIMATE: "estimate",
    EMERGENCY: "emergency service",
    GENERAL_SERVICE: "service",
    OTHER: "service",
    UNKNOWN: ""
  };
  return map[rt] ?? rt.toLowerCase();
}

function getBusinessAnswer(intent: Intent | null): string {
  switch (intent) {
    case "SOCIAL_QUESTION": return "I'm doing well, thanks.";
    case "PRICE_QUESTION": return "Our team can confirm pricing for the job.";
    case "HOURS_QUESTION": return "We have technicians available most of the week.";
    case "SERVICE_AREA_QUESTION": return "We service the wider metropolitan area.";
    case "STATUS_QUESTION": return "The team will confirm availability with you.";
    default: return "";
  }
}

// ─── Main Response Generator ───────────────────────────────────────────────────

export function generateResponse(
  action: ActionType,
  targetField: string | undefined,
  behavior: Behavior,
  missingFields: string[],
  session: ConversationSession
): string {
  const firstName = session.lead.name?.value?.split(" ")[0];
  const nameCtx = firstName ? `, ${firstName}` : "";
  const angry = behavior === "ANGRY" || behavior === "HOSTILE";
  const rushed = behavior === "RUSHED" || behavior === "MINIMAL";
  const anxious = behavior === "ANXIOUS" || behavior === "DISTRESSED";
  const confused = behavior === "CONFUSED" || behavior === "UNCERTAIN";
  const frustrated = behavior === "FRUSTRATED";
  
  const businessPrefix = getBusinessAnswer(session.intent);
  const ack = getAck(behavior, session.intent, firstName);

  // ── CLOSE ─────────────────────────────────────────────────────────────────
  if (action === "CLOSE") {
    const ticket = session.ticketId ? ` Your ticket number is ${session.ticketId}.` : "";
    return `Thank you so much for calling${nameCtx}!${ticket} The team will be reaching out to you shortly. Hope your day gets better — take care!`;
  }

  // ── TRANSFER / ESCALATE ───────────────────────────────────────────────────
  if (action === "TRANSFER" || action === "ESCALATE") {
    return `Of course${nameCtx} — totally understand. Let me get someone from the team on the line for you right away. Just one moment.`;
  }

  // ── HANDLE COMPLAINT ──────────────────────────────────────────────────────
  if (action === "HANDLE_COMPLAINT") {
    if (angry) {
      return `I am incredibly sorry that this has been your experience${nameCtx}, and I completely understand why you're upset. I want to make this right. Could you tell me exactly what went wrong?`;
    }
    if (anxious) {
      return `I am so sorry you're dealing with this right now${nameCtx}. Please don't worry, we are going to get this sorted out for you. Can you walk me through what happened?`;
    }
    if (behavior === "FRUSTRATED") {
      return `I completely understand your frustration${nameCtx}, and I apologize for the hassle. Let's get to the bottom of this. What exactly is going on?`;
    }
    return `I am very sorry to hear that${nameCtx}. We absolutely want to get this resolved for you. Could you tell me a little more about the issue?`;
  }

  // ── CLARIFY ───────────────────────────────────────────────────────────────
  if (action === "CLARIFY") {
    // Check for silence or garbled speech
    const lastUtt = session.conversationHistory.length > 0 ? session.conversationHistory[session.conversationHistory.length - 1] : null;
    if (session.intent === "UNSURE" || (lastUtt && lastUtt.role === "CUSTOMER" && lastUtt.content.trim() === "")) {
      return `I didn't quite catch that${nameCtx}. Could you repeat what you were saying?`;
    }

    if (confused) {
      return `${businessPrefix ? businessPrefix + " " : ""}No worries at all${nameCtx} — let me help you out. Could you tell me a bit more about what you're looking for today?`;
    }
    return `${businessPrefix ? businessPrefix + " " : ""}I want to make sure I'm helping you the right way${nameCtx}. Could you tell me a little more about what you need?`;
  }

  // ── CONFIRM ───────────────────────────────────────────────────────────────
  if (action === "CONFIRM") {
    const svcLabel = getServiceLabel(session);
    const rtLabel = getRequestTypeLabel(session.requestType);
    const problemValue = session.lead.problem?.value;

    let issueSummary: string;
    if (problemValue) {
      issueSummary = `${problemValue}`;
    } else if (svcLabel !== "service") {
      if (rtLabel && rtLabel !== "service" && rtLabel !== "") {
        issueSummary = `an ${rtLabel} for ${svcLabel}`;
      } else {
        issueSummary = svcLabel;
      }
    } else {
      issueSummary = "the request you described";
    }

    const phone = session.lead.phone?.value || "the number you provided";
    const address = session.lead.address?.value || "your location";
    const timing = session.lead.timing?.value || session.lead.urgency?.value?.toLowerCase() || "flexible";

    return `Just to make sure I've got everything right${nameCtx} — you reached out about ${issueSummary} at ${address}. I have your callback number as ${phone}, and noted the timing as ${timing}. Does that all sound correct, or is there anything you'd like to add or change?`;
  }

  // ── CONTINUE (recap) ──────────────────────────────────────────────────────
  if (action === "CONTINUE") {
    const ticket = session.ticketId
      ? `Your reference number is ${session.ticketId}`
      : "Your request has been logged";
    const address = session.lead.address?.value || "your location";
    const namePart = firstName ? `you're all set, ${firstName}` : "you're all set";
    return `Alright — ${namePart}! I have a request on file for ${address}. ${ticket}. Is there anything else about the situation you'd like me to flag for the team before we wrap up?`;
  }

  // ── ASK_FIELD ─────────────────────────────────────────────────────────────
  if (action === "ASK_FIELD" && targetField) {
    let q = "";

    // NAME
    if (targetField === "name") {
      const hasProblem = session.lead.problem?.value;
      const empathy =
        hasProblem && !angry && !rushed
          ? `Sorry to hear that${nameCtx}. I'll help you get it sorted. `
          : "";
      if (angry) q = `${empathy}Let's get this taken care of right away. Could I start with your name?`;
      else if (rushed) q = `${empathy}Let's keep this quick. What is your name?`;
      else q = `${empathy}I'd love to help get this sorted! I just need to collect a little information so the team knows who to ask for. Could I start with your name?`;
    }

    // PHONE
    else if (targetField === "phone") {
      const phoneStatus = session.lead.phone?.status;
      if (phoneStatus === "INVALID" || phoneStatus === "AMBIGUOUS") {
        q = `I think I may have missed part of that number${nameCtx}. Could you give me your full 10-digit callback number again?`;
      } else if (rushed) {
        q = `What's the best callback number?`;
      } else {
        q = `What's the best callback number for the team to reach you on${nameCtx}?`;
      }
    }

    // ADDRESS
    else if (targetField === "address") {
      const addrStatus = session.lead.address?.status;
      if (addrStatus === "AMBIGUOUS") {
        q = `I want to make sure the team heads to the right place${nameCtx}. Could you give me the full service address — street number and all?`;
      } else if (rushed) {
        q = `What's the full service address?`;
      } else {
        q = `And what's the full service address where you need someone to come out to${nameCtx}?`;
      }
    }

    // SERVICE
    else if (targetField === "service") {
      const rt = session.requestType;
      const trade = session.trade;

      if (rt === "INSTALLATION" || rt === "REPLACEMENT") {
        if (trade === "HVAC") q = `What equipment are we installing — is this an AC unit, furnace, or something else?`;
        else if (trade === "PLUMBING") q = `What are we installing — a water heater, toilet, faucet, or something else?`;
        else if (trade === "ELECTRICAL") q = `What are we installing — an EV charger, generator, lighting, or something else?`;
        else q = `What equipment needs to be installed?`;
      }
      else if (rt === "MAINTENANCE") q = `Which system needs maintenance${nameCtx}?`;
      else if (rt === "REPAIR") q = `What specifically needs to be repaired${nameCtx}?`;
      else if (rt === "ESTIMATE") q = `What service are you looking for an estimate on${nameCtx}?`;
      else if (trade === "HVAC") q = `Could you tell me more — is this about your AC, heating, thermostat, or something else?`;
      else if (trade === "PLUMBING") q = `Could you describe what you need — is this a leak, drain, water heater, or something else?`;
      else if (trade === "ELECTRICAL") q = `Could you tell me more — is this about an outlet, breaker, wiring, or something else?`;
      else q = `Can you give me a few more details on exactly what needs service${nameCtx}?`;
    }

    // PROBLEM
    else if (targetField === "problem") {
      const rt = session.requestType;
      if (rt === "INSTALLATION" || rt === "REPLACEMENT") {
        if (angry) q = `Walk me through exactly what needs to be installed.`;
        else if (rushed) q = `Is the new unit already delivered?`;
        else q = `Could you tell me a bit more — is the new equipment already on site?`;
      }
      else if (rt === "ESTIMATE") {
        q = `Sure thing. Could you describe what you'd like an estimate for?`;
      }
      else if (rt === "DIAGNOSTIC") {
        q = `What concerns prompted you to call — what's the system doing or not doing?`;
      }
      else if (angry) q = `Walk me through exactly what's happening — I want to make sure the team has the full picture.`;
      else if (rushed) q = `Briefly, what's happening?`;
      else if (anxious) q = `Don't worry${nameCtx}, we're going to get this handled. Can you describe what's going on in a bit more detail?`;
      else q = `Could you describe what's happening? Any detail helps the team show up prepared.`;
    }

    // URGENCY
    else if (targetField === "urgency") {
      if (rushed) q = `Do you need someone out there today, or is there some flexibility?`;
      else if (anxious) q = `I hear you${nameCtx} — how urgently do you need someone out there? Is this something you need today, or is there some flexibility?`;
      else q = `How urgent is this for you${nameCtx}? Do you need someone out there today, or is there some flexibility on timing?`;
    }

    // TIMING
    else if (targetField === "timing") {
      q = `When would be a good time for the team to come out${nameCtx}? Any time preference — mornings, afternoons, a specific day?`;
    }

    // EQUIPMENT
    else if (targetField === "equipment") {
      q = `Could you tell me more about the equipment involved${nameCtx}? Brand, model, or age if you know it?`;
    }

    // CONTEXT
    else if (targetField === "context") {
      q = `Is there any additional context that would help the team${nameCtx}? For example, previous repairs, how long the issue has been going on, or anything else?`;
    }
    
    else {
        q = `Could you tell me a little more about what you need?`;
    }

    // Compose final response
    if (session.intent === "COMPLAINT") {
      const solutionOffer = angry || frustrated
        ? `I am incredibly sorry to hear that, and I completely understand why you're upset${nameCtx}. We will absolutely send someone back out to fix this at no charge.`
        : `I am very sorry to hear that${nameCtx}. We want to get this resolved for you immediately, and we'll send a technician out to make it right.`;
      
      if (targetField === "name") {
        return `${solutionOffer} Let's get this taken care of right away. Could I start with your name?`;
      } else {
        return `${solutionOffer} ${q}`;
      }
    } else if (businessPrefix) {
      return `${businessPrefix} ${q}`;
    } else if (targetField === "name") {
      return q; // empathy prefix is already inside name block
    } else {
      return `${ack} ${q}`;
    }
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return `I want to make sure I'm helping you the right way${nameCtx}. Could you tell me a little more about what you need?`;
}
