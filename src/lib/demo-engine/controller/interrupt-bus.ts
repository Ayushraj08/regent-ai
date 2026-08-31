import { EngineRequest } from "../types";

export type InterruptResult = {
  triggered: boolean;
  action?: 'SAFETY_ESCALATE' | 'HUMAN_TRANSFER' | 'END_CALL' | 'CANCEL' | 'RESTART';
  reason?: string;
  response?: string;
};

export function evaluateGlobalInterrupts(request: EngineRequest): InterruptResult {
  const utt = request.utterance.toLowerCase().trim();

  // 1. SAFETY - Highest priority
  if (
    utt.includes("fire") ||
    utt.includes("smoke") ||
    utt.includes("sparking") ||
    utt.includes("gas") ||
    utt.includes("flooding") ||
    utt.includes("burning") ||
    utt.includes("burst pipe")
  ) {
    return {
      triggered: true,
      action: 'SAFETY_ESCALATE',
      reason: 'CRITICAL_SAFETY',
      response: "This sounds like a serious safety concern. Please prioritize your safety and contact local emergency services if you are in any danger."
    };
  }

  // 2. HUMAN REQUEST / STOP
  if (
    utt === "i want to speak to a human" ||
    utt === "speak to a human" ||
    utt === "human" ||
    utt === "representative" ||
    utt === "agent" ||
    utt === "person" ||
    utt.includes("give me a real person")
  ) {
    return {
      triggered: true,
      action: 'HUMAN_TRANSFER',
      reason: 'HUMAN_REQUEST',
      response: "I understand you'd like to speak with someone. I will transfer you right away."
    };
  }

  // 3. SESSION CONTROL (End, Cancel, Restart)
  if (utt === "cancel" || utt === "never mind" || utt === "stop" || utt === "forget it") {
    return {
      triggered: true,
      action: 'CANCEL',
      reason: 'USER_CANCELLED',
      response: "Okay, I've cancelled that for you."
    };
  }
  
  if (utt === "restart" || utt === "start over") {
    return {
      triggered: true,
      action: 'RESTART',
      reason: 'USER_RESTARTED',
      response: "Sure, let's start over."
    };
  }

  if (utt === "goodbye" || utt === "bye") {
    return {
      triggered: true,
      action: 'END_CALL',
      reason: 'USER_ENDED',
      response: "Goodbye."
    };
  }

  return { triggered: false };
}
