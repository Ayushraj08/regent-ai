import {
  ConversationSession,
  EngineRequest,
  EngineResponse,
  NLUResponse,
  makeEmptySession
} from "./types";
import { GeminiProvider } from "./providers/gemini";
import { GroqProvider } from "./providers/groq";
import { OpenAIProvider } from "./providers/openai";
import { OpenRouterProvider } from "./providers/openrouter";
import { ProviderRouter } from "./providers/router";
import { TelemetryData, LLMProvider } from "./providers/types";
import { evaluateGlobalInterrupts } from "./controller/interrupt-bus";
import { evaluatePolicy } from "./controller/policy-engine";
import { generateResponse } from "./controller/response-generator";

const providers: LLMProvider[] = [
  new GroqProvider("qwen/qwen3.8-27b"),
  new OpenAIProvider("gpt-4o-mini"),
  new GeminiProvider("gemini-2.5-flash")
];

if (process.env.ENABLE_OPENROUTER_DEV_FALLBACK === "true") {
  providers.push(new OpenRouterProvider("meta-llama/llama-3.1-8b-instruct"));
}

const router = new ProviderRouter(providers, 3500); // 3.5s budget

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function processDemoUtterance(
  request: EngineRequest,
  turnId: string = crypto.randomUUID()
): Promise<EngineResponse> {

  const { session, utterance } = request;

  const telemetry: TelemetryData = {
    turn_id: turnId,
    provider: "Router",
    model: "Multi",
    started_at: new Date().toISOString(),
    duration_ms: 0,
    result: "SUCCESS",
    fallback_used: false,
    initial_provider: "",
    attempted_providers: [],
    final_provider: "",
    final_latency_ms: 0,
    total_turn_latency_ms: 0,
  };

  const startTime = Date.now();

  try {
    // ── 1. Global Interrupt Bus (deterministic, highest priority) ────────────
    const interrupt = evaluateGlobalInterrupts({ session, utterance } as any);
    if (interrupt.triggered && interrupt.response) {
      telemetry.duration_ms = Date.now() - startTime;
      telemetry.provider = "InterruptBus";
      telemetry.model = "none";
      console.log(JSON.stringify({ event: "REGENT_TELEMETRY", ...telemetry }));

      let updatedSession: ConversationSession = { ...session };

      if (interrupt.action === "SAFETY_ESCALATE") {
        updatedSession.state = "ESCALATED";
        updatedSession.currentAction = "ESCALATE";
        updatedSession.diagnosticReason = "Safety interrupt triggered";
      } else if (interrupt.action === "HUMAN_TRANSFER") {
        updatedSession.state = "TRANSFER";
        updatedSession.currentAction = "TRANSFER";
        updatedSession.diagnosticReason = "Human transfer requested";
      } else if (interrupt.action === "END_CALL") {
        updatedSession.state = "END";
        updatedSession.currentAction = "CLOSE";
        updatedSession.diagnosticReason = "User ended call";
      }

      // Add to conversation history
      updatedSession.conversationHistory = [
        ...updatedSession.conversationHistory,
        { role: "CUSTOMER", content: utterance },
        { role: "REGENT", content: interrupt.response }
      ];

      return buildEngineResponse(interrupt.response, updatedSession, false, false);
    }

    // ── 2. Handle START state ─────────────────────────────────────────────
    if (session.state === "START") {
      telemetry.duration_ms = Date.now() - startTime;
      console.log(JSON.stringify({ event: "REGENT_TELEMETRY", ...telemetry }));

      const greeting = "Welcome to our service center! How may I help you today?";
      const updatedSession: ConversationSession = {
        ...session,
        state: "COLLECTING",
        currentAction: "CONTINUE",
        diagnosticReason: "Greeting — waiting for customer request",
        conversationHistory: [
          ...session.conversationHistory,
          { role: "REGENT", content: greeting }
        ]
      };
      return buildEngineResponse(greeting, updatedSession, false, false);
    }

    // ── 3. NLU Processing via Router ──────────────────────────────────────
    const { nlu, telemetry: routerTelemetry } = await router.route(
      // Pass a compat object the providers can work with
      {
        session,
        utterance,
        // Legacy compat fields for providers
        state: session.state,
        trade: session.trade,
        lead: buildLegacyLead(session),
        conversationHistory: session.conversationHistory,
        turnCount: session.turnCount,
      } as any,
      turnId,
      startTime
    );
    Object.assign(telemetry, routerTelemetry);

    // ── 4. Policy Engine — merge + canonicalize + resolve action ──────────
    const policyResult = evaluatePolicy(session, nlu, utterance);
    let updatedSession = policyResult.session;

    // ── 5. Add turn to conversation history ───────────────────────────────
    // Response generation happens next, so we add it after
    updatedSession = {
      ...updatedSession,
      conversationHistory: [
        ...updatedSession.conversationHistory,
        { role: "CUSTOMER", content: utterance }
      ]
    };

    // ── 6. Generate response text ─────────────────────────────────────────
    const responseText = generateResponse(
      updatedSession.currentAction,
      getTargetField(updatedSession),
      updatedSession.customerBehavior,
      updatedSession.missingFields,
      updatedSession
    );

    // ── 7. Add Regent's response to history ───────────────────────────────
    updatedSession = {
      ...updatedSession,
      conversationHistory: [
        ...updatedSession.conversationHistory,
        { role: "REGENT", content: responseText }
      ]
    };

    telemetry.duration_ms = Date.now() - startTime;
    telemetry.result = "SUCCESS";
    console.log(JSON.stringify({ event: "REGENT_TELEMETRY", ...telemetry }));

    return buildEngineResponse(
      responseText,
      updatedSession,
      policyResult.shouldTransfer,
      policyResult.complete,
      policyResult.ticketId
    );

  } catch (globalErr: any) {
    return getSafeFallbackResponse(session, utterance, startTime, telemetry, globalErr);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the target field for the current ASK_FIELD action.
 * Reads from the question ledger's latest PENDING entry.
 */
function getTargetField(session: ConversationSession): string | undefined {
  if (session.currentAction !== "ASK_FIELD") return undefined;
  // Find the most recently added PENDING question
  const pending = [...session.questionLedger]
    .reverse()
    .find(e => e.status === "PENDING");
  return pending?.field;
}

/**
 * Build the EngineResponse from the updated session.
 */
function buildEngineResponse(
  responseText: string,
  session: ConversationSession,
  shouldTransfer: boolean,
  complete: boolean,
  ticketId?: string | null
): EngineResponse {
  return {
    response: responseText,
    session,
    shouldTransfer,
    complete,
    // Legacy compat fields
    state: session.state,
    missingFields: session.missingFields,
    safety: session.safety,
    action: session.currentAction,
    ticketId: ticketId ?? session.ticketId ?? null,
  };
}

/**
 * Build a legacy Lead-compatible object from the session for provider prompts.
 * The providers still use the old Lead shape internally.
 */
function buildLegacyLead(session: ConversationSession) {
  return {
    trade: session.trade,
    name: session.lead.name,
    phone: session.lead.phone,
    address: session.lead.address,
    requestType: {
      value: session.requestType,
      status: session.requestType ? "CAPTURED" : "MISSING",
      confidence: session.requestType ? 0.9 : 0,
      turn: 0
    },
    service: {
      value: session.primaryService,
      status: session.primaryService ? "CAPTURED" : "MISSING",
      confidence: session.primaryService ? 0.9 : 0,
      turn: 0
    },
    problem: session.lead.problem,
    urgency: session.lead.urgency,
  };
}

/**
 * Safe fallback when an unhandled error occurs.
 */
function getSafeFallbackResponse(
  session: ConversationSession,
  utterance: string,
  startTime: number,
  telemetry: TelemetryData,
  error: any
): EngineResponse {
  telemetry.result = "ERROR";
  telemetry.error_type = error.classification || "TRANSIENT";
  telemetry.duration_ms = Date.now() - startTime;
  console.log(
    JSON.stringify({ event: "REGENT_TELEMETRY", ...telemetry, message: error.message })
  );

  // ── Deterministic Fallback Logic ──
  // If the LLM completely fails, we try to extract the answer based on the last action.

  let updatedSession = { ...session };
  let fallbackResponse = "I'm having trouble processing that right now. Could you repeat that?";
  
  const lastAction = session.currentAction;
  const targetField = getTargetField(session);
  const text = utterance.toLowerCase();

  // 1. Complaint Context Recovery
  // If we just asked for the problem (HANDLE_COMPLAINT) and they explained it:
  if (lastAction === "HANDLE_COMPLAINT") {
    updatedSession.lead.problem = {
      value: "Customer described the issue (fallback extraction)",
      status: "CAPTURED",
      confidence: 0.8,
      sourceTurn: session.turnCount,
      updatedTurn: session.turnCount
    };
    updatedSession.intent = "COMPLAINT";
    
    // We manually advance state by calling the policy engine with a mock NLU
    const mockNLU = {
      intent: "COMPLAINT" as any,
      behavior: session.customerBehavior,
      confidence: 0.8,
      extracted: {},
      safety: { status: "NORMAL" as any, category: null, confidence: 1.0 }
    };
    const policyResult = evaluatePolicy(updatedSession, mockNLU, utterance);
    updatedSession = policyResult.session;
    
    fallbackResponse = generateResponse(
      updatedSession.currentAction,
      getTargetField(updatedSession),
      updatedSession.customerBehavior,
      updatedSession.missingFields,
      updatedSession
    );
    
    return buildEngineResponse(fallbackResponse, updatedSession, policyResult.shouldTransfer, policyResult.complete, policyResult.ticketId);
  }

  // 2. Phone Number Regex Extraction
  if (targetField === "phone") {
    const phoneMatch = text.replace(/[^0-9]/g, '');
    if (phoneMatch.length >= 10) {
      updatedSession.lead.phone = {
        value: phoneMatch.slice(-10),
        status: "CAPTURED",
        confidence: 0.9,
        sourceTurn: session.turnCount,
        updatedTurn: session.turnCount
      };
      
      const mockNLU = {
        intent: session.intent || "PROVIDE_INFORMATION",
        behavior: session.customerBehavior,
        confidence: 0.8,
        safety: { status: "NORMAL" as any, category: null, confidence: 1.0 }
      };
      const policyResult = evaluatePolicy(updatedSession, mockNLU, utterance);
      updatedSession = policyResult.session;
      fallbackResponse = generateResponse(updatedSession.currentAction, getTargetField(updatedSession), updatedSession.customerBehavior, updatedSession.missingFields, updatedSession);
      return buildEngineResponse(fallbackResponse, updatedSession, policyResult.shouldTransfer, policyResult.complete, policyResult.ticketId);
    } else {
      updatedSession.currentAction = "CLARIFY";
      fallbackResponse = "I want to make sure I get that exactly right. Could you provide your 10-digit phone number one more time?";
      return buildEngineResponse(fallbackResponse, updatedSession, false, false);
    }
  }

  // 3. General Field Fallback
  if (lastAction === "ASK_FIELD" && targetField) {
    updatedSession.currentAction = "CLARIFY";
    fallbackResponse = `I want to make sure I get that exactly right. Could you provide your ${targetField} one more time?`;
    return buildEngineResponse(fallbackResponse, updatedSession, false, false);
  }

  // 4. Default Fallback
  updatedSession.currentAction = "CLARIFY";
  return buildEngineResponse(
    "I'm having a little trouble connecting. Could you repeat that?",
    updatedSession,
    false,
    false
  );
}
