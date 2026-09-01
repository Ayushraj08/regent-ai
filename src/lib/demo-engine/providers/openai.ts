import { NLUResponse, NLUResponseSchema } from "../types";
import { LLMProvider, ProviderError, FailureClassification } from "./types";
import { ServiceCatalog } from "../config/taxonomy";

export class OpenAIProvider implements LLMProvider {
  public id = "openai";
  private modelName: string;
  private apiKey: string | undefined;

  constructor(modelName: string = "gpt-4o-mini") {
    this.modelName = modelName;
    this.apiKey = process.env.OPENAI_API_KEY;
    if (!this.apiKey) {
      console.warn("OPENAI_API_KEY is not set. OpenAI will be marked as UNAVAILABLE.");
    }
  }

  getName(): string {
    return `OpenAI (${this.modelName})`;
  }

  async generate(request: any, options: { signal: AbortSignal }): Promise<NLUResponse> {
    if (!this.apiKey) {
      throw this.createError("OpenAI API key missing", "CONFIGURATION_ERROR");
    }

    const { state, trade, lead, utterance, turnCount = 0 } = request;
    const catalogStr =
      trade && ServiceCatalog[trade]
        ? JSON.stringify(
            ServiceCatalog[trade].map((s: { id: string; displayName: string; supportedRequestTypes: string[]; aliases?: string[] }) => ({
            id: s.id,
            displayName: s.displayName,
            requestTypes: s.supportedRequestTypes,
            aliases: s.aliases?.slice(0, 8)
          })),
            null,
            2
          )
        : "Trade not specified";

    const systemInstruction = `You are the Natural Language Understanding (NLU) layer for Regent, a home-services AI.
Your ONLY job is to extract structured intent, behavior, lead fields, and safety flags from the customer's utterance.
Do NOT decide the next state or response text — the State Controller handles that.

BUSINESS CONFIGURATION:
- Industry: ${trade ?? "Unknown"}
- Service Catalog (CRITICAL — map customer language to these IDs):
${catalogStr}

INTENTS:
NEW_SERVICE_REQUEST, EXISTING_CUSTOMER, EMERGENCY, HUMAN_REQUEST, PRICE_QUESTION, HOURS_QUESTION, SERVICE_AREA_QUESTION, STATUS_QUESTION, CANCELLATION, RESCHEDULE, GENERAL_QUESTION, SOCIAL_QUESTION, COMPLAINT, WRONG_NUMBER, SPAM_OR_ABUSE, OFF_TOPIC, UNSURE, PROVIDE_INFORMATION, END_CALL, OTHER

REQUEST TYPES (SEPARATE from service):
REPAIR, INSTALLATION, REPLACEMENT, MAINTENANCE, INSPECTION, DIAGNOSTIC, UPGRADE, ESTIMATE, GENERAL_SERVICE, EMERGENCY, OTHER, UNKNOWN

BEHAVIORS:
CALM, NEUTRAL, POSITIVE, CONFUSED, ANXIOUS, FRUSTRATED, ANGRY, RESISTANT, RUSHED, UNCERTAIN, DISTRESSED, HOSTILE, COOPERATIVE, UNCOOPERATIVE, TALKATIVE, MINIMAL, OFF_TOPIC

EXTRACTION RULES (CRITICAL):
1. SEPARATE intent vs requestType vs service:
   - "I need AC installation" → requestType=INSTALLATION, service=AC_INSTALLATION
   - "My AC stopped cooling" → requestType=REPAIR, service=AC_REPAIR
   - "I want to service my AC" → requestType=MAINTENANCE, service=AC_MAINTENANCE
2. Map colloquial phrases to Catalog IDs using the aliases provided.
3. Extract ALL fields mentioned in one utterance (name, phone, address, service, requestType, problem, urgency)
4. OMIT fields NOT mentioned. Status: CAPTURED, REFUSED, UNKNOWN, NOT_APPLICABLE.
5. Include confidence scores.
6. Set isCorrection=true if the customer is correcting a previously given field.

JSON FORMAT — return ONLY this structure:
{
  "intent": "NEW_SERVICE_REQUEST",
  "behavior": "CALM",
  "confidence": 0.95,
  "extracted": {
    "name": { "value": "Ayush", "status": "CAPTURED", "confidence": 0.99, "sourceTurn": ${turnCount}, "updatedTurn": ${turnCount} },
    "requestType": "INSTALLATION",
    "service": "AC_INSTALLATION"
  },
  "safety": { "status": "NORMAL", "category": null, "confidence": 0.99 },
  "isCorrection": false,
  "correctionField": null
}`;

    const prompt = `Current State: ${state}
Known Lead Info: ${JSON.stringify(lead)}
Latest Customer Utterance: "${utterance}"

Extract the intent, behavior, safety, and updated fields. Map service language to Catalog IDs.`;

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        }),
        signal: options.signal,
      });

      if (!response.ok) {
        if (response.status === 400) {
          console.warn("[OPENAI] 400 Bad Request — likely a content filter or moderation block. Emitting safety critical NLU.");
          return {
            intent: "COMPLAINT",
            behavior: "HOSTILE",
            confidence: 1.0,
            safety: { status: "CRITICAL", category: "content_filter", confidence: 1.0 }
          };
        }
        if (response.status === 429) throw this.createError("Rate limited by OpenAI", "RATE_LIMITED");
        if (response.status >= 500) throw this.createError(`OpenAI server error: ${response.status}`, "SERVER_ERROR");
        if (response.status === 401 || response.status === 403) throw this.createError("OpenAI auth error", "AUTH_INVALID");
        throw this.createError(`OpenAI API error: ${response.status}`, "APPLICATION_ERROR");
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw this.createError("No text returned from OpenAI", "SERVER_ERROR");

      let parsedJson: any;
      try {
        parsedJson = JSON.parse(text);
      } catch {
        throw this.createError("Invalid JSON returned", "APPLICATION_ERROR");
      }

      const validation = NLUResponseSchema.safeParse(parsedJson);
      if (!validation.success) {
        const coerced = coerceNLUResponse(parsedJson);
        const retry = NLUResponseSchema.safeParse(coerced);
        if (!retry.success) {
          throw this.createError(`Schema mismatch: ${validation.error.message}`, "APPLICATION_ERROR");
        }
        return retry.data;
      }

      return validation.data;
    } catch (error: any) {
      if ((error as ProviderError).classification) throw error;
      let classification: FailureClassification = "SERVER_ERROR";
      if (error.name === "AbortError") classification = "TRANSIENT_TIMEOUT";
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

function coerceNLUResponse(raw: any): any {
  const result = { ...raw };
  if (result.extracted) {
    const ex = { ...result.extracted };
    if (typeof ex.requestType === "object" && ex.requestType !== null) {
      ex.requestType = ex.requestType.value || null;
    }
    if (typeof ex.service === "object" && ex.service !== null) {
      ex.service = ex.service.value || null;
    }
    result.extracted = ex;
  }
  return result;
}
