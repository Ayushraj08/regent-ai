import { Lead, Behavior, ActionType } from "../types";

function getAck() {
  const acks = ["Got it.", "Okay.", "Understood.", "Alright.", "Thanks."];
  return acks[Math.floor(Math.random() * acks.length)];
}

export function generateResponse(
  action: ActionType,
  targetField: string | undefined,
  behavior: Behavior,
  missingFields: string[],
  lead: Lead | null
): string {
  const firstName = lead?.name?.value?.split(" ")[0];
  const nameCtx = firstName ? `, ${firstName}` : "";
  const angry = behavior === 'ANGRY' || behavior === 'HOSTILE';
  const rushed = behavior === 'RUSHED' || behavior === 'MINIMAL';
  const anxious = behavior === 'ANXIOUS' || behavior === 'DISTRESSED';

  if (action === "CLOSE") {
    const ticket = lead?.ticketId ? ` Your ticket number is ${lead.ticketId}.` : "";
    return `Thank you so much for calling${nameCtx}!${ticket} The team will be reaching out to you shortly. Hope your day gets better — take care!`;
  }

  if (action === "TRANSFER" || action === "ESCALATE") {
    return `Of course${nameCtx} — totally understand. Let me get someone from the team on the line for you right away. Just one moment.`;
  }

  if (action === "CLARIFY") {
    return `I want to make sure I'm helping you the right way${nameCtx}. Could you tell me a little more about what you need?`;
  }

  if (action === "CONFIRM") {
    const service = lead?.service?.value;
    const problem = lead?.problem?.value;
    const rType = lead?.requestType?.value;

    let issueSummary: string;
    if (problem) {
      issueSummary = `${problem}`;
    } else if (service) {
      const cleanService = service.replace(/_/g, " ").toLowerCase();
      if (rType === "INSTALLATION" || rType === "REPLACEMENT") {
        issueSummary = `an installation request for ${cleanService}`;
      } else if (rType === "ESTIMATE") {
        issueSummary = `an estimate for ${cleanService}`;
      } else if (rType === "MAINTENANCE") {
        issueSummary = `maintenance for ${cleanService}`;
      } else {
        issueSummary = `an issue with ${cleanService}`;
      }
    } else {
      issueSummary = "the request you described";
    }

    const urgencyCtx = (lead?.urgency?.value === "CRITICAL" || lead?.urgency?.value === "HIGH") ? " I've noted this is urgent." : "";
    return `Just to make sure I've got everything right${nameCtx} — you reached out about ${issueSummary}.${urgencyCtx} Does that still sound correct, or is there anything you'd like to add or change?`;
  }

  if (action === "CONTINUE") {
    // Usually means LEAD_READY_RECAP
    const ticket = lead?.ticketId ? `Your reference number is ${lead.ticketId}` : "Your request has been logged";
    const address = lead?.address?.value || "your location";
    const problem = lead?.problem?.value || "your service request";
    const namePart = firstName ? `you're all set, ${firstName}` : "you're all set";
    return `Alright — ${namePart}! I have a request on file for ${address}. ${ticket}. Is there anything else about the situation you'd like me to flag for the team before we wrap up?`;
  }

  if (action === "ASK_FIELD" && targetField) {
    if (targetField === "name") {
      const empathy = (lead?.problem?.value && !angry && !rushed) ? "Oh, I'm so sorry to hear about that, we will definitely help you out to fix this! " : "";
      if (angry) return `${empathy}Let's get this taken care of right away. I just need a few details. Could I start with your name?`;
      if (rushed) return `${empathy}Let's keep this quick. What is your name?`;
      return `${empathy}I'd love to help get this sorted! I just need to collect a little bit of information so the team knows who to ask for. Could I start with your name?`;
    }

    if (targetField === "phone") {
      if (lead?.phone?.status === "INVALID" || lead?.phone?.status === "AMBIGUOUS") {
        return `Sorry${nameCtx}, I think I may have missed part of that number. Could you give me your full 10-digit callback number again?`;
      }
      if (rushed) return `${getAck()} What's the best callback number?`;
      return `${getAck()} And what's the best callback number for the team to reach you on, so they can keep you updated?`;
    }

    if (targetField === "requestType") {
      if (rushed) return `${getAck()} What type of service do you need?`;
      return `${getAck()} What type of service do you need — is this a repair, installation, maintenance, something else?`;
    }

    if (targetField === "service") {
      const rType = lead?.requestType?.value;
      if (rType === "INSTALLATION" || rType === "REPLACEMENT") {
        return `${getAck()} What equipment are we installing?`;
      }
      if (rType === "MAINTENANCE") {
        return `${getAck()} Which system needs maintenance?`;
      }
      return `${getAck()} Can you give me a few more details on exactly what needs service?`;
    }

    if (targetField === "problem") {
      const rType = lead?.requestType?.value;
      if (rType === "INSTALLATION" || rType === "REPLACEMENT") {
        if (angry) return `${getAck()} Walk me through exactly what needs to be installed.`;
        if (rushed) return `${getAck()} Is the new unit already delivered?`;
        return `Got it. Could you tell me a bit more about the installation — is the new equipment already there?`;
      }
      if (rType === "ESTIMATE") {
        return `Sure thing. Could you describe what you'd like an estimate for?`;
      }
      if (angry) return `${getAck()} Walk me through exactly what's happening — I want to make sure the team has the full picture.`;
      if (rushed) return `${getAck()} Briefly, what's happening?`;
      if (anxious) return `Don't worry${nameCtx}, we're going to get this handled. Can you describe what's going on in a bit more detail?`;
      return `Could you describe what's happening? Any detail helps the team show up prepared.`;
    }

    if (targetField === "address") {
      if (lead?.address?.status === "AMBIGUOUS") {
        return `I want to make sure the team heads to the right place${nameCtx}. Could you give me the full service address — street number and all?`;
      }
      if (rushed) return `${getAck()} What's the full service address?`;
      return `${getAck()} And what's the full service address where you need someone to come out to${nameCtx}?`;
    }

    if (targetField === "urgency") {
      if (rushed) return `${getAck()} Do you need someone out there today, or is there flexibility?`;
      if (anxious) return `I hear you${nameCtx} — how urgently do you need someone out there? Is this something you need today, or is there some flexibility?`;
      return `How urgent is this for you${nameCtx}? Do you need someone out there today, or is there some flexibility on timing?`;
    }
  }

  // Fallback
  return `I want to make sure I'm helping you the right way${nameCtx}. Could you tell me a little more about what you need?`;
}
