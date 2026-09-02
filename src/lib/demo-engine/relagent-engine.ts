import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import {
  ConversationSession,
  EngineRequest,
  EngineResponse,
  Trade,
} from "./types";
import { resolveDateTime, DateResolutionResult } from "./date-resolver";
import {
  generateTicketId,
  triggerNotificationWebhook,
  saveConfirmedTicket,
  saveConversationRecord,
} from "./ticket-service";
import { analyzeCustomerMood, MoodDiagnosticResult } from "./mood-resolver";
import {
  checkAbuse,
  checkOutOfScope,
  checkEmergencySafety,
} from "./safety-policy";

export interface ExtractedEntities {
  full_name?: string | null;
  phone_digits?: string | null;
  phone?: string | null;
  area_code?: string | null;
  street?: string | null;
  city?: string | null;
  zip?: string | null;
  address?: string | null;
  issue_description?: string | null;
  date_time_preference?: string | null;
  sentiment_tag?: "angry" | "happy" | "neutral" | null;
  why_customer_is_upset?: string | null;
  situation_context_notes?: string | null;
  recommended_next_action?: string | null;
}

const SYSTEM_PROMPT = `You are Regent, an empathetic, highly competent human-like receptionist for a local service business.
- **Tone:** Warm, personalized, and efficient. Adapt your tone dynamically (e.g., serious and empathetic if the caller is angry/anxious).
- **Goal:** Collect the customer's Full Name (as on ID), 10-digit Phone, Full Address (Street, City, Zip), Issue Description, and Date/Time preference.
- **Rules:**
  1. Never ask a wall of questions. Ask for exactly ONE missing piece of information at a time.
  2. NEVER ask for information you have already collected or that is in the conversation history or session state. Read the chat history carefully.
  3. Accept inputs in ANY language (e.g., Hindi, Spanish) or format. Transliterate non-Latin names and addresses to English, convert number words to digits, extract them via tool call, and move on naturally.
  4. Weave the required recording consent naturally into your first conversational response (e.g., 'I can certainly help with that AC issue! Just so you know, this call is recorded for training...'). Do not sound like a legal disclaimer. Do NOT repeat consent in subsequent turns.
  5. Use the user's first name in conversation, but confirm their full name at the end.
  6. **Phone Validation (No Loops):** If the customer gives less than 10 digits (e.g., a 7-digit local number), acknowledge it and naturally ask for the remaining digits (e.g., the 3-digit area code). Do NOT reject them aggressively or throw away what they gave you.
  7. **Address Validation (No Loops):** A complete address requires Street, City, and Zip. If the customer only gives a street name, accept it and naturally ask for the city and zip.
  8. You MUST call the extract_customer_info tool on EVERY turn where the caller provides ANY new information—including partial phone digits, area code, street name alone, city, zip code, or full address—so the backend captures it immediately.
  9. **Date/Time Resolution (Ambiguity Check):** If the customer mentions a day of the week that matches today (for example, saying 'Wednesday' when today is Wednesday), you MUST check if they mean today or next week: "Do you mean today, or next week Wednesday?" When referencing "today", strictly use the reference day-of-week and date provided in the state summary.
  10. **Confirmation & Wrap-up (Phase 4):** When all 5 pieces of information are gathered, summarize them clearly with clean bullet points and separate lines:
      Got it! Here is what I have for your service request:
      - **Full Name:** [Name]
      - **Phone:** [Phone]
      - **Address:** [Address]
      - **Issue:** [Problem]
      - **Preferred Service Time:** [Date and Time]

      **Does that look correct, or do you need to change anything?**
      Allow up to 2 changes. When confirmed, a ticket ID will be generated and you will ask if they need anything else before closing.
  11. **Mood Handling & Bad Experience Diagnosis (Phase 5):** If the customer is angry, frustrated, or mentions a past bad experience (e.g. technician didn't fix the issue, long wait time, poor service), NEVER argue or be defensive. Immediately acknowledge and validate their frustration with sincere empathy ("I completely understand how frustrating that is, and that is definitely not the experience we want you to have..."). Diagnose the root cause and extract mood diagnostics via the extract_customer_info tool.
  12. **Instant Human Escalation (Phase 6):** If the caller explicitly asks to speak with a human, representative, person, agent, operator, or manager (e.g., 'let me speak to a person', 'get me a human', 'representative please'), NEVER refuse, delay, or argue. Immediately agree and bridge gracefully: "I'd be glad to connect you with one of our team members right away. Please hold while I transfer your call."
  13. **Out-of-Scope & Abuse Protocol (Phase 7):**
      - If the user asks for topics outside home services (legal, recipes, homework, politics), politely decline and reframe back to service needs.
      - If the caller uses severe profanity or abuse, give exactly one polite warning. If repeated, politely terminate the call.
  14. **Emergency Protocol (Phase 8):** If the customer reports an active emergency (gas leak smell, sparking breaker, active major flood), prioritize immediate life safety first by providing proper evacuation or shutoff guidance, and expedite priority dispatch.
  15. **Output Constraints (Single Turn Only):** Output ONLY ONE single conversational utterance for the immediate turn. NEVER output trailing ellipsis dots (...), simulated silence prompts (e.g., 'Whenever you're ready...'), or imaginary future turns. Keep questions direct, warm, and natural.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "extract_customer_info",
      description:
        "Quietly saves customer info into session state in background. Extract full or partial phone digits, address components, date/time preferences, and mood diagnostics.",
      parameters: {
        type: "object",
        properties: {
          full_name: {
            type: ["string", "null"],
            description:
              "Customer's full name as on ID or name mentioned (transliterate non-Latin scripts to English)",
          },
          phone_digits: {
            type: ["string", "null"],
            description:
              "Phone number digits provided by the customer in this turn (either complete 10 digits or partial digits)",
          },
          area_code: {
            type: ["string", "null"],
            description:
              "3-digit area code if the user provided it separately to complete a partial phone number",
          },
          street: {
            type: ["string", "null"],
            description:
              "Street address or house number and street name (e.g. '1200 Market Street')",
          },
          city: {
            type: ["string", "null"],
            description: "City name (e.g. 'Dallas')",
          },
          zip: {
            type: ["string", "null"],
            description: "Zip or postal code (e.g. '75201')",
          },
          address: {
            type: ["string", "null"],
            description:
              "Complete address if full address was provided in a single phrase",
          },
          issue_description: {
            type: ["string", "null"],
            description: "Customer's issue or service need description",
          },
          date_time_preference: {
            type: ["string", "null"],
            description:
              "Customer's preferred date or time for service (e.g., 'Wednesday', 'tomorrow afternoon', 'today', 'Friday at 2pm', 'ASAP')",
          },
          sentiment_tag: {
            type: ["string", "null"],
            enum: ["angry", "happy", "neutral", null],
            description: "Customer's detected mood: 'angry', 'happy', or 'neutral'",
          },
          why_customer_is_upset: {
            type: ["string", "null"],
            description: "Short summary of why customer is upset or frustrated if applicable",
          },
          situation_context_notes: {
            type: ["string", "null"],
            description: "Detailed situation context notes for the business owner",
          },
          recommended_next_action: {
            type: ["string", "null"],
            description: "Actionable next step for dispatcher or owner (e.g. 'Assign senior tech', 'Waive dispatch fee')",
          },
        },
      },
    },
  },
];

function getBusinessName(trade: Trade | null): string {
  switch (trade) {
    case "HVAC":
      return "Apex Heating & Air";
    case "PLUMBING":
      return "Apex Plumbing Pros";
    case "ELECTRICAL":
      return "Apex Electrical Services";
    default:
      return "Apex Home Services";
  }
}

function isHumanEscalationRequested(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes("human") ||
    lower.includes("real person") ||
    lower.includes("live person") ||
    lower.includes("representative") ||
    lower.includes("operator") ||
    lower.includes("agent") ||
    lower.includes("someone else") ||
    lower.includes("talk to someone") ||
    lower.includes("speak to someone") ||
    lower.includes("speak with someone") ||
    lower.includes("transfer me") ||
    lower.includes("connect me") ||
    lower.includes("speak to a person") ||
    lower.includes("talk to a person") ||
    lower.includes("speak to manager") ||
    lower.includes("talk to manager") ||
    lower.includes("talk to supervisor") ||
    lower.includes("speak to supervisor")
  );
}

function cleanSpokenUtterance(raw: string): string {
  if (!raw) return "";
  let clean = raw.trim();

  // 1. Cut off at the first occurrence of 3 or more dots or unicode ellipsis chains (simulated future turns)
  if (/\.{3,}|\u2026{2,}/.test(clean)) {
    const parts = clean.split(/\.{3,}|\u2026{2,}/);
    if (parts[0] && parts[0].trim().length > 5) {
      clean = parts[0].trim();
    }
  }

  // 2. Remove redundant hallucinated prompt reprompt chains
  clean = clean
    .replace(
      /\s*(Whenever you’re ready|Whenever you are ready|I’m here whenever|I am here whenever|I understand it can be a bit of a hassle)[\s\S]*$/i,
      ""
    )
    .trim();

  // 3. Format run-on confirmation bullet points with clean newlines
  clean = clean.replace(/\s*([•\-]\s*\*\*?[A-Za-z\s]+:?\*\*?)/g, "\n$1");

  // 4. Ensure confirmation question starts on its own line
  clean = clean.replace(/\s*(\*\*?Does that look correct.*)/i, "\n\n$1");

  // 5. Remove trailing dots/dashes
  clean = clean.replace(/[\.\s\-]+$/, ".");

  return clean;
}

interface ParsedAddress {
  street?: string;
  city?: string;
  zip?: string;
}

function parseAddressString(addr: string): ParsedAddress {
  if (!addr) return {};
  const res: ParsedAddress = {};

  const zipMatch = addr.match(/\b\d{5}\b/);
  if (zipMatch) {
    res.zip = zipMatch[0];
  }

  // Remove zip for cleaner street/city parsing
  const clean = addr.replace(/\b\d{5}\b/, "").trim().replace(/,\s*$/, "");
  const parts = clean.split(",").map((p) => p.trim()).filter(Boolean);

  if (parts.length >= 2) {
    res.street = parts[0];
    res.city = parts[1];
  } else if (parts.length === 1) {
    if (/\d/.test(parts[0])) {
      res.street = parts[0];
    } else {
      res.city = parts[0];
    }
  }

  return res;
}

async function callChatCompletion(messages: any[]) {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const modelsToTry = [
    "openai/gpt-oss-120b",
    "qwen/qwen3.8-27b",
    "openai/gpt-oss-20b",
  ];

  let lastError: any = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${groqApiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            tools: TOOLS,
            tool_choice: "auto",
            temperature: 0.2,
          }),
        });

        if (res.status === 429) {
          // Rate limited on this model, wait 1.5s before retry or fallback
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`LLM provider error ${res.status}: ${errorText}`);
        }

        const data = await res.json();
        return data.choices?.[0]?.message;
      } catch (err: any) {
        lastError = err;
      }
    }
  }

  throw lastError || new Error("All LLM providers failed.");
}

export async function processRelagentTurn(
  request: EngineRequest
): Promise<EngineResponse> {
  const { session, utterance } = request;
  let updatedSession: ConversationSession = { ...session };
  const businessName = getBusinessName(session.trade);

  // ── 1. Deterministic Turn 0: Greeting ──────────────────────────────────────
  const isStartTurn =
    session.turnCount === 0 ||
    session.state === "START" ||
    (!utterance && session.conversationHistory.length === 0);

  if (isStartTurn) {
    const greeting = `Thank you for calling ${businessName}. This is Regent. How may I help you today?`;

    updatedSession = {
      ...updatedSession,
      state: "COLLECTING",
      turnCount: 1,
      recordingDisclosureGiven: false,
      conversationHistory: [
        ...updatedSession.conversationHistory,
        { role: "REGENT", content: greeting },
      ],
      currentAction: "ANSWER_QUESTION",
      diagnosticReason: "Phase 1: Deterministic initial greeting",
    };

    return {
      response: greeting,
      session: updatedSession,
      shouldTransfer: false,
      complete: false,
      state: updatedSession.state,
      missingFields: ["name", "phone", "address", "problem", "timing"],
      safety: { status: "NORMAL", category: null, confidence: 1.0 },
      currentAction: "ANSWER_QUESTION",
      targetField: null,
      diagnosticReason: updatedSession.diagnosticReason,
    };
  }

  // ── 2. LLM Turn 1+: Memory & Dynamic Response ──────────────────────────────
  const userText = utterance ? utterance.trim() : "";
  updatedSession.turnCount += 1;

  if (userText) {
    updatedSession.conversationHistory = [
      ...updatedSession.conversationHistory,
      { role: "CUSTOMER", content: userText },
    ];
  }

  // Determine current field statuses for system prompt injection
  const currentPhone = updatedSession.lead.phone?.value || "";
  const phoneDigits = currentPhone.replace(/\D/g, "");
  let phoneStatusStr = "NOT YET COLLECTED";
  if (phoneDigits.length === 10) {
    phoneStatusStr = `${phoneDigits} (VALID - Complete 10-digit number)`;
  } else if (phoneDigits.length > 0) {
    phoneStatusStr = `${phoneDigits} (PARTIAL - only ${phoneDigits.length} digits, need remaining digits/area code)`;
  }

  // Address components
  const currentAddress = updatedSession.lead.address?.value || "";
  const existingAddrParts = parseAddressString(currentAddress);
  const hasStreet = Boolean(existingAddrParts.street);
  const hasCity = Boolean(existingAddrParts.city);
  const hasZip = Boolean(existingAddrParts.zip);
  let addressStatusStr = "NOT YET COLLECTED";
  if (hasStreet && hasCity && hasZip) {
    addressStatusStr = `${currentAddress} (VALID - Complete with street, city, zip)`;
  } else if (hasStreet) {
    const missingParts = [!hasCity ? "city" : null, !hasZip ? "zip" : null]
      .filter(Boolean)
      .join(" and ");
    addressStatusStr = `${currentAddress} (PARTIAL - have street, naturally ask for ${missingParts})`;
  }

  // Date/Time components (Phase 3)
  const referenceDate = updatedSession.lead.context?.value?.startsWith("REF_DATE:")
    ? new Date(updatedSession.lead.context.value.replace("REF_DATE:", ""))
    : new Date();

  // Format reference date accurately in US Timezone (America/New_York)
  const usDateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const usTodayFormatted = usDateFormatter.format(referenceDate);

  const currentTiming = updatedSession.lead.timing?.value || "";
  const timingStatus = updatedSession.lead.timing?.status || "MISSING";
  let timingStatusStr = "NOT YET COLLECTED";
  if (timingStatus === "VALID") {
    timingStatusStr = `${currentTiming} (VALID - Exact date resolved)`;
  } else if (timingStatus === "AMBIGUOUS") {
    timingStatusStr = `${currentTiming} (AMBIGUOUS - You must clarify: "${
      updatedSession.lead.timing?.validationReason ||
      "Do you mean today, or next week Wednesday?"
    }")`;
  }

  // Inject current collected state summary for Zero-Loop Guarantee
  const stateSummary = `Current Collected State:
- Full Name: ${updatedSession.lead.name?.value || "NOT YET COLLECTED"}
- Phone: ${phoneStatusStr}
- Address: ${addressStatusStr}
- Issue: ${updatedSession.lead.problem?.value || "NOT YET COLLECTED"}
- Schedule / Preferred Date: ${timingStatusStr}
- Today's Date & Weekday (US Timezone): ${usTodayFormatted} (STRICT: If user mentions "today", use strictly ${usTodayFormatted})
- Customer Mood / Sentiment: ${
    updatedSession.moodDiagnostics?.sentimentTag?.toUpperCase() || "NEUTRAL"
  }${
    updatedSession.moodDiagnostics?.whyCustomerIsUpset
      ? ` (Note: ${updatedSession.moodDiagnostics.whyCustomerIsUpset})`
      : ""
  }
- Recording Consent Given: ${
    updatedSession.recordingDisclosureGiven
      ? "YES (DO NOT REPEAT)"
      : "NO (WEAVE NATURALLY IN THIS TURN)"
  }`;

  const llmMessages: any[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${stateSummary}` },
  ];

  for (const turn of updatedSession.conversationHistory) {
    if (turn.role === "CUSTOMER") {
      llmMessages.push({ role: "user", content: turn.content });
    } else {
      llmMessages.push({ role: "assistant", content: turn.content });
    }
  }

  let spokenReply = "";

  try {
    let assistantMsg = await callChatCompletion(llmMessages);

    // ── 3. Handle Tool Calls (Quiet Background Extraction & Validation) ─────────
    if (assistantMsg?.tool_calls && assistantMsg.tool_calls.length > 0) {
      for (const tc of assistantMsg.tool_calls) {
        if (tc.function?.name === "extract_customer_info") {
          try {
            const args: ExtractedEntities = JSON.parse(tc.function.arguments);

            // Name (Allow updates when user corrects name)
            if (args.full_name) {
              updatedSession.lead.name = {
                value: args.full_name,
                status: "VALID",
                confidence: 0.95,
                sourceTurn: updatedSession.lead.name?.sourceTurn || updatedSession.turnCount,
                updatedTurn: updatedSession.turnCount,
                turn: updatedSession.turnCount,
              };
            }

            // Issue Description (Allow updates)
            if (args.issue_description) {
              updatedSession.lead.problem = {
                value: args.issue_description,
                status: "VALID",
                confidence: 0.95,
                sourceTurn: updatedSession.lead.problem?.sourceTurn || updatedSession.turnCount,
                updatedTurn: updatedSession.turnCount,
                turn: updatedSession.turnCount,
              };
            }

            // Phone Validation Engine (Phase 2)
            const inputDigits = (args.phone_digits || args.phone || "").replace(
              /\D/g,
              ""
            );
            const inputAreaCode = (args.area_code || "").replace(/\D/g, "");

            let currentDigits = (
              updatedSession.lead.phone?.value || ""
            ).replace(/\D/g, "");

            if (inputDigits.length === 10) {
              currentDigits = inputDigits;
            } else if (inputDigits.length > 0) {
              if (currentDigits.length > 0 && currentDigits.length < 10) {
                // Merge partials (e.g. area code 3 digits + local 7 digits)
                if (inputDigits.length === 3 && currentDigits.length === 7) {
                  currentDigits = inputDigits + currentDigits;
                } else if (
                  currentDigits.length === 3 &&
                  inputDigits.length === 7
                ) {
                  currentDigits = currentDigits + inputDigits;
                } else if (currentDigits !== inputDigits) {
                  currentDigits = currentDigits + inputDigits;
                }
              } else {
                currentDigits = inputDigits;
              }
            }

            if (inputAreaCode.length === 3 && currentDigits.length === 7) {
              currentDigits = inputAreaCode + currentDigits;
            }

            if (currentDigits.length > 0) {
              const isPhoneValid = currentDigits.length === 10;
              updatedSession.lead.phone = {
                value: currentDigits,
                status: isPhoneValid ? "VALID" : "CAPTURED",
                confidence: isPhoneValid ? 1.0 : 0.75,
                sourceTurn: updatedSession.turnCount,
                updatedTurn: updatedSession.turnCount,
                turn: updatedSession.turnCount,
                validationReason: isPhoneValid
                  ? "Complete 10-digit phone"
                  : `Partial phone (${currentDigits.length}/10 digits)`,
              };
            }

            // Address Validation Engine (Phase 2 & 4)
            let addrStreet =
              args.street ||
              (args.address ? parseAddressString(args.address).street : "") ||
              existingAddrParts.street ||
              "";
            let addrCity =
              args.city ||
              (args.address ? parseAddressString(args.address).city : "") ||
              existingAddrParts.city ||
              "";
            let addrZip =
              args.zip ||
              (args.address ? parseAddressString(args.address).zip : "") ||
              existingAddrParts.zip ||
              "";

            // If user or LLM passed full address string in args.street or args.address
            if (args.address) {
              const parsed = parseAddressString(args.address);
              if (parsed.street) addrStreet = parsed.street;
              if (parsed.city) addrCity = parsed.city;
              if (parsed.zip) addrZip = parsed.zip;
            } else if (args.street && (args.street.includes(",") || /\b\d{5}\b/.test(args.street))) {
              const parsed = parseAddressString(args.street);
              if (parsed.street) addrStreet = parsed.street;
              if (parsed.city) addrCity = parsed.city;
              if (parsed.zip) addrZip = parsed.zip;
            }

            // Always retain existing city/zip if only street was changed
            if (!addrCity && existingAddrParts.city) addrCity = existingAddrParts.city;
            if (!addrZip && existingAddrParts.zip) addrZip = existingAddrParts.zip;

            const addressPartsPresent = [addrStreet, addrCity, addrZip].filter(
              Boolean
            );
            if (addressPartsPresent.length > 0) {
              const isAddressValid = Boolean(
                addrStreet && addrCity && addrZip
              );
              const formattedAddress = isAddressValid
                ? `${addrStreet}, ${addrCity} ${addrZip}`
                : addressPartsPresent.join(", ");

              updatedSession.lead.address = {
                value: formattedAddress,
                status: isAddressValid ? "VALID" : "CAPTURED",
                confidence: isAddressValid ? 1.0 : 0.7,
                sourceTurn: updatedSession.turnCount,
                updatedTurn: updatedSession.turnCount,
                turn: updatedSession.turnCount,
                validationReason: isAddressValid
                  ? "Complete address (Street, City, Zip)"
                  : `Partial address (Missing: ${[
                      !addrCity ? "City" : null,
                      !addrZip ? "Zip" : null,
                    ]
                      .filter(Boolean)
                      .join(", ")})`,
              };
            }
            // Date / Time Resolution Engine (Phase 3)
            if (args.date_time_preference) {
              const dateRes = resolveDateTime(
                args.date_time_preference,
                referenceDate
              );
              if (dateRes.isAmbiguous) {
                updatedSession.lead.timing = {
                  value: args.date_time_preference,
                  status: "AMBIGUOUS",
                  confidence: 0.5,
                  sourceTurn: updatedSession.turnCount,
                  updatedTurn: updatedSession.turnCount,
                  turn: updatedSession.turnCount,
                  validationReason: dateRes.clarificationPrompt,
                };
              } else if (dateRes.isResolved) {
                updatedSession.lead.timing = {
                  value:
                    dateRes.normalizedSchedule ||
                    dateRes.exactDate ||
                    args.date_time_preference,
                  status: "VALID",
                  confidence: 1.0,
                  sourceTurn: updatedSession.turnCount,
                  updatedTurn: updatedSession.turnCount,
                  turn: updatedSession.turnCount,
                  validationReason: `Resolved to exact date: ${dateRes.exactDate}`,
                };
              }
            }

            // Mood Diagnostics (Phase 5)
            if (args.sentiment_tag) {
              updatedSession.moodDiagnostics.sentimentTag = args.sentiment_tag;
              if (args.sentiment_tag === "angry") {
                updatedSession.customerBehavior = "ANGRY";
              } else if (args.sentiment_tag === "happy") {
                updatedSession.customerBehavior = "POSITIVE";
              }
            }
            if (args.why_customer_is_upset) {
              updatedSession.moodDiagnostics.whyCustomerIsUpset =
                args.why_customer_is_upset;
            }
            if (args.situation_context_notes) {
              updatedSession.moodDiagnostics.situationContextNotes =
                args.situation_context_notes;
            }
            if (args.recommended_next_action) {
              updatedSession.moodDiagnostics.recommendedNextAction =
                args.recommended_next_action;
            }
          } catch (e) {
            console.error("[Relagent] Error parsing tool call args:", e);
          }
        }
      }

      // If the model produced tool calls without text, feed the tool execution back
      if (!assistantMsg.content) {
        const followUpMessages = [
          ...llmMessages,
          assistantMsg,
          ...assistantMsg.tool_calls.map((tc: any) => ({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.function.name,
            content: JSON.stringify({
              status: "saved",
              phone: updatedSession.lead.phone?.value,
              phone_status: updatedSession.lead.phone?.status,
              address: updatedSession.lead.address?.value,
              address_status: updatedSession.lead.address?.status,
              schedule: updatedSession.lead.timing?.value,
              schedule_status: updatedSession.lead.timing?.status,
              schedule_clarification_required:
                updatedSession.lead.timing?.status === "AMBIGUOUS"
                  ? updatedSession.lead.timing?.validationReason
                  : null,
              mood: updatedSession.moodDiagnostics.sentimentTag,
            }),
          })),
        ];

        assistantMsg = await callChatCompletion(followUpMessages);
      }
    }

    // Background extraction fallback for address if not already VALID
    if (updatedSession.lead.address?.status !== "VALID") {
      const currentAddr = updatedSession.lead.address?.value || "";
      const currentParts = parseAddressString(currentAddr);
      let addrStreet = currentParts.street || existingAddrParts.street || "";
      let addrCity = currentParts.city || existingAddrParts.city || "";
      let addrZip = currentParts.zip || existingAddrParts.zip || "";

      // Check userText for street address patterns
      if (!addrStreet) {
        const streetMatch = userText.match(
          /\b\d{1,5}\s+[A-Za-z0-9\.\s]+(Terrace|Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Way|Lane|Ln|Court|Ct|Circle|Cir)\b/i
        );
        if (streetMatch) addrStreet = streetMatch[0].trim();
      }

      // Check userText for zip code (5 digits)
      if (!addrZip) {
        const zipMatch = userText.match(/\b\d{5}\b/);
        if (zipMatch) addrZip = zipMatch[0];
      }

      // Check userText for city in Spanish ("ciudad es <city>") or English ("city is <city>") or ", City 75201"
      if (!addrCity) {
        const cityMatch = userText.match(
          /(?:ciudad\s+(?:es|de)|city\s+(?:is|of))\s+([A-Za-z\s]+?)(?=\s+(?:y|and|,|\.|$|\d))/i
        );
        if (cityMatch) {
          addrCity = cityMatch[1].trim();
        } else {
          const cityZipMatch = userText.match(/,\s*([A-Za-z\s]+?)\s+\d{5}/);
          if (cityZipMatch) addrCity = cityZipMatch[1].trim();
        }
      }

      // Retain existing city/zip if only street is present
      if (!addrCity && existingAddrParts.city) addrCity = existingAddrParts.city;
      if (!addrZip && existingAddrParts.zip) addrZip = existingAddrParts.zip;

      const addressPartsPresent = [addrStreet, addrCity, addrZip].filter(Boolean);
      if (addressPartsPresent.length > 0) {
        const isAddressValid = Boolean(addrStreet && addrCity && addrZip);
        const formattedAddress = isAddressValid
          ? `${addrStreet}, ${addrCity} ${addrZip}`
          : addressPartsPresent.join(", ");

        updatedSession.lead.address = {
          value: formattedAddress,
          status: isAddressValid ? "VALID" : "CAPTURED",
          confidence: isAddressValid ? 1.0 : 0.7,
          sourceTurn: updatedSession.turnCount,
          updatedTurn: updatedSession.turnCount,
          turn: updatedSession.turnCount,
          validationReason: isAddressValid
            ? "Complete address (Street, City, Zip)"
            : `Partial address (Missing: ${[
                !addrCity ? "City" : null,
                !addrZip ? "Zip" : null,
              ]
                .filter(Boolean)
                .join(", ")})`,
        };
      }
    }

    // Background extraction fallback for timing if not already VALID
    if (updatedSession.lead.timing?.status !== "VALID") {
      const dateRes = resolveDateTime(userText, referenceDate);
      if (dateRes.isAmbiguous) {
        updatedSession.lead.timing = {
          value: userText,
          status: "AMBIGUOUS",
          confidence: 0.5,
          sourceTurn: updatedSession.turnCount,
          updatedTurn: updatedSession.turnCount,
          turn: updatedSession.turnCount,
          validationReason: dateRes.clarificationPrompt,
        };
      } else if (dateRes.isResolved) {
        updatedSession.lead.timing = {
          value: dateRes.normalizedSchedule || dateRes.exactDate || userText,
          status: "VALID",
          confidence: 1.0,
          sourceTurn: updatedSession.turnCount,
          updatedTurn: updatedSession.turnCount,
          turn: updatedSession.turnCount,
          validationReason: `Resolved to exact date: ${dateRes.exactDate}`,
        };
      }
    }

    // Background mood & bad experience analysis fallback (Phase 5)
    const moodAnalysis = analyzeCustomerMood(
      userText,
      updatedSession.conversationHistory.map((h) => `${h.role}: ${h.content}`).join("\n")
    );
    if (moodAnalysis.isUpset) {
      updatedSession.moodDiagnostics.sentimentTag = "angry";
      updatedSession.customerBehavior = "ANGRY";
      if (!updatedSession.moodDiagnostics.whyCustomerIsUpset) {
        updatedSession.moodDiagnostics.whyCustomerIsUpset =
          moodAnalysis.whyCustomerIsUpset;
      }
      if (!updatedSession.moodDiagnostics.situationContextNotes) {
        updatedSession.moodDiagnostics.situationContextNotes =
          moodAnalysis.situationContextNotes;
      }
      if (!updatedSession.moodDiagnostics.recommendedNextAction) {
        updatedSession.moodDiagnostics.recommendedNextAction =
          moodAnalysis.recommendedNextAction;
      }
    } else if (
      moodAnalysis.sentimentTag === "happy" &&
      updatedSession.moodDiagnostics.sentimentTag === "neutral"
    ) {
      updatedSession.moodDiagnostics.sentimentTag = "happy";
      updatedSession.customerBehavior = "POSITIVE";
    }

    spokenReply =
      assistantMsg?.content ||
      "I can certainly help with that. Could you please share your full name?";

    // Phase 5 Mandate: Empathy check for angry / upset customers (Rule 11)
    if (updatedSession.moodDiagnostics.sentimentTag === "angry") {
      const lowerReply = spokenReply.toLowerCase();
      const hasEmpathy =
        lowerReply.includes("understand") ||
        lowerReply.includes("frustrat") ||
        lowerReply.includes("sorry") ||
        lowerReply.includes("apologiz");
      if (!hasEmpathy) {
        spokenReply = `I completely understand why you're frustrated, and that is certainly not the experience we want you to have. Let me make sure we get this resolved for you right away. ${spokenReply}`;
      }
    }

    // Phase 3 Mandate: If date is ambiguous (e.g. Wednesday on Wednesday), ask clarification
    if (
      updatedSession.lead.timing?.status === "AMBIGUOUS" &&
      updatedSession.lead.timing.validationReason
    ) {
      const clarPrompt = updatedSession.lead.timing.validationReason;
      if (
        !spokenReply.toLowerCase().includes("today") ||
        !spokenReply.toLowerCase().includes("next week")
      ) {
        spokenReply = `Just to confirm: ${clarPrompt}`;
      }
    }

    spokenReply = cleanSpokenUtterance(spokenReply);
  } catch (err) {
    console.error("[Relagent] LLM execution error:", err);
    spokenReply =
      "I understand. Let me help you with that right away. Could you please share your full name as it appears on your ID?";
  }

  // ── Phase 6: Instant Human Escalation ─────────────────────────────────────
  if (isHumanEscalationRequested(userText)) {
    spokenReply =
      "I'd be glad to connect you with one of our team members right away. Please hold while I transfer your call.";
    updatedSession.state = "ESCALATED";

    saveConversationRecord({
      sessionId: updatedSession.sessionId,
      ticketId: updatedSession.ticketId || undefined,
      customerName: updatedSession.lead.name?.value || undefined,
      customerPhone: updatedSession.lead.phone?.value || undefined,
      sentimentTag: updatedSession.moodDiagnostics.sentimentTag,
      whyCustomerIsUpset:
        updatedSession.moodDiagnostics.whyCustomerIsUpset ||
        "Customer requested immediate live human transfer.",
      situationContextNotes:
        (updatedSession.moodDiagnostics.situationContextNotes ||
          "Caller requested to speak with a human representative.") +
        " [Transferred to live agent upon request]",
      recommendedNextAction:
        "Immediate human representative answer / priority callback.",
      isEmergency: Boolean(updatedSession.safety?.status === "CRITICAL"),
      escalatedToHuman: true,
      fullTranscript: updatedSession.conversationHistory
        .map((h) => `${h.role}: ${h.content}`)
        .join("\n"),
    }).catch(console.error);

    // Append assistant turn
    updatedSession.conversationHistory.push({
      role: "REGENT",
      content: spokenReply,
    });

    return {
      response: spokenReply,
      session: updatedSession,
      shouldTransfer: true,
      complete: true,
      state: "ESCALATED",
      missingFields: updatedSession.missingFields,
      safety: { status: "NORMAL", category: null, confidence: 1.0 },
      currentAction: "HANDLE_HUMAN_REQUEST",
      targetField: null,
      diagnosticReason: "Phase 6: Instant Human Escalation Triggered",
    };
  }

  // ── Phase 8: Emergency Protocol ───────────────────────────────────────────
  const emergencyCheck = checkEmergencySafety(userText);
  if (emergencyCheck.isEmergency) {
    updatedSession.safety = {
      status: "CRITICAL",
      category: emergencyCheck.emergencyType as any,
      confidence: 1.0,
    };
    if (
      !spokenReply.toLowerCase().includes("evacuate") &&
      !spokenReply.toLowerCase().includes("shut off") &&
      !spokenReply.toLowerCase().includes("shutoff") &&
      !spokenReply.toLowerCase().includes("911")
    ) {
      spokenReply = `${emergencyCheck.safetyInstruction}\n\nI am treating this as a high-priority emergency. What is your address and phone number so our emergency dispatch team can arrive right away?`;
    }
  }

  // ── Phase 7: Abuse Handling Protocol (2-Strike Rule) ─────────────────────
  if (checkAbuse(userText)) {
    updatedSession.abuseCount += 1;
    if (updatedSession.abuseCount === 1) {
      // Strike 1: Polite Warning
      spokenReply =
        "I understand you may be frustrated, but I kindly ask that you please refrain from using that kind of language so I can assist you. How can I help with your home service today?";
    } else {
      // Strike 2: Disconnect
      spokenReply =
        "Since the inappropriate language has continued, I am going to disconnect this call. You may reach out again when you're ready to communicate respectfully. Goodbye.";
      updatedSession.state = "CLOSED";

      saveConversationRecord({
        sessionId: updatedSession.sessionId,
        ticketId: updatedSession.ticketId || undefined,
        customerName: updatedSession.lead.name?.value || undefined,
        customerPhone: updatedSession.lead.phone?.value || undefined,
        sentimentTag: "angry",
        whyCustomerIsUpset:
          "Caller used abusive language and was terminated after warning.",
        situationContextNotes:
          "Call disconnected after repeated abusive language.",
        recommendedNextAction: "Flag phone number for abusive behavior.",
        isEmergency: false,
        escalatedToHuman: false,
        fullTranscript: updatedSession.conversationHistory
          .map((h) => `${h.role}: ${h.content}`)
          .join("\n"),
      }).catch(console.error);

      updatedSession.conversationHistory.push({
        role: "REGENT",
        content: spokenReply,
      });

      return {
        response: spokenReply,
        session: updatedSession,
        shouldTransfer: false,
        complete: true,
        state: "CLOSED",
        missingFields: updatedSession.missingFields,
        safety: { status: "NORMAL", category: null, confidence: 1.0 },
        currentAction: "CLOSE_CALL",
        targetField: null,
        diagnosticReason: "Phase 7: Call Disconnected Due to Repeated Abuse",
      };
    }
  }

  // ── Phase 7: Out-of-Scope Handling Protocol ────────────────────────────────
  const scopeCheck = checkOutOfScope(userText);
  if (scopeCheck.isOutOfScope && updatedSession.state === "COLLECTING") {
    updatedSession.offTopicCount += 1;
    spokenReply = `While I can't assist with ${scopeCheck.topic}, I'd be more than happy to help you with any heating, cooling, plumbing, or electrical issues for your property. How can I help with your service today?`;
  }

  // Check and mark recording disclosure
  if (
    !updatedSession.recordingDisclosureGiven &&
    (spokenReply.toLowerCase().includes("record") ||
      spokenReply.toLowerCase().includes("training"))
  ) {
    updatedSession.recordingDisclosureGiven = true;
  } else if (
    !updatedSession.recordingDisclosureGiven &&
    updatedSession.turnCount === 1
  ) {
    // Natural fallback guarantee if LLM did not include consent in Turn 1
    spokenReply +=
      " Just so you know, this call is recorded for quality and training purposes.";
    updatedSession.recordingDisclosureGiven = true;
  }

  const allFieldsValid = Boolean(
    updatedSession.lead.name?.status === "VALID" &&
      updatedSession.lead.phone?.status === "VALID" &&
      updatedSession.lead.address?.status === "VALID" &&
      updatedSession.lead.problem?.status === "VALID" &&
      updatedSession.lead.timing?.status === "VALID"
  );

  let isCallComplete = false;

  // ── 4. Phase 4: Confirmation, Ticket Generation & Wrap-up ──────────────────
  if (updatedSession.ticketId) {
    // Ticket was already generated. Check if user is saying no/closing the call
    const isCloseUtterance =
      /^(no|no thanks|nope|that's all|that is all|nothing else|nothing|all good|thanks bye|bye|goodbye)/i.test(
        userText.trim()
      ) ||
      userText.toLowerCase().includes("that's all") ||
      userText.toLowerCase().includes("nothing else");

    if (isCloseUtterance) {
      updatedSession.state = "CLOSED";
      isCallComplete = true;
      spokenReply = `Thank you for calling ${businessName}! We look forward to helping you. Have a wonderful day!`;

      // Persist full conversation record with mood diagnostics to Supabase (Phase 5)
      saveConversationRecord({
        sessionId: updatedSession.sessionId,
        ticketId: updatedSession.ticketId || undefined,
        customerName: updatedSession.lead.name?.value || undefined,
        customerPhone: updatedSession.lead.phone?.value || undefined,
        sentimentTag: updatedSession.moodDiagnostics.sentimentTag,
        whyCustomerIsUpset: updatedSession.moodDiagnostics.whyCustomerIsUpset,
        situationContextNotes:
          updatedSession.moodDiagnostics.situationContextNotes,
        recommendedNextAction:
          updatedSession.moodDiagnostics.recommendedNextAction,
        isEmergency: Boolean(updatedSession.safety?.status === "CRITICAL"),
        escalatedToHuman: false,
        fullTranscript: updatedSession.conversationHistory
          .map((h) => `${h.role}: ${h.content}`)
          .join("\n"),
      }).catch(console.error);
    }
  } else if (allFieldsValid) {
    if (session.state !== "READY_FOR_CONFIRMATION") {
      // Transition to confirmation state
      updatedSession.state = "READY_FOR_CONFIRMATION";
      if (
        !spokenReply
          .toLowerCase()
          .includes("does that look correct, or do you need to change anything")
      ) {
        if (!spokenReply.toLowerCase().includes("does that look correct")) {
          spokenReply +=
            "\n\nDoes that look correct, or do you need to change anything?";
        }
      }
    } else {
      // Already in confirmation state - check user reply
      const isConfirm =
        /^(yes|yeah|yep|correct|that's correct|looks good|sounds good|perfect|all set|confirmed|right|that looks correct|it looks good|no changes|everything looks good)/i.test(
          userText.trim()
        ) ||
        userText.toLowerCase().includes("looks correct") ||
        userText.toLowerCase().includes("looks good") ||
        userText.toLowerCase().includes("that's right") ||
        userText.toLowerCase().includes("that's correct");

      const isChange =
        !isConfirm &&
        (userText.toLowerCase().includes("change") ||
          userText.toLowerCase().includes("actually") ||
          userText.toLowerCase().includes("instead") ||
          userText.toLowerCase().includes("wrong") ||
          userText.toLowerCase().includes("different") ||
          userText.toLowerCase().includes("make it"));

      if (isConfirm) {
        const ticketId = generateTicketId(referenceDate);
        updatedSession.ticketId = ticketId;
        updatedSession.state = "CONFIRMED";

        const ticketPayload = {
          customerName: updatedSession.lead.name?.value || "",
          customerPhone: updatedSession.lead.phone?.value || "",
          serviceAddress: updatedSession.lead.address?.value || "",
          trade: updatedSession.trade || "HVAC",
          issueDescription: updatedSession.lead.problem?.value || "",
          preferredSchedule: updatedSession.lead.timing?.value || "",
          sessionId: updatedSession.sessionId,
        };

        // Trigger webhook & save to DB in background
        triggerNotificationWebhook(ticketId, ticketPayload).catch(console.error);
        saveConfirmedTicket(ticketId, ticketPayload).catch(console.error);
        saveConversationRecord({
          sessionId: updatedSession.sessionId,
          ticketId: ticketId,
          customerName: updatedSession.lead.name?.value || undefined,
          customerPhone: updatedSession.lead.phone?.value || undefined,
          sentimentTag: updatedSession.moodDiagnostics.sentimentTag,
          whyCustomerIsUpset: updatedSession.moodDiagnostics.whyCustomerIsUpset,
          situationContextNotes:
            updatedSession.moodDiagnostics.situationContextNotes,
          recommendedNextAction:
            updatedSession.moodDiagnostics.recommendedNextAction,
          isEmergency: Boolean(updatedSession.safety?.status === "CRITICAL"),
          escalatedToHuman: false,
          fullTranscript: updatedSession.conversationHistory
            .map((h) => `${h.role}: ${h.content}`)
            .join("\n"),
        }).catch(console.error);

        spokenReply = `You're all set! Your service ticket ID is ${ticketId}. Our team has received your request and will arrive as scheduled. Is there anything else I can help you with today?`;
      } else if (isChange) {
        const currentChanges = updatedSession.corrections?.length || 0;
        if (currentChanges < 2) {
          updatedSession.corrections.push({
            field: "CUSTOMER_CHANGE",
            oldValue: null,
            newValue: userText,
            turn: updatedSession.turnCount,
          });

          if (
            !spokenReply.toLowerCase().includes("does that look correct")
          ) {
            spokenReply +=
              "\n\nDoes that look correct, or do you need to change anything?";
          }
        } else {
          // Max 2 changes reached -> Lock in and create ticket
          const ticketId = generateTicketId(referenceDate);
          updatedSession.ticketId = ticketId;
          updatedSession.state = "CONFIRMED";

          const ticketPayload = {
            customerName: updatedSession.lead.name?.value || "",
            customerPhone: updatedSession.lead.phone?.value || "",
            serviceAddress: updatedSession.lead.address?.value || "",
            trade: updatedSession.trade || "HVAC",
            issueDescription: updatedSession.lead.problem?.value || "",
            preferredSchedule: updatedSession.lead.timing?.value || "",
            sessionId: updatedSession.sessionId,
          };

          triggerNotificationWebhook(ticketId, ticketPayload).catch(console.error);
          saveConfirmedTicket(ticketId, ticketPayload).catch(console.error);
          saveConversationRecord({
            sessionId: updatedSession.sessionId,
            ticketId: ticketId,
            customerName: updatedSession.lead.name?.value || undefined,
            customerPhone: updatedSession.lead.phone?.value || undefined,
            sentimentTag: updatedSession.moodDiagnostics.sentimentTag,
            whyCustomerIsUpset: updatedSession.moodDiagnostics.whyCustomerIsUpset,
            situationContextNotes:
              updatedSession.moodDiagnostics.situationContextNotes,
            recommendedNextAction:
              updatedSession.moodDiagnostics.recommendedNextAction,
            isEmergency: Boolean(updatedSession.safety?.status === "CRITICAL"),
            escalatedToHuman: false,
            fullTranscript: updatedSession.conversationHistory
              .map((h) => `${h.role}: ${h.content}`)
              .join("\n"),
          }).catch(console.error);

          spokenReply = `I've updated that for you. Since we've made a couple of adjustments, I will lock this in now with your ticket ID ${ticketId}, and our team will verify any final details when they call to confirm. Is there anything else I can help you with today?`;
        }
      }
    }
  }

  // Append assistant turn to history
  updatedSession.conversationHistory.push({
    role: "REGENT",
    content: spokenReply,
  });

  const missing: string[] = [];
  if (!updatedSession.lead.name?.value) missing.push("name");
  if (
    !updatedSession.lead.phone?.value ||
    updatedSession.lead.phone.status !== "VALID"
  )
    missing.push("phone");
  if (
    !updatedSession.lead.address?.value ||
    updatedSession.lead.address.status !== "VALID"
  )
    missing.push("address");
  if (!updatedSession.lead.problem?.value) missing.push("problem");
  if (
    !updatedSession.lead.timing?.value ||
    updatedSession.lead.timing.status !== "VALID"
  )
    missing.push("timing");
  updatedSession.missingFields = missing;

  return {
    response: spokenReply,
    session: updatedSession,
    shouldTransfer: false,
    complete: isCallComplete,
    state: updatedSession.state,
    missingFields: missing,
    safety: { status: "NORMAL", category: null, confidence: 1.0 },
    currentAction:
      updatedSession.state === "CONFIRMED"
        ? "CREATE_TICKET"
        : updatedSession.state === "CLOSED"
        ? "CLOSE_CALL"
        : "CAPTURE_INFORMATION",
    targetField: missing[0] || null,
    diagnosticReason: `Phase 4: Turn Processed (State: ${updatedSession.state}, Ticket: ${
      updatedSession.ticketId || "none"
    })`,
  };
}
