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

    const lastAskedField = request.session?.questionLedger?.slice(-1)[0]?.field || "none";

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

- Service Catalog: ${catalogStr}
- Target field we just asked for (if any): ${lastAskedField}

RULES:
1. SEPARATE intent vs requestType vs service:
   - "I need AC installation" → requestType=INSTALLATION, service=AC_INSTALLATION
   - "My AC stopped cooling" → requestType=REPAIR, service=AC_REPAIR
   - "I want to service my AC" → requestType=MAINTENANCE, service=AC_MAINTENANCE
2. INTENT CLASSIFICATION: NEW_SERVICE_REQUEST, EXISTING_CUSTOMER, EMERGENCY, HUMAN_REQUEST, PRICE_QUESTION, HOURS_QUESTION, SERVICE_AREA_QUESTION, STATUS_QUESTION, CANCELLATION, RESCHEDULE, GENERAL_QUESTION, SOCIAL_QUESTION, COMPLAINT, WRONG_NUMBER, SPAM_OR_ABUSE, OFF_TOPIC, UNSURE, PROVIDE_INFORMATION, END_CALL, OTHER.
3. If the user mentions prior service, a previous ticket, or speaking to an executive/agent before, ALWAYS set intent to EXISTING_CUSTOMER or COMPLAINT.
4. Extract ALL fields mentioned in one utterance (name, phone, address, service, requestType, problem, urgency).
5. OMIT fields NOT mentioned — do not fabricate. Status: CAPTURED, REFUSED, UNKNOWN, NOT_APPLICABLE.
6. NAMES: Do NOT extract a name UNLESS the user explicitly provides one (e.g. "My name is John" or "I am Ayush") OR if we just asked for their name. Do NOT extract conversational fillers, verbs (e.g. "facing", "having", "yes"), or generic nouns (e.g. "issue") as names.
7. PHONES: ALWAYS extract ANY sequence of digits the customer provides as their phone number, even if it is incomplete or too short.
8. Include confidence scores (0.0–1.0).
9. If customer corrects a field, set isCorrection=true and correctionField to the field being corrected.

JSON FORMAT — return ONLY this structure:
{
  "intent": "NEW_SERVICE_REQUEST",
  "behavior": "CALM",
  "confidence": 0.95,
  "extracted": {
    "name": { "value": "John", "status": "CAPTURED", "confidence": 0.99, "sourceTurn": ${turnCount}, "updatedTurn": ${turnCount} },
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
EVEN IF the customer is answering a different question (like confirming the service type), you MUST extract the problem if a symptom is mentioned. Do NOT omit it.`;

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
