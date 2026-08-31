import { GoogleGenAI } from "@google/genai";
import { EngineRequest, NLUResponse, NLUResponseSchema } from "../types";
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

  async generate(request: EngineRequest, options: { signal: AbortSignal }): Promise<NLUResponse> {
    const { state, trade, lead, utterance } = request;
    const catalogStr = trade && ServiceCatalog[trade] ? JSON.stringify(ServiceCatalog[trade], null, 2) : "Unknown Trade Catalog";

    const systemInstruction = `You are the Natural Language Understanding (NLU) layer for Regent.
Your ONLY job is to extract structured intent, behavior, lead fields, and safety flags from the user's utterance.
Do NOT decide the next state or the response text. The State Controller will handle that.

BUSINESS CONFIGURATION:
- Industry: ${trade}
- Service Catalog: ${catalogStr}

INTENTS:
NEW_SERVICE_REQUEST, EXISTING_CUSTOMER, EMERGENCY, HUMAN_REQUEST, PRICE_QUESTION, HOURS_QUESTION, SERVICE_AREA_QUESTION, STATUS_QUESTION, CANCELLATION, RESCHEDULE, GENERAL_QUESTION, COMPLAINT, WRONG_NUMBER, SPAM_OR_ABUSE, OFF_TOPIC, UNSURE, OTHER

REQUEST TYPES:
REPAIR, INSTALLATION, REPLACEMENT, MAINTENANCE, INSPECTION, DIAGNOSTIC, UPGRADE, ESTIMATE, GENERAL_SERVICE, EMERGENCY, OTHER, UNKNOWN

BEHAVIORS:
CALM, NEUTRAL, POSITIVE, CONFUSED, ANXIOUS, FRUSTRATED, ANGRY, RESISTANT, RUSHED, UNCERTAIN, DISTRESSED, HOSTILE, COOPERATIVE, UNCOOPERATIVE, TALKATIVE, MINIMAL, OFF_TOPIC

SAFETY:
Categorize if dangerous. NORMAL, ELEVATED, CRITICAL, UNKNOWN. (e.g., GAS_SUSPECTED, FIRE).

EXTRACTION RULES (CRITICAL):
1. SEPARATE INTENT vs REQUEST TYPE vs SERVICE: If a user says "I bought an AC and need it installed", Intent is NEW_SERVICE_REQUEST, RequestType is INSTALLATION, and Service is AC_INSTALLATION (map to Catalog ID).
2. LISTEN BROADLY: Extract ALL relevant fields (name, phone, address, requestType, service, problem, urgency) that the user volunteers in a single pass. Do not wait for them to be explicitly asked.
3. CORRECTIONS: If the user corrects previously captured information, update ONLY that specific field. Preserve all other existing fields exactly as they are in the Known Lead Info.
4. SILENCE/CONFUSION: If the user is silent or says "I don't know", classify intent as UNSURE and behavior as CONFUSED.
5. SEMANTIC SERVICE MAPPING: Map colloquial phrases (e.g., "put my new AC in", "hook up this air conditioner") to the closest formal Catalog ID (e.g. "AC_INSTALLATION").
6. Status must be one of: CAPTURED, REFUSED, UNKNOWN, NOT_APPLICABLE. You must return confidence scores.

JSON FORMAT:
You MUST return ONLY a valid JSON object matching this structure:
{
  "intent": "...",
  "behavior": "...",
  "confidence": 0.9,
  "extracted": {
    "service": { "value": "...", "status": "CAPTURED", "confidence": 0.9, "turn": ${request.turnCount} }
  },
  "safety": {
    "status": "NORMAL",
    "category": null,
    "confidence": 0.99
  }
}`;

    const historyStr = request.conversationHistory
      ? request.conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')
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
        throw this.createError(`Schema mismatch: ${validation.error.message}`, 'APPLICATION_ERROR');
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
