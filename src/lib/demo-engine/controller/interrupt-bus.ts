export type InterruptResult = {
  triggered: boolean;
  action?: 'SAFETY_ESCALATE' | 'HUMAN_TRANSFER' | 'END_CALL' | 'CANCEL' | 'RESTART';
  reason?: string;
  response?: string;
};

export function evaluateGlobalInterrupts(request: { utterance: string; session?: { state?: string } }): InterruptResult {
  const utt = request.utterance.toLowerCase().trim();

  // Safety is now handled strictly by the LLM policy evaluation to prevent false positives.

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
