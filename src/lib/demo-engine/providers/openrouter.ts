import { EngineRequest, NLUResponse, NLUResponseSchema } from "../types";
import { LLMProvider, ProviderError, FailureClassification } from "./types";

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

  async generate(request: EngineRequest, options: { signal: AbortSignal }): Promise<NLUResponse> {
    if (!this.apiKey) {
      throw this.createError("OpenRouter API key missing", 'CONFIGURATION_ERROR');
    }

    const { state, trade, lead, utterance } = request;

    const systemInstruction = `You are the Natural Language Understanding (NLU) layer for Regent.
Your ONLY job is to extract structured intent, behavior, lead fields, and safety flags from the user's utterance.
Do NOT decide the next state or the response text. The State Controller will handle that.

BUSINESS CONFIGURATION:
- Industry: ${trade}

INTENTS:
NEW_SERVICE_REQUEST, EXISTING_CUSTOMER, EMERGENCY, HUMAN_REQUEST, PRICE_QUESTION, HOURS_QUESTION, SERVICE_AREA_QUESTION, STATUS_QUESTION, CANCELLATION, RESCHEDULE, GENERAL_QUESTION, COMPLAINT, WRONG_NUMBER, SPAM_OR_ABUSE, OFF_TOPIC, UNSURE, OTHER

BEHAVIORS:
CALM, NEUTRAL, POSITIVE, CONFUSED, ANXIOUS, FRUSTRATED, ANGRY, RESISTANT, RUSHED, UNCERTAIN, DISTRESSED, HOSTILE, COOPERATIVE, UNCOOPERATIVE, TALKATIVE, MINIMAL, OFF_TOPIC

SAFETY:
Categorize if dangerous. NORMAL, ELEVATED, CRITICAL, UNKNOWN. (e.g., GAS_SUSPECTED, FIRE).

EXTRACTION RULES:
ONLY extract fields that the user explicitly mentions or implies. OMIT all other fields from the JSON.
Status must be one of: CAPTURED, REFUSED, UNKNOWN, NOT_APPLICABLE.
You must return confidence scores.

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
        if (response.status === 429) {
          throw this.createError(`Rate limited by OpenRouter`, 'RATE_LIMITED');
        }
        if (response.status >= 500) {
          throw this.createError(`OpenRouter server error: ${response.status}`, 'SERVER_ERROR');
        }
        if (response.status === 401 || response.status === 403) {
          throw this.createError(`OpenRouter auth error`, 'AUTH_INVALID');
        }
        throw this.createError(`OpenRouter API error: ${response.status}`, 'APPLICATION_ERROR');
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;

      if (!text) {
        throw this.createError("No text returned from OpenRouter", 'SERVER_ERROR');
      }

      let parsedJson;
      try {
        parsedJson = JSON.parse(text);
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
