import { EngineRequest, EngineResponse, NLUResponse, ConversationState, ActionType } from "./types";
import { GeminiProvider } from "./providers/gemini";
import { GroqProvider } from "./providers/groq";
import { OpenAIProvider } from "./providers/openai";
import { OpenRouterProvider } from "./providers/openrouter";
import { ProviderRouter } from "./providers/router";
import { ProviderError, TelemetryData, LLMProvider } from "./providers/types";
import { evaluateGlobalInterrupts } from "./controller/interrupt-bus";
import { evaluatePolicy } from "./controller/policy-engine";
import { generateResponse } from "./controller/response-generator";

const providers: LLMProvider[] = [
  new GroqProvider("qwen/qwen3.8-27b"),
  new OpenAIProvider("gpt-4o-mini"),
  new GeminiProvider("gemini-3.7-flash")
];

if (process.env.ENABLE_OPENROUTER_DEV_FALLBACK === "true") {
  providers.push(new OpenRouterProvider("meta-llama/llama-3.1-8b-instruct"));
}

const router = new ProviderRouter(providers, 3500); // 3.5s budget

export async function processDemoUtterance(request: EngineRequest, turnId: string = crypto.randomUUID()): Promise<EngineResponse> {
  const telemetry: TelemetryData = {
    turn_id: turnId,
    provider: "Router",
    model: "Multi",
    started_at: new Date().toISOString(),
    duration_ms: 0,
    result: 'SUCCESS',
    fallback_used: false,
    initial_provider: "",
    attempted_providers: [],
    final_provider: "",
    final_latency_ms: 0,
    total_turn_latency_ms: 0,
  };

  const startTime = Date.now();

  try {
    // 1. Global Interrupt Bus
    const interrupt = evaluateGlobalInterrupts(request);
    if (interrupt.triggered && interrupt.response) {
      telemetry.duration_ms = Date.now() - startTime;
      telemetry.provider = "InterruptBus";
      telemetry.model = "none";
      console.log(JSON.stringify({ event: 'REGENT_TELEMETRY', ...telemetry }));
      
      let nextState: ConversationState = "COLLECTING";
      let action: ActionType = "CONTINUE";

      if (interrupt.action === 'SAFETY_ESCALATE') {
        nextState = "ESCALATED";
        action = "ESCALATE";
      } else if (interrupt.action === 'HUMAN_TRANSFER') {
        nextState = "TRANSFER";
        action = "TRANSFER";
      } else if (interrupt.action === 'END_CALL') {
        nextState = "END";
        action = "CLOSE";
      }

      return {
        response: interrupt.response,
        state: nextState,
        extracted: request.lead,
        missingFields: [],
        safety: { status: interrupt.action === 'SAFETY_ESCALATE' ? 'CRITICAL' : 'NORMAL', category: null, confidence: 1.0 },
        shouldTransfer: interrupt.action === 'SAFETY_ESCALATE' || interrupt.action === 'HUMAN_TRANSFER',
        complete: false,
        action
      };
    }

    if (request.state === "START") {
      telemetry.duration_ms = Date.now() - startTime;
      console.log(JSON.stringify({ event: 'REGENT_TELEMETRY', ...telemetry }));
      
      return {
        response: "Welcome to our service center! How may I help you today?",
        state: "COLLECTING",
        extracted: request.lead,
        missingFields: [],
        safety: { status: 'NORMAL', category: null, confidence: 1.0 },
        shouldTransfer: false,
        complete: false,
        action: "CONTINUE"
      };
    }

    // 2. NLU Processing via Router
    const { nlu, telemetry: routerTelemetry } = await router.route(request, turnId, startTime);
    Object.assign(telemetry, routerTelemetry);

    // 3. Policy Engine Evaluation
    const policyResult = evaluatePolicy(request, nlu);

    // Stamp ticketId onto the extracted lead so response-generator can reference it
    // and so it flows back to the client in the extracted lead for future turns
    const extractedLead = policyResult.extracted || request.lead;
    if (policyResult.ticketId) {
      extractedLead.ticketId = policyResult.ticketId;
    } else if (request.lead.ticketId) {
      // Preserve existing ticketId from previous turns
      extractedLead.ticketId = request.lead.ticketId;
    }

    // 4. Response Generation
    const responseText = generateResponse(policyResult.action || "CONTINUE", policyResult.targetField, nlu.behavior, policyResult.missingFields || [], extractedLead);

    telemetry.duration_ms = Date.now() - startTime;
    telemetry.result = 'SUCCESS';
    console.log(JSON.stringify({ event: 'REGENT_TELEMETRY', ...telemetry }));

    return {
      response: responseText,
      state: policyResult.state || request.state,
      extracted: extractedLead,
      missingFields: policyResult.missingFields || [],
      safety: policyResult.safety || { status: 'NORMAL', category: null, confidence: 1.0 },
      shouldTransfer: policyResult.shouldTransfer || false,
      complete: policyResult.complete || false,
      ticketId: extractedLead.ticketId,
      action: policyResult.action || "CONTINUE",
      targetField: policyResult.targetField
    };

  } catch (globalErr: any) {
    return getSafeFallbackResponse(request, startTime, telemetry, globalErr);
  }
}

function getSafeFallbackResponse(request: EngineRequest, startTime: number, telemetry: TelemetryData, error: any): EngineResponse {
  telemetry.result = 'ERROR';
  telemetry.error_type = error.classification || 'TRANSIENT';
  telemetry.duration_ms = Date.now() - startTime;
  console.log(JSON.stringify({ event: 'REGENT_TELEMETRY', ...telemetry, message: error.message }));
  
  return {
    response: "I'm having trouble processing that right now. Could you repeat that?",
    state: request.state,
    extracted: request.lead,
    missingFields: [],
    safety: { status: "NORMAL", category: null, confidence: 1.0 },
    shouldTransfer: false,
    complete: false,
    action: "CLARIFY"
  };
}

