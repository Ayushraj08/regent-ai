import { NLUResponse, NLUResponseSchema } from "../types";
import { LLMProvider, ProviderError, FailureClassification } from "./types";
import { ServiceCatalog } from "../config/taxonomy";

export class OpenRouterProvider implements LLMProvider {
  public id = "openrouter";
  private modelName: string;
  private apiKey: string | undefined;

  constructor(modelName: string = "meta-llama/llama-3.1-8b-instruct") {
    this.modelName = modelName;
    this.apiKey = process.env.OPENROUTER_API_KEY;
    if (!this.apiKey) {
      console.warn("OPENROUTER_API_KEY is not set. OpenRouter will be marked as UNAVAILABLE.");
    }
  }

  getName(): string {
    return `OpenRouter (${this.modelName})`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async generate(request: any, options: { signal: AbortSignal }): Promise<NLUResponse> {
    if (!this.apiKey) {
      throw this.createError("OpenRouter API key missing", 'CONFIGURATION_ERROR');
    }

    const { state, trade, lead, utterance, turnCount = 0 } = request;
    const catalogStr = trade && ServiceCatalog[trade]
      ? JSON.stringify(
          ServiceCatalog[trade].map((s: { id: string; displayName: string; supportedRequestTypes: string[] }) => ({
            id: s.id,
            displayName: s.displayName,
            requestTypes: s.supportedRequestTypes,
          })),
          null, 2
        )
      : "Trade not specified";

    const systemInstruction = `You are the Natural Language Understanding (NLU) layer for Regent.
Your ONLY job is to extract structured intent, behavior, lead fields, and safety flags from the user's utterance.
Do NOT decide the next state or the response text. The State Controller will handle that.

BUSINESS CONFIGURATION:
- Industry: ${trade ?? "Unknown"}
- Service Catalog: ${catalogStr}

INTENTS:
NEW_SERVICE_REQUEST, EXISTING_CUSTOMER, EMERGENCY, HUMAN_REQUEST, PRICE_QUESTION, HOURS_QUESTION, SERVICE_AREA_QUESTION, STATUS_QUESTION, CANCELLATION, RESCHEDULE, GENERAL_QUESTION, SOCIAL_QUESTION, COMPLAINT, WRONG_NUMBER, SPAM_OR_ABUSE, OFF_TOPIC, UNSURE, PROVIDE_INFORMATION, END_CALL, OTHER

REQUEST TYPES (SEPARATE from service):
REPAIR, INSTALLATION, REPLACEMENT, MAINTENANCE, INSPECTION, DIAGNOSTIC, UPGRADE, ESTIMATE, GENERAL_SERVICE, EMERGENCY, OTHER, UNKNOWN

BEHAVIORS:
CALM, NEUTRAL, POSITIVE, CONFUSED, ANXIOUS, FRUSTRATED, ANGRY, RESISTANT, RUSHED, UNCERTAIN, DISTRESSED, HOSTILE, COOPERATIVE, UNCOOPERATIVE, TALKATIVE, MINIMAL, OFF_TOPIC

EXTRACTION RULES:
1. Map customer language to catalog IDs. "AC installation" → AC_INSTALLATION
2. ONLY extract fields that the user explicitly mentions. Status: CAPTURED, REFUSED, UNKNOWN, NOT_APPLICABLE.
3. Include confidence scores.

JSON FORMAT:
{
  "intent": "NEW_SERVICE_REQUEST",
  "behavior": "CALM",
  "confidence": 0.9,
  "extracted": {
    "name": { "value": "Ayush", "status": "CAPTURED", "confidence": 0.99, "sourceTurn": ${turnCount}, "updatedTurn": ${turnCount} },
    "phone": { "value": "8955555565", "status": "CAPTURED", "confidence": 0.99, "sourceTurn": ${turnCount}, "updatedTurn": ${turnCount} },
    "address": { "value": "123 Main Street, New York", "status": "CAPTURED", "confidence": 0.95, "sourceTurn": ${turnCount}, "updatedTurn": ${turnCount} },
    "problem": { "value": "AC is not cooling and the room is getting hotter", "status": "CAPTURED", "confidence": 0.95, "sourceTurn": ${turnCount}, "updatedTurn": ${turnCount} },
    "urgency": { "value": "HIGH", "status": "CAPTURED", "confidence": 0.90, "sourceTurn": ${turnCount}, "updatedTurn": ${turnCount} },
    "requestType": "INSTALLATION",
    "service": "AC_INSTALLATION"
  },
  "safety": { "status": "NORMAL", "category": null, "confidence": 0.99 },
  "isCorrection": false,
  "correctionField": null
}

CRITICAL: When the customer describes a malfunction or symptom (e.g. "AC not cooling", "stopped working", "room getting hotter"), ALWAYS extract that as:
  "problem": { "value": "<customer description>", "status": "CAPTURED", ... }
Do NOT omit the problem field when the customer clearly describes a symptom.`;

    const prompt = `Current State: ${state}
Known Lead Info: ${JSON.stringify(lead)}
Latest Customer Utterance: "${utterance}"

Extract the intent, behavior, safety, and updated fields.`;

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "Regent Engine",
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1
        }),
        signal: options.signal
      });

      if (!response.ok) {
        if (response.status === 429) throw this.createError(`Rate limited by OpenRouter`, 'RATE_LIMITED');
        if (response.status >= 500) throw this.createError(`OpenRouter server error: ${response.status}`, 'SERVER_ERROR');
        if (response.status === 401 || response.status === 403) throw this.createError(`OpenRouter auth error`, 'AUTH_INVALID');
        throw this.createError(`OpenRouter API error: ${response.status}`, 'APPLICATION_ERROR');
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw this.createError("No text returned from OpenRouter", 'SERVER_ERROR');

      let parsedJson;
      try {
        parsedJson = JSON.parse(text);
      } catch {
        throw this.createError("Invalid JSON returned", 'APPLICATION_ERROR');
      }

      const validation = NLUResponseSchema.safeParse(parsedJson);
      if (!validation.success) {
        const coerced = { ...parsedJson };
        if (coerced.extracted) {
          coerced.extracted = { ...coerced.extracted };
          if (typeof coerced.extracted.requestType === "object" && coerced.extracted.requestType !== null) {
            coerced.extracted.requestType = coerced.extracted.requestType.value || null;
          }
          if (typeof coerced.extracted.service === "object" && coerced.extracted.service !== null) {
            coerced.extracted.service = coerced.extracted.service.value || null;
          }
        }
        const retry = NLUResponseSchema.safeParse(coerced);
        if (!retry.success) {
          throw this.createError(`Schema mismatch: ${validation.error.message}`, 'APPLICATION_ERROR');
        }
        return retry.data;
      }

      return validation.data;
    } catch (error: any) {
      if ((error as ProviderError).classification) throw error;
      let classification: FailureClassification = 'SERVER_ERROR';
      if (error.name === 'AbortError') classification = 'TRANSIENT_TIMEOUT';
      throw this.createError(error.message || "Unknown Provider Error", classification);
    }
  }

  private createError(message: string, classification: FailureClassification): ProviderError {
    const error = new Error(message) as ProviderError;
    error.classification = classification;
    error.provider = this.getName();
    return error;
  }
}
