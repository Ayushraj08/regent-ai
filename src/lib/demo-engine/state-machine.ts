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
import { resolveExistingRequest } from "./controller/identity-matcher";
import { createRequestWithCustomer, updateRequestField, cancelRequest } from "../db/services/request-service";
import { db } from "../db/db-client";

const providers: LLMProvider[] = [
  new GroqProvider("qwen/qwen3.8-27b"),
  new OpenAIProvider("gpt-4o-mini"),
  new GeminiProvider("gemini-2.5-flash")
];

if (process.env.ENABLE_OPENROUTER_DEV_FALLBACK === "true") {
  providers.push(new OpenRouterProvider("meta-llama/llama-3.1-8b-instruct"));
}

import { processRelagentTurn } from "./relagent-engine";

const router = new ProviderRouter(providers, 3500); // 3.5s budget

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function processDemoUtterance(
  request: EngineRequest,
  turnId: string = crypto.randomUUID()
): Promise<EngineResponse> {
  return processRelagentTurn(request);
}

export async function processLegacyDemoUtterance(
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
        updatedSession.currentAction = "ESCALATE_SAFETY";
        updatedSession.diagnosticReason = "Safety interrupt triggered";
      } else if (interrupt.action === "HUMAN_TRANSFER") {
        updatedSession.state = "TRANSFER";
        updatedSession.currentAction = "HANDLE_HUMAN_REQUEST";
        updatedSession.diagnosticReason = "Human transfer requested";
      } else if (interrupt.action === "END_CALL") {
        updatedSession.state = "END";
        updatedSession.currentAction = "CLOSE_CALL";
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

      // Identity Matching
      const match = await resolveExistingRequest(
        "00000000-0000-0000-0000-000000000001", // Hardcoded UUID for demo engine
        session.callerPhone || null,
        session.callerTicketId || null,
        session.trade
      );

      let greeting = "Welcome to our service center! How may I help you today?";
      let updatedSession: ConversationSession = { ...session };
      
      updatedSession.recordingDisclosureGiven = false;

      if (match.confidence === "MATCH_CONFIRMED" || match.confidence === "MATCH_HIGH_CONFIDENCE") {
        const customer = match.customer;
        const request = match.request;
        
        if (request) {
          greeting = `Welcome back${customer?.name ? ', ' + customer.name : ''}. I see you have an open request for ${request.trade} ${request.request_type || request.primary_service}. Are you calling about that request?`;
          
          // Seed the session with existing request context
          updatedSession.ticketId = request.ticket_id;
          updatedSession.trade = request.trade as any;
          updatedSession.requestType = request.request_type as any;
          if (customer?.name) updatedSession.lead.name = { value: customer.name, status: "VALID", confidence: 1, sourceTurn: 0, updatedTurn: 0, turn: 0 };
          if (customer?.phone) updatedSession.lead.phone = { value: customer.phone, status: "VALID", confidence: 1, sourceTurn: 0, updatedTurn: 0, turn: 0 };
          if (request.service_address) updatedSession.lead.address = { value: request.service_address, status: "VALID", confidence: 1, sourceTurn: 0, updatedTurn: 0, turn: 0 };
          if (request.problem) updatedSession.lead.problem = { value: request.problem, status: "VALID", confidence: 1, sourceTurn: 0, updatedTurn: 0, turn: 0 };
        } else if (customer) {
          greeting = `Welcome back${customer?.name ? ', ' + customer.name : ''}. How can I help you today?`;
          if (customer?.name) updatedSession.lead.name = { value: customer.name, status: "VALID", confidence: 1, sourceTurn: 0, updatedTurn: 0, turn: 0 };
          if (customer?.phone) updatedSession.lead.phone = { value: customer.phone, status: "VALID", confidence: 1, sourceTurn: 0, updatedTurn: 0, turn: 0 };
        }
      }

      updatedSession = {
        ...updatedSession,
        state: "COLLECTING",
        currentAction: "ANSWER_QUESTION",
        diagnosticReason: "Greeting — waiting for customer request",
        conversationHistory: [
          ...updatedSession.conversationHistory,
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
    session.fallbackLoopCount = 0;
    const policyResult = await evaluatePolicy(session, nlu, utterance);
    let updatedSession = policyResult.session;

    // ── 4.5. Master Record Flushing (Phase 4) ──────────
    const businessId = "00000000-0000-0000-0000-000000000001";

    // A. New Lead Completion
    if ((updatedSession.finalizationStatus === "COMPLETE" || updatedSession.finalizationStatus === "IN_PROGRESS") && 
        session.finalizationStatus === "IDLE" && !updatedSession.callerTicketId) {
      // It just transitioned to COMPLETE this turn, and it's not a returning customer
      try {
        const { request, ticket } = await createRequestWithCustomer(businessId, {
          name: updatedSession.lead.name.value,
          phone: updatedSession.lead.phone.value
        }, {
          trade: updatedSession.trade,
          requestType: updatedSession.requestType,
          primaryService: updatedSession.primaryService,
          problem: updatedSession.lead.problem.value,
          address: updatedSession.lead.address.value
        }, turnId);
        
        updatedSession.ticketId = ticket.public_reference;
        updatedSession.callerTicketId = ticket.public_reference;
        policyResult.ticketId = ticket.public_reference;
        updatedSession.finalizationStatus = "COMPLETE";
      } catch (e) {
        console.error("Failed to flush to DB", e);
      }
    }

    // B. Returning Customer Material Changes
    if (updatedSession.callerTicketId) {
      const activeTicket = await db.findTicketByPublicReference(updatedSession.callerTicketId, businessId);
      if (activeTicket) {
        const activeRequest = await db.findServiceRequestById(activeTicket.service_request_id);
        if (activeRequest) {
          // Did intent trigger a cancellation?
          if (updatedSession.intent === "CANCELLATION" && activeRequest.status !== "CANCELLED") {
            await cancelRequest(activeRequest.id, turnId);
            updatedSession.diagnosticReason = "Customer requested cancellation; updated DB.";
          }
          
          // Did the address change during this turn?
          const oldAddress = session.lead.address.value;
          const newAddress = updatedSession.lead.address.value;
          if (newAddress && newAddress !== oldAddress && oldAddress !== null) {
            await updateRequestField(activeRequest.id, turnId, "service_address", oldAddress, newAddress, "ADDRESS_CHANGED");
          }
          
          // Follow-up / Complaint
          if (updatedSession.currentAction === "RECOVERY" || updatedSession.intent === "COMPLAINT") {
            console.log("Complaint flow matched — executing specific resolution.");
            await db.createRequestEvent({
              service_request_id: activeRequest.id,
              conversation_id: turnId,
              event_type: updatedSession.intent,
              new_value: { utterance },
              source: 'CUSTOMER_REPORTED'
            });
          }
        }
      }
    }

    // C. Call Log
    await db.createConversationRecord({
      business_id: businessId,
      conversation_id: session.sessionId,
      channel: 'PHONE',
      started_at: new Date().toISOString(),
      outcome: updatedSession.state
    });

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
    let responseText = await generateResponse(
      updatedSession.currentAction,
      getTargetField(updatedSession),
      updatedSession.customerBehavior,
      updatedSession.missingFields,
      updatedSession
    );

    // ── 6.5. Add Recording Disclosure ──────────────────────────────────────
    if (!updatedSession.recordingDisclosureGiven && updatedSession.state !== "START" && updatedSession.state !== "END" && updatedSession.state !== "TRANSFER") {
      responseText = responseText + " Just a quick note before we continue: this call is recorded for quality and business purposes.";
      updatedSession.recordingDisclosureGiven = true;
    }

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
    return await getSafeFallbackResponse(session, utterance, startTime, telemetry, globalErr);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the target field for the current ASK_FIELD action.
 * Reads from the question ledger's latest PENDING entry.
 */
function getTargetField(session: ConversationSession): string | undefined {
  if (session.currentAction !== "CAPTURE_INFORMATION") return undefined;
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
    currentAction: session.currentAction,
    targetField: getTargetField(session) || null,
    diagnosticReason: session.diagnosticReason,
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
async function getSafeFallbackResponse(
  session: ConversationSession,
  utterance: string,
  startTime: number,
  telemetry: TelemetryData,
  error: any
): Promise<EngineResponse> {
  telemetry.result = "ERROR";
  telemetry.error_type = error.classification || "TRANSIENT";
  telemetry.duration_ms = Date.now() - startTime;
  console.log(
    JSON.stringify({ event: "REGENT_TELEMETRY", ...telemetry, message: error.message })
  );

  // ── Deterministic Fallback Logic ──
  // The LLM failed. We extract as much as possible from the raw utterance
  // using deterministic regex, then run the policy engine normally.
  // This ensures multi-field utterances like "my name is X, number is Y, address is Z"
  // are handled correctly even when the LLM is down.

  let updatedSession = { ...session };
  const text = utterance;
  const textLower = utterance.toLowerCase();
  const currentTurn = session.turnCount + 1;

  // ── Step 1: Multi-field extraction via regex ───────────────────────────────

  // Extract name — "my name is X" or "I am X" or "I'm X" or just the name if 1-3 words
  if (!session.lead.name?.value || session.lead.name.status === "MISSING") {
    const wordCount = text.trim().split(/\s+/).length;
    let nameVal = null;
    if (wordCount <= 3 && /\p{L}/u.test(text)) {
      nameVal = text.trim();
    } else {
      const nameMatch = text.match(/(?:my name is|i am|i'm|i am called|this is|name(?: is)?[:\s]+)\s*([\p{L}]{1,25}(?:\s+[\p{L}]{1,25})?)/iu);
      if (nameMatch) nameVal = nameMatch[1].trim();
    }
    
    if (nameVal) {
      updatedSession.lead = {
        ...updatedSession.lead,
        name: { value: nameVal, status: "CAPTURED", confidence: 0.85, sourceTurn: currentTurn, updatedTurn: currentTurn }
      };
    }
  }

  // Extract phone — any 10-digit sequence (with or without separators)
  if (!session.lead.phone?.value || session.lead.phone.status === "MISSING" || session.lead.phone.status === "INVALID") {
    const digits = text.replace(/\D/g, "");
    const phoneMatch = digits.match(/(\d{10})/);
    if (phoneMatch) {
      updatedSession.lead = {
        ...updatedSession.lead,
        phone: { value: phoneMatch[1], status: "CAPTURED", confidence: 0.9, sourceTurn: currentTurn, updatedTurn: currentTurn }
      };
    }
  }

  // Extract address — "address is X" or street-number pattern
  if (!session.lead.address?.value || session.lead.address.status === "MISSING" || session.lead.address.status === "AMBIGUOUS") {
    const addrMatch = text.match(/(?:address(?:\s+is)?[:\s]+|at\s+)(\d+\s+[^,.]+(?:,\s*[^,]+)*)/i);
    if (addrMatch) {
      updatedSession.lead = {
        ...updatedSession.lead,
        address: { value: addrMatch[1].trim(), status: "CAPTURED", confidence: 0.8, sourceTurn: currentTurn, updatedTurn: currentTurn }
      };
    }
  }

  // ── Step 2: Detect intent from utterance ──────────────────────────────────
  let detectedIntent: any = session.intent || "PROVIDE_INFORMATION";
  if (/already provided|already gave|gave you|told you|said before|i already/i.test(textLower)) {
    // Customer is frustrated about repeating themselves — keep intent as-is, mark behavior
    updatedSession.customerBehavior = "FRUSTRATED";
  }
  if (/complaint|poor|terrible|bad|disappoint|unsatisfied|not happy|angry/i.test(textLower)) {
    detectedIntent = "COMPLAINT";
  }

  // ── Step 3: Run normal policy engine with the enriched session ────────────
  const mockNLU = {
    intent: detectedIntent,
    behavior: updatedSession.customerBehavior,
    confidence: 0.75,
    extracted: {},  // extraction already merged above directly
    safety: { status: "NORMAL" as any, category: null, confidence: 1.0 }
  };

  try {
    const policyResult = await evaluatePolicy(updatedSession, mockNLU, utterance);
    updatedSession = policyResult.session;
    
    let targetField = getTargetField(updatedSession);
    
    // 3.5 Fallback Loop Prevention
    updatedSession.fallbackLoopCount++;
    if (updatedSession.fallbackLoopCount >= 2) {
      updatedSession.state = "TRANSFER";
      updatedSession.currentAction = "HANDLE_HUMAN_REQUEST";
      updatedSession.diagnosticReason = "Consecutive LLM failures — escalating to human";
      return buildEngineResponse(
        "I'm having trouble processing that right now. Let me get someone from the team on the line to help you.",
        updatedSession,
        true,
        false
      );
    }

    let fallbackResponse = await generateResponse(
      updatedSession.currentAction,
      targetField,
      updatedSession.customerBehavior,
      updatedSession.missingFields,
      updatedSession
    );
    return buildEngineResponse(fallbackResponse, updatedSession, policyResult.shouldTransfer, policyResult.complete, policyResult.ticketId);
  } catch (innerErr) {
    // ── DETERMINISTIC FALLBACK ───────────────────────────────────────────────
    // If all LLMs fail, or the policy engine crashes, we fallback to a safe deterministic mode.
    console.error("LLM or Policy Engine failed, entering DETERMINISTIC_FALLBACK", innerErr);
    
    const firstName = updatedSession.lead.name?.value?.split(" ")[0];
    const nameCtx = firstName ? `, ${firstName}` : "";
    
    // 1. Calculate missing fields deterministically
    const { getRequiredFields } = require("./controller/required-fields");
    const { isSettled } = require("./types");
    const { getLeadField } = require("./controller/field-merger");
    
    const required = getRequiredFields(updatedSession);
    const missingFields = required.filter((f: string) => {
      const fieldData = getLeadField(updatedSession.lead, f);
      return !isSettled(fieldData?.status);
    });
    updatedSession.missingFields = missingFields;

    // 2. Handle explicit explicit end
    if (session.state === "WAITING_FOR_FINAL_INPUT" && /no|nothing|that's it|all set/i.test(textLower)) {
      const ticket = updatedSession.ticketId ? `Your reference is ${updatedSession.ticketId}. ` : "";
      return buildEngineResponse(
        `Absolutely${nameCtx}. ${ticket}Thanks for calling. Take care!`,
        { ...updatedSession, state: "CLOSED" as any }, false, true
      );
    }

    if (session.state === "AWAITING_ISSUE_CONFIRMATION" && /yes|correct|right|yeah|yep/i.test(textLower)) {
      return buildEngineResponse(
        `Got it${nameCtx}. Is there anything else you'd like me to note for the team?`,
        { ...updatedSession, state: "CONFIRMED" as any }, false, false
      );
    }

    // 3. Determine next action
    let targetField = missingFields.length > 0 ? missingFields[0] : undefined;
    
    // 3.5 Fallback Loop Prevention
    if (targetField && updatedSession.lastFallbackTarget === targetField) {
      updatedSession.fallbackLoopCount++;
      if (updatedSession.fallbackLoopCount >= 2) {
        // Escalate to human
        updatedSession.state = "TRANSFER";
        updatedSession.currentAction = "HANDLE_HUMAN_REQUEST";
        updatedSession.diagnosticReason = "Fallback loop prevented — escalating to human";
        return buildEngineResponse(
          "I'm having trouble processing that right now. Let me get someone from the team on the line to help you.",
          updatedSession,
          true,
          false
        );
      }
    } else {
      updatedSession.lastFallbackTarget = targetField || null;
      updatedSession.fallbackLoopCount = 0;
    }

    if (targetField) {
      updatedSession.currentAction = "CAPTURE_INFORMATION";
      updatedSession.state = "COLLECTING";
    } else if (updatedSession.state === "COLLECTING" || updatedSession.state === "START") {
      updatedSession.currentAction = "CONFIRM_REQUEST";
      updatedSession.state = "AWAITING_ISSUE_CONFIRMATION";
    }

    // 4. Generate deterministic response
    const { generateResponse } = require("./controller/response-generator");
    let fallbackResponse = await generateResponse(
      updatedSession.currentAction,
      targetField,
      updatedSession.customerBehavior,
      missingFields,
      updatedSession
    );
    if (!updatedSession.recordingDisclosureGiven && (updatedSession.state as string) !== "START" && (updatedSession.state as string) !== "CLOSED" && (updatedSession.state as string) !== "END") {
      fallbackResponse += " Just a quick note before we continue: this call is recorded for quality and business purposes.";
      updatedSession.recordingDisclosureGiven = true;
    }

    return buildEngineResponse(fallbackResponse, updatedSession, false, false);
  }
}

