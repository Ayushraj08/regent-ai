import { GoogleGenAI } from "@google/genai";
import { NLUResponse, NLUResponseSchema } from "../types";
import { LLMProvider, ProviderError, FailureClassification } from "./types";
import { ServiceCatalog } from "../config/taxonomy";

export class GeminiProvider implements LLMProvider {
  public id = "gemini";
  private ai: GoogleGenAI;
  private modelName: string;

  constructor(modelName: string) {
    if (!process.env.GEMINI_API_KEY) {
      console.warn("GEMINI_API_KEY is not set.");
    }
    this.ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
    this.modelName = modelName;
  }

  getName(): string {
    return `GoogleGenAI (${this.modelName})`;
  }

  async generate(request: any, options: { signal: AbortSignal }): Promise<NLUResponse> {
    const { state, trade, lead, utterance, turnCount = 0 } = request;
    const catalogStr = trade && ServiceCatalog[trade]
      ? JSON.stringify(
          ServiceCatalog[trade].map((s: any) => ({
            id: s.id,
            displayName: s.displayName,
            requestTypes: s.supportedRequestTypes ?? s.requestTypes,
            aliases: s.aliases?.slice(0, 8)
          })),
          null, 2
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
3. Extract ALL fields mentioned in one utterance.
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

    const historyStr = request.conversationHistory
      ? request.conversationHistory.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n')
      : "No history yet.";

    const prompt = `Current State: ${state}
Known Lead Info: ${JSON.stringify(lead)}
Conversation History:
${historyStr}

Latest Customer Utterance: "${utterance}"

Extract the intent, behavior, safety, and updated fields.`;

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      if (!response.text) {
        throw this.createError("No response text from Gemini", 'SERVER_ERROR');
      }

      let parsedJson;
      try {
        parsedJson = JSON.parse(response.text);
      } catch (err) {
        throw this.createError("Invalid JSON returned", 'APPLICATION_ERROR');
      }

      const validation = NLUResponseSchema.safeParse(parsedJson);
      if (!validation.success) {
        // Try coercion
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
      if ((error as ProviderError).classification) {
        throw error;
      }
      
      let classification: FailureClassification = 'SERVER_ERROR';
      
      if (error.name === 'AbortError') {
        classification = 'TRANSIENT_TIMEOUT';
      } else if (error?.message?.includes("API Key") || error?.status === 403 || error?.status === 401 || error?.message?.includes("AUTHENTICATION")) {
        classification = 'AUTH_INVALID';
      } else if (error?.status === 400) {
        classification = 'APPLICATION_ERROR';
      } else if (error?.status === 429 || error?.message?.includes("RESOURCE_EXHAUSTED") || error?.message?.includes("429")) {
        classification = 'QUOTA_EXHAUSTED';
      }

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
