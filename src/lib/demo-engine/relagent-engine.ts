import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import {
  ConversationSession,
  EngineRequest,
  EngineResponse,
  Trade,
  SentimentState,
  CallerStyle,
} from "./types";
import {
  resolveDateTime,
  DateResolutionResult,
  resolveArrivalWindow,
  isWithinOperatingHours,
  checkOutsideOperatingHours,
  getAvailableSlotsForDate,
  STANDARD_ARRIVAL_WINDOWS,
} from "./date-resolver";
import {
  generateTicketId,
  triggerNotificationWebhook,
  commitCallConclusion,
  getTenantProfile,
  TenantProfile,
  disconnectAndBlockCaller,
  upsertCustomer,
  lookupCustomer,
} from "./ticket-service";
import { analyzeCustomerMood, MoodDiagnosticResult } from "./mood-resolver";
import {
  checkAbuse,
  checkOutOfScope,
  checkEmergencySafety,
  getAfterHoursGreeting,
  getOutOfScopeStrikeResponse,
} from "./safety-policy";
import {
  canonicalizeService,
  canonicalizeRequestType,
  inferTrade,
} from "./controller/service-canonicalizer";

export interface ExtractedEntities {
  full_name?: string | null;
  phone_number?: string | null;
  phone_digits?: string | null;
  phone?: string | null;
  area_code?: string | null;
  street?: string | null;
  city?: string | null;
  zip?: string | null;
  address?: string | null;
  issue_description?: string | null;
  request_type?: string | null;
  service?: string | null;
  urgency?: string | null;
  date_time_preference?: string | null;
  arrival_window?: string | null;
  sentiment_tag?: "angry" | "happy" | "neutral" | null;
  why_customer_is_upset?: string | null;
  situation_context_notes?: string | null;
  recommended_next_action?: string | null;
  sentiment_state?: "empathetic" | "urgent" | "calm" | "warm" | null;
  caller_style?: "rushed" | "elderly_confused" | "angry_frustrated" | "neutral" | null;
  customer_status?: "New Customer" | "Existing Customer" | string | null;
  priority?: "Normal" | "Urgent" | "Emergency (Life/Safety)" | string | null;
  context_summary?: string | null;
}

/**
 * Converts a 10-digit phone number to naturally grouped spoken digits.
 * "1234567890" → "1 2 3, 4 5 6, 7 8 9 0"
 * Digits are grouped in standard 3-3-4 rhythm so ElevenLabs TTS speaks them naturally
 * with natural pauses between blocks, rather than 10 disjointed single-digit pauses.
 */
export function formatPhoneForVoice(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return phone; // Not a full number, return as-is
  const g1 = digits.slice(0, 3).split("").map((d) => (d === "0" ? "zero" : d)).join(" ");
  const g2 = digits.slice(3, 6).split("").map((d) => (d === "0" ? "zero" : d)).join(" ");
  const g3 = digits.slice(6).split("").map((d) => (d === "0" ? "zero" : d)).join(" ");
  return `${g1}, ${g2}, ${g3}`;
}

/**
 * Converts an internal timing value to a natural spoken phrase.
 *
 * "2026-09-12 (02:00 PM - 05:00 PM)" on today    → "today, between 2 and 5 in the afternoon"
 * "2026-09-13 (09:00 AM - 12:00 PM)" (tomorrow)  → "tomorrow morning, between 9 and noon"
 * "2026-09-14 (04:00 PM - 07:00 PM)"             → "Monday, the fourteenth, between 4 and 7 in the evening"
 *
 * Rules:
 * - If the date is today     → "today"
 * - If the date is tomorrow  → "tomorrow"
 * - If the date is in 2 days → "the day after tomorrow"
 * - Otherwise               → weekday + spoken date  (e.g. "Monday, September 14th")
 * - Time range:
 *     AM window  → "between X and Y in the morning"
 *     09:00-12   → "between 9 and noon"
 *     16:00+     → "between X and Y in the evening"
 *     PM window  → "between X and Y in the afternoon"
 */
export function formatTimingForVoice(timingValue: string, referenceDate: Date = new Date()): string {
  if (!timingValue || timingValue === "Missing") return "a time we'll confirm";

  // Extract ISO date and window
  const dateMatch = timingValue.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const windowMatch = timingValue.match(/(\d{2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{2}):(\d{2})\s*(AM|PM)/i);

  // Build relative day label
  let dayLabel = "";
  if (dateMatch) {
    const [y, m, d] = dateMatch[1].split("-").map(Number);
    const targetUTC = Date.UTC(y, m - 1, d);
    const todayUTC = Date.UTC(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate()
    );
    const diffDays = Math.round((targetUTC - todayUTC) / 86400000);
    if (diffDays === 0) dayLabel = "today";
    else if (diffDays === 1) dayLabel = "tomorrow";
    else if (diffDays === 2) dayLabel = "the day after tomorrow";
    else {
      const fmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
      dayLabel = fmt.format(new Date(targetUTC));
    }
  }

  // Build time range label
  let timeLabel = "";
  if (windowMatch) {
    const startHour = parseInt(windowMatch[1], 10);
    const endHour = parseInt(windowMatch[4], 10);
    const period = windowMatch[6].toUpperCase();
    const isPM = period === "PM";

    const startStr = startHour === 12 ? "noon" : String(startHour);
    let endStr: string;
    if (endHour === 12 && period === "PM") endStr = "noon";
    else endStr = String(endHour);

    if (!isPM) {
      timeLabel = `between ${startStr} and ${endStr} in the morning`;
    } else {
      if (endStr === "noon") timeLabel = `between ${startStr} and noon`;
      else if (startHour >= 4) timeLabel = `between ${startStr} and ${endStr} in the evening`;
      else timeLabel = `between ${startStr} and ${endStr} in the afternoon`;
    }
  }

  if (dayLabel && timeLabel) return `${dayLabel}, ${timeLabel}`;
  if (dayLabel) return dayLabel;
  if (timeLabel) return timeLabel;
  return timingValue; // Fallback: return raw value
}

export function getMasterSystemPrompt(
  tenant: TenantProfile,
  businessName: string,
  aiAgentName: string,
  referenceDate: Date,
  session?: ConversationSession
): string {
  const tenantTz = tenant.timezone || "America/New_York";
  const dayOfWeek = new Intl.DateTimeFormat("en-US", {
    timeZone: tenantTz,
    weekday: "long",
  }).format(referenceDate);
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: tenantTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(referenceDate);
  const timeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tenantTz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(referenceDate);

  const coveredZips =
    tenant.coveredZipCodes && tenant.coveredZipCodes.length > 0
      ? tenant.coveredZipCodes.join(", ")
      : "75001, 75002, 75201, 75202, 75204, 76101, 76102, 78701, 78702, 78703, 78704, 78705";

  const nameVal = session?.lead.name?.value || "Missing";
  const firstName = nameVal !== "Missing" ? nameVal.trim().split(/\s+/)[0] : "";
  const phoneVal = session?.lead.phone?.value || "Missing";
  const addressVal = session?.lead.address?.value || "Missing";
  const issueVal = session?.lead.problem?.value || "Missing";
  const dateTimeVal = session?.lead.timing?.value || "Missing";

  // Parse current address to determine how complete it is (street+city vs. ZIP)
  const existingAddrParts = addressVal !== "Missing" ? parseAddressString(addressVal) : {};
  const hasStreetOrCity = Boolean(existingAddrParts.street || existingAddrParts.city);
  const hasZip = Boolean(existingAddrParts.zip);

  // ── MASTER SPEC: Collection order → Issue → Name → Phone → Street+City → ZIP → Schedule ──
  let currentObjectiveInstruction = "";

  // State 2a: Issue not yet collected — ask for issue first, empathize before asking name
  if (!session?.lead.problem?.value) {
    currentObjectiveInstruction = "[SYSTEM: The ONLY thing you need to ask for right now is the Issue or Service need. React empathetically first to what they say, then ask. Do not ask for anything else.]";

  // State 2b: Issue known, name completely missing — empathize + ask for full name
  } else if (!session?.lead.name?.value || session.lead.name.status === "MISSING") {
    const knownIssue = issueVal !== "Missing" ? issueVal : "that issue";
    currentObjectiveInstruction = `[SYSTEM: The customer told you their problem ('${knownIssue}'). You MUST briefly empathize (e.g. "I'm sorry to hear your ${knownIssue} is acting up. We can definitely help with that.") then ask ONLY for their FULL NAME — first AND last — in one question: "What is your first and last name?" Do NOT ask for phone, address, or anything else yet. One question only.]`;

  // State 2c: Have partial name (first only) — ask ONLY for last name
  } else if (
    session?.lead.name?.value &&
    session.lead.name.status !== "VALID" &&
    session.lead.name.status !== "CONFIRMED" &&
    session.lead.name.status !== "CORRECTED"
  ) {
    currentObjectiveInstruction = `[SYSTEM: You have the first name '${session.lead.name.value}'. The ONLY thing you need to ask for right now is their Last Name. Ask: "And your last name?" Do not ask for anything else.]`;

  // State 3: Name confirmed, phone not yet collected — ask for best callback number
  } else if (!session?.lead.phone?.value || session.lead.phone.status !== "VALID") {
    currentObjectiveInstruction = `[SYSTEM: ${firstName ? `Address ${firstName} by name (e.g., "Thanks, ${firstName} — "). ` : ""}The ONLY thing you need to ask for right now is their best callback phone number (10 digits). Use this exact prompt: "What is the best phone number to reach you at?" Do NOT ask for address or anything else yet.]`;

  // State 4: Phone confirmed, address (street + city) not yet collected — ask ONLY for street + city, NOT zip yet
  } else if (!session?.lead.address?.value || session.lead.address.status === "MISSING") {
    currentObjectiveInstruction = `[SYSTEM: ${firstName ? `Address ${firstName} by name (e.g., "Got it, ${firstName} — "). ` : ""}The ONLY thing you need to ask for right now is the STREET ADDRESS and CITY. If the customer preemptively provides their ZIP code alongside the street address, you MUST accept it immediately and not ask for it again. Say: "And what is the street address and city for the service?" Stop after this one question.]`;

  // State 5: Have street+city but ZIP is missing — ask ONLY for ZIP, then validate service area
  } else if (hasStreetOrCity && !hasZip && session.lead.address.status !== "VALID") {
    currentObjectiveInstruction = `[SYSTEM: The customer has given street/city info ('${addressVal}') without a ZIP code. The ONLY thing you need to ask for right now is the 5-digit ZIP code. Ask: "And what is the ZIP code there?" Once you receive the ZIP, check it against our covered zip codes (${coveredZips}). If the ZIP IS in our covered list → say "Great, you are right in our service area." and move to scheduling. If the ZIP is NOT covered → say exactly: "I'm really sorry, but [ZIP] is outside of our current service area. We cannot schedule service there." Then offer to end the call or transfer to a manager. Do NOT ask for another ZIP unless the customer explicitly says they misspoke.]`;

  // State 5 (fallback): Address captured but still not VALID — check if zip is actually missing or if out of area
  } else if (
    session?.lead.address?.value &&
    session.lead.address.status !== "VALID" &&
    session.lead.address.status !== "CONFIRMED" &&
    session.lead.address.status !== "CORRECTED"
  ) {
    if (!hasZip) {
      currentObjectiveInstruction = `[SYSTEM: ${firstName ? `Address ${firstName} by name. ` : ""}The address '${addressVal}' is missing the 5-digit ZIP code. Ask ONLY: "And what is the ZIP code there?" Do not ask for anything else.]`;
    } else {
      const isZipCovered = !existingAddrParts.zip || !tenant.coveredZipCodes || tenant.coveredZipCodes.length === 0 || tenant.coveredZipCodes.includes(existingAddrParts.zip);
      if (!isZipCovered) {
        currentObjectiveInstruction = `[SYSTEM: The customer provided ZIP code ${existingAddrParts.zip}, which is outside our covered service area (${coveredZips}). Say: "I'm really sorry, but ${existingAddrParts.zip} is outside of our current service area. We cannot schedule service there." Then offer to end the call or transfer to a manager.]`;
      } else {
        currentObjectiveInstruction = `[SYSTEM: ${firstName ? `Address ${firstName} by name. ` : ""}The address and ZIP (${addressVal}) are validated and accepted. The ONLY thing to ask for right now is their preferred day and arrival window (morning, afternoon, or evening).]`;
      }
    }
  // State 6: Address valid, timing not yet collected — ask for scheduling preference
  } else if (!session?.lead.timing?.value || session.lead.timing.status !== "VALID") {
    if (session?.lead.timing?.status === "CAPTURED" && session.lead.timing.validationReason) {
      currentObjectiveInstruction = `[SYSTEM: ${firstName ? `Address ${firstName} by name. ` : ""}The customer provided a date but NOT the arrival window. Ask their arrival window preference: morning (between 9 and noon), afternoon (between 1 and 4), or evening (between 4 and 7). Do NOT read back confirmation yet.]`;
    } else if (session?.lead.timing?.status === "AMBIGUOUS" && session.lead.timing.validationReason) {
      currentObjectiveInstruction = `[SYSTEM: Date/time is ambiguous. Prompt customer: "${session.lead.timing.validationReason}". Do NOT ask for anything else.]`;
    } else {
      currentObjectiveInstruction = `[SYSTEM: ${firstName ? `Address ${firstName} by name (e.g., "Great, ${firstName} — "). ` : ""}The ONLY thing you need to ask for right now is their day and window preference (morning, afternoon, or evening). Ask: "What day works best for you, and do you prefer morning, afternoon, or evening? We have availability today or tomorrow." Stop after this one question.]`;
    }

  // Confirmation gate: All 5 fields collected but not yet confirmed by customer
  } else if (session?.state !== "CONFIRMED") {
    const cleanName = (nameVal || "")
      .replace(/\b(?:and\s+)?(?:my\s+)?(?:location|address|phone|number|cell|zip|city|i\s+live)\b.*$/i, "")
      .replace(/^(?:uh|um|er)\s+/i, "")
      .trim();
    const cleanAddress = (addressVal || "")
      .replace(/\b(?:uh|um)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const phoneSpoken = formatPhoneForVoice(phoneVal);
    const timingSpoken = formatTimingForVoice(dateTimeVal, referenceDate);
    const cleanIssue = (issueVal !== "Missing" ? issueVal : "service")
      .toLowerCase()
      .replace(/^(?:a\s+|an\s+)/, "")
      .trim();

    currentObjectiveInstruction = `[SYSTEM: ALL 5 booking fields are now collected. You MUST now read back the summary in NATURAL SPOKEN LANGUAGE only — NO lists, NO bullet points, NO markdown, NO bold. Speak it cleanly and appropriately according to each field of input, exactly as you would say it on a phone call. Use THIS phrasing:\n\n"Alright, ${firstName || "there"}, let me confirm everything with you: I have your name down as ${cleanName}, phone number ${phoneSpoken}, service address ${cleanAddress}, for your ${cleanIssue}, scheduled for ${timingSpoken}. Does that all sound right to you, or would you like to change anything?"\n\nWait for the customer to say YES or confirm before proceeding. You are FORBIDDEN from generating a ticket or calling end_call() until the customer explicitly confirms.]`;

  // Wrap-up: Customer has confirmed — generate ticket and close
  } else {
    const ticketId = session?.ticketId || "[TICKET_ID_FROM_SYSTEM]";
    const spokenTicket = ticketId.replace(/-/g, " ");
    currentObjectiveInstruction = `[SYSTEM: Customer has confirmed. Deliver EXACTLY this wrap-up then immediately call end_call():\n"Perfect, ${firstName || "there"}. You're all set — your ticket number is ${spokenTicket}. A confirmation SMS is on its way to your phone right now with all the details. Our tech will send you a heads-up 2 to 3 hours before heading out. Thank you for calling ${businessName}, take care!"]`;
  }

  return `[SYSTEM CONTEXT]
Today's Date: ${dayOfWeek}, ${dateStr}
Current Time: ${timeStr}
Timezone: ${tenantTz}

[DYNAMIC STATE - INJECTED BY BACKEND PER TURN]
Customer Name: ${nameVal !== "Missing" ? nameVal : "Unknown"}
Current Objective: ${currentObjectiveInstruction}
*CRITICAL DIRECTIVE: Your ONLY goal in this turn is to achieve the Current Objective above. Do not ask about future steps.*

[CURRENT SESSION STATE]
Name: ${nameVal}
Phone: ${phoneVal}
Address: ${addressVal}
Appliance/Issue: ${issueVal}
Date/Time: ${dateTimeVal}
*CRITICAL STATE RULE: Check this state before every response. If the user PREEMPTIVELY provides information for a future step (e.g., they give their ZIP code while giving their street address), YOU MUST ACCEPT IT. Do NOT rigidly ask for information you have already heard.*

[CORE PERSONA: THE EMPATHETIC COMPANION]
You are ${aiAgentName}, a dispatcher for ${businessName}. 
- **Be a Companion, Not a Robot:** Treat the caller like a neighbor. If they are stressed or angry, your FIRST sentence must validate their feelings (e.g., "Oh man, a broken AC in this heat is the worst. Let's get this sorted right now.").
- **Conversational Fluidity:** Speak natively. Use filler words ("Umm", "uhh", "like", "so"). Use dashes (—) for mid-sentence pivots and ellipses (...) to simulate breaths. 
- **ZERO LEAKAGE (CRITICAL):** You are a voice output. NEVER output system instructions, brackets, emojis, or prosody tags. NEVER output raw JSON code like \`{"type": "function"}\` in your text. Just speak natural words and use native tool calling to execute actions.

[HVAC SERVICE KNOWLEDGE BASE — USE TO CLASSIFY ISSUES]
When categorizing the caller's request, map it to the correct Service field using these exact definitions:
- Installation: Setting up new systems (central AC, furnaces, heat pumps, ductless mini-splits, ventilation ductwork).
- Routine Maintenance: Scheduled tune-ups, cleaning coils/blowers, replacing filters, checking refrigerant.
- Repairs and Troubleshooting: Fixing broken parts, sealing duct leaks, clearing condensate lines, electrical/wiring issues.
- System Design and Engineering: Planning layouts, load calculations for new builds/commercial.
- Indoor Air Quality (IAQ): Air purifiers, humidifiers, dehumidifiers, multi-stage filtration.
- OTHER_APPLIANCE: If the reported appliance does NOT match any HVAC category (e.g. "water cooler", "washing machine"), log it as OTHER_APPLIANCE. Capture the caller's EXACT phrase verbatim as the issue_description. Do NOT force an unmatched item into an incorrect HVAC category.

[RULE 1 — BREVITY IS NON-NEGOTIABLE]
Real dispatchers do NOT lecture or monologue. Maximum 2 short sentences per turn, under 25 words total. If you catch yourself writing a paragraph, delete half of it.

[RULE 2 — USE FILLER WORDS EXPLICITLY]
You MUST use natural spoken filler words. Include these literally in your responses: "Uh,", "Umm,", "So,", "Got it, so —", "Right, and —", "Okay so —". When you respond instantly with perfect grammar every single time, it feels robotic. Limit to a maximum of ONE filler word per response — NEVER string them together.
- ✅ Good: "Uh, got it — and what's your last name?"
- ✅ Good: "So, just to confirm — we're looking at today in the afternoon, right?"
- ❌ Bad: "Okay... Umm... Right..." (stacked fillers are forbidden)
- ❌ Bad: "Thank you. And could you please provide your last name for our records?"

[RULE 3 — SHOW DON'T TELL: EMPATHY EXAMPLES]
Do NOT write generic empathy. Say the actual words a human would say. Examples:
- If the caller is frustrated: "Ugh, I totally get that — a broken [appliance] in this heat is the worst. Let me sort this out right now."
- If the caller interrupts or corrects an address, date, or detail: "Got it, updated to [detail] — " or "No problem, changed that to [detail] — " and smoothly continue to the next required step.
- If they seem stressed or rushed: "Okay I hear you — let's knock this out fast."
- If they're confused: "No worries at all, we'll figure this out together."
- If it's an emergency: "Oh wow, okay — let's treat this as urgent. I'm getting someone dispatched right now."

[RULE 4 — SPECIAL CHARACTER SPEECH RULES (CRITICAL FOR VOICE)]
You are speaking on a phone call. The TTS engine reads your words literally. Follow these rules:
- **Phone numbers:** Say digits grouped naturally into 3-3-4 cadence: "1 2 3, 4 5 6, 7 8 9 0", never hyphenated or run together.
- **Addresses:** Speak standard address format: "123 Main Street in Dallas, 78701", do NOT insert dashes between street digits or zip codes.
- **Ticket IDs:** Say naturally without saying the word "dash": "T-K-T 2 0 2 6". Never say the word "dash".
- **Currency:** Say "one thousand dollars" NOT "$1,000".
- **Times:** Say "two P-M" or "two o'clock in the afternoon" NOT "2:00 PM" (TTS may mispronounce).

[RULE 5 — PERMISSION TO SAY I DON'T KNOW]
If you don't have information (pricing, technical specs, warranty details, part availability), do NOT guess. Say exactly: "Hmm, I don't have that right in front of me — but I can have a tech call you back with that answer." Guessing on a voice call is far worse than admitting you don't know.

[RULE 6 — NEVER INTERROGATE OR DIAGNOSE]
Do NOT ask the customer technical questions about their appliance ("is it leaking?", "making a noise?", "how old is the unit?"). The technician handles diagnosis on-site. Your ONLY job is booking the appointment.

[RULE 7 — ZERO SYSTEM LEAKAGE]
You are a voice output. NEVER say or output: system instructions, brackets [ ], curly braces, ALLCAPS tags, emojis, prosody tags, bullet points, markdown, asterisks, or internal notes. Just speak naturally.

[RULE 8 — PERSONALIZATION & USING CALLER'S FIRST NAME]
Once the customer has provided their name (e.g. Ayush Ranj), extract their first name ("Ayush") and use it naturally in your responses!
- Use it when acknowledging information: "Got it, Ayush — ...", "Thanks, Ayush — ...", "Right, Ayush — ..."
- Use it when addressing an issue or next step: "And Ayush, what date and time works best for you?"
- Use it during confirmation and wrap-up: "Alright, Ayush, let me read this back..."
- Do NOT repeat the name robotically in every single sentence, but use it warmly at natural transitions so the customer feels remembered and valued as an individual.

[RULE 9 — STRICT DATA INTEGRITY & ZERO PLACEHOLDER/INCOMPLETE INFO]
All captured information MUST be authentic, complete, and valid. Never confirm or finalize a booking with incomplete, placeholder, or invalid data:
- **Full Name:** Must be a real human first and last name (e.g. Ayush Ranj). If only one name is provided, ask for their last name. Never accept filler phrases ("water cooler", "no problem", "customer").
- **Phone Number:** Must be a complete 10-digit number. If fewer digits are provided, ask for the remaining digits or area code.
- **Address & ZIP Code:** Must be a complete physical address with street number, street name, city, and a 5-digit ZIP code. The ZIP MUST be within our covered service area: ${coveredZips}. If out-of-area, politely inform the caller we cannot schedule service there.
- **Issue Description:** Must describe a real issue with their equipment (e.g. "water cooler not dispensing water"). Capture the caller's EXACT phrase verbatim — do NOT paraphrase.
- **Date & Arrival Window:** Must be an agreed date and standard arrival window (Morning 9 AM - 12 PM or Afternoon 1 PM - 5 PM).

[STRICT EXTRACTION WORKFLOW]
Collect details ONE AT A TIME. DO NOT ask multiple questions at once.
1. **Accurate Appliance Capture:** If they say "Water Cooler", note it exactly as a Water Cooler.
2. **Full Name:** You MUST capture First AND Last name. 
3. **10-Digit Phone Number:** Ask for missing digits if incomplete.
4. **Full Address & ZIP:** If they provide the street and city, ask for the ZIP. If they provide the ZIP alongside the street, DO NOT ask for the ZIP again. Proceed immediately to validate the ZIP.
5. **Date & Time (STRICT ALGORITHM):** NEVER blindly accept "today". You MUST compare their request to the \`Current Time\` in the \`[SYSTEM CONTEXT]\`.
   - If a slot has passed, you MUST say: for example: "Since it's a bit late in the day, our schedule is booked up. The next available slot is tomorrow morning. Does that work for you?" or the next immediate slot available and along with time also ask for date as well if the date stated is today's date ot tomorrow or day after tomorrow as per curren't day then mention like today, tomorrow or day after tomorrow based on that particular day when call is happening only mention date if it's not among all three mentioned  

[THE CONFIRMATION GATE & WRAP-UP (CRITICAL SEQUENCE)]
You are strictly forbidden from finalizing a ticket until you complete these steps IN THIS EXACT ORDER:
1. **The Read-Back:** Once ALL 5 fields are collected, you MUST say: *"Got it! Let me make sure I have this all correct: I have [Name] at [Address], phone number [Phone], for a [Appliance/Issue] on [Date/Time]. Does that look correct?"*
2. **The Finalize Tool:** Wait for the user to say "Yes". DO NOT say goodbye yet. Immediately trigger the \`finalize_booking\` tool via native function calling. 
3. **The Ticket Script:** Wait for the tool to return the \`ticket_id\`. You MUST then read this exact script: *"Perfect. Your appointment is confirmed under Ticket #[ticket_id]. I've just triggered a confirmation text to your phone, and our team will text you 2 hours before arrival to ensure you're home. Thank you for choosing ${businessName}, have a wonderful day!"*
4. **The Hang Up:** The MILLISECOND you finish speaking that final sentence, trigger the \`end_call\` tool NATIVELY to terminate the connection. DO NOT output the tool call as raw text or JSON.

[SERVICE AREA]
Covered ZIP codes: ${coveredZips}
- When asked about service area: State covered cities AND zip codes. "Uh, we serve Dallas, Fort Worth, and Austin areas — covering zip codes like ${coveredZips.split(", ").slice(0, 4).join(", ")} and others. If you have an address in that area, what's your 5-digit zip code?"
- If ZIP is out of area: "I'm really sorry, but [ZIP] is outside of our current service area. We cannot schedule service there." Then offer to end the call or transfer to a manager. Do NOT ask for another ZIP unless customer explicitly says they misspoke.

[DATE & TIME RULES (STRICT)]
Compare scheduling request to Current Time in [SYSTEM CONTEXT]:
- Past 12:00 PM → morning slot today is gone.
- Past 4:00 PM → today is fully gone.
- If a slot has passed: "Since it's getting late today, the next open slot is tomorrow morning. Does that work?"

[ESCALATION RULES]
1. **Thinking Cushion:** Never go silent mid-call. Say "Give me just one second to pull that up —" before calling a tool.
2. **I Don't Know:** Use Rule 5 above. Do not guess.
3. **Emergency (fire/smoke/gas/sparks):** Say: "Okay, this sounds serious — please evacuate and call 9-1-1 right now." Then call \`flag_emergency()\`.
4. **Wants a human / manager / real person:** STOP the flow immediately. Call \`transfer_to_human()\` at once. Use EXACTLY this script and nothing else: "I completely understand. Let me get you connected to a team member right now. Please hold for just a moment." Do NOT lecture the user. Do NOT explain anything. Escalate immediately.
5. **Off-topic (2-strike rule):**
   - Strike 1: "Ha, I wish I knew — I'm just here for ${businessName} bookings. Can I help you with that?"
   - Strike 2: "I can only help with service bookings. I'll need to clear this line now."
   - Strike 3: Call \`handle_out_of_scope()\`.

${currentObjectiveInstruction}

CRITICAL: One question per response. Ask for name → STOP. Ask for phone → STOP. Ask for street+city → STOP. Ask for ZIP → STOP. Ask for scheduling → STOP. Violating this breaks the call.`;
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "handle_out_of_scope",
      description:
        "Call this function on Strike 3 when the user asks irrelevant questions or acts abusively to terminate the call and protect line availability.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Reason for termination, e.g. 'repeated_trivia', 'abusive_phrase', 'shut_up'",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transfer_to_human",
      description:
        "Immediately transfers the caller to a live human representative, manager, or supervisor when requested. Call this when the user asks for a real person, human, operator, or manager.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Reason for escalation or transfer, e.g., 'caller_requested_human', 'manager_requested', 'complex_situation'",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flag_emergency",
      description:
        "Flags a dangerous life-threatening or severe property emergency (fire, smoke, sparks, gas leak, severe flooding) and initiates priority dispatch alert.",
      parameters: {
        type: "object",
        properties: {
          severity: {
            type: "string",
            enum: ["life_threatening", "property_threatening"],
            description: "Severity level: life_threatening for gas/fire/smoke/sparks, property_threatening for flooding/burst pipes",
          },
          reason: {
            type: "string",
            description: "Emergency condition description, e.g., 'gas_leak', 'smoke_sparks', 'flooding_burst_pipe'",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "end_call",
      description:
        "Disconnects the phone line and severs the audio stream/WebRTC connection. Call this immediately when you have delivered the final confirmation and said goodbye.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Reason for ending call, e.g., 'booking_confirmed', 'customer_goodbye', 'abusive_terminated', 'out_of_scope'",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_customer_info",
      description:
        "Directly saves and upserts customer details (full name, phone number, address, service issue, date/time) into the business CRM matching business_id and phone_number. Returns the customer_id.",
      parameters: {
        type: "object",
        properties: {
          full_name: {
            type: ["string", "null"],
            description:
              "Customer's full legal name. MUST be a string with at least two words (first and last name, e.g. 'John Smith'). Single-word names are strictly rejected by the backend.",
          },
          phone_number: {
            type: ["string", "null"],
            pattern: "^\\d{10}$",
            description:
              "Customer's phone number. MUST be exactly 10 digits (Regex: ^\\d{10}$). Partial numbers (e.g. 7 or 8 digits) are strictly rejected by the backend.",
          },
          phone_digits: {
            type: ["string", "null"],
            pattern: "^\\d{10}$",
            description:
              "Phone number digits provided by customer. MUST be exactly 10 digits.",
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
            description: "Customer's issue or service need description (e.g. 'install a new central AC unit in living room')",
          },
          request_type: {
            type: ["string", "null"],
            enum: ["REPAIR", "INSTALLATION", "REPLACEMENT", "MAINTENANCE", "INSPECTION", "DIAGNOSTIC", "UPGRADE", "ESTIMATE", "GENERAL_SERVICE", "EMERGENCY", "OTHER", null],
            description: "High-level request type, e.g. 'INSTALLATION' for new AC unit, 'REPAIR' for broken equipment",
          },
          service: {
            type: ["string", "null"],
            description: "Specific service name or catalog item, e.g. 'AC_INSTALLATION', 'HEAT_PUMP_INSTALLATION', 'AC_REPAIR', etc.",
          },
          urgency: {
            type: ["string", "null"],
            enum: ["LOW", "NORMAL", "MEDIUM", "HIGH", "CRITICAL", null],
            description: "Customer urgency level: 'HIGH' or 'CRITICAL' for emergencies/floods/no-heat, 'NORMAL' for standard service",
          },
          date_time_preference: {
            type: ["string", "null"],
            description:
              "Customer's preferred date or time for service (e.g., 'Wednesday', 'tomorrow afternoon', 'today', 'Friday morning', 'ASAP')",
          },
          arrival_window: {
            type: ["string", "null"],
            description:
              "Chosen arrival window (e.g. '09:00 AM - 12:00 PM', '01:00 PM - 04:00 PM', 'morning', 'afternoon')",
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
          sentiment_state: {
            type: ["string", "null"],
            enum: ["empathetic", "urgent", "calm", "warm", null],
            description:
              "Hidden emotional prosody parameter for the TTS voice: 'empathetic' (for upset/angry), 'urgent' (for emergencies/floods), 'calm' (for elderly/confused), or 'warm' (standard friendly receptionist)",
          },
          caller_style: {
            type: ["string", "null"],
            enum: ["rushed", "elderly_confused", "angry_frustrated", "neutral", null],
            description:
              "Real-time psychological adaptation style of caller: 'rushed', 'elderly_confused', 'angry_frustrated', or 'neutral'",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_customer",
      description:
        "Call this immediately if a user states they are a returning customer, or if they mention a previous Ticket ID. It retrieves their Address, Name, and Past Issue so you do not have to ask for them again.",
      parameters: {
        type: "object",
        properties: {
          search_value: {
            type: "string",
            description:
              "The 10-digit phone number OR the alphanumeric Ticket ID provided by the customer.",
          },
          search_type: {
            type: "string",
            enum: ["phone_number", "ticket_id"],
            description:
              "Specify whether the search_value is a phone number or a ticket ID.",
          },
          phone_or_ticket_id: {
            type: "string",
            description:
              "Legacy fallback: 10-digit phone number or previous Ticket ID.",
          },
        },
        required: ["search_value", "search_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finalize_booking",
      description:
        "Call this ONLY after you have read the full summary back to the user and they have explicitly said 'Yes' or confirmed it is correct. This function saves the data to the database and will return the official Ticket ID for you to read to the customer.",
      parameters: {
        type: "object",
        properties: {
          full_name: {
            type: "string",
            description: "The caller's full name.",
          },
          phone_number: {
            type: "string",
            description: "The confirmed 10-digit phone number.",
          },
          full_address: {
            type: "string",
            description: "The full confirmed street address, city, and zip code.",
          },
          issue_description: {
            type: "string",
            description: "A brief summary of the technical problem.",
          },
          scheduled_date: {
            type: "string",
            description: "The final agreed-upon date in YYYY-MM-DD format.",
          },
          arrival_window: {
            type: "string",
            enum: ["08:00 AM - 12:00 PM", "01:00 PM - 05:00 PM", "After Hours Emergency"],
            description: "The specific time window agreed upon.",
          },
          customer_status: {
            type: "string",
            enum: ["New Customer", "Existing Customer"],
            description: "Classify if this was a brand new caller or someone you found via lookup.",
          },
          priority: {
            type: "string",
            enum: ["Normal", "Urgent", "Emergency (Life/Safety)"],
            description: "Standard repairs are Normal. Severe leaks are Urgent. Fire/Gas/Sparks are Emergency.",
          },
          mood: {
            type: "string",
            description: "Single word summarizing the caller's emotion (e.g., Angry, Happy, Neutral, Frustrated).",
          },
          caller_style: {
            type: "string",
            description: "Single word summarizing how they spoke (e.g., Rushed, Calm, Confused, Demanding).",
          },
          context_of_call: {
            type: "string",
            description: "A 1-2 sentence dispatcher summary of how the call went and what the technician should expect.",
          },
        },
        required: [
          "full_name",
          "phone_number",
          "full_address",
          "issue_description",
          "scheduled_date",
          "arrival_window",
          "customer_status",
          "priority",
          "mood",
          "caller_style",
          "context_of_call",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract_customer_info",
      description:
        "Quietly saves customer info into session state in background. Extract full or partial phone digits, address components, service and request type, date/time preferences, mood diagnostics, and emotional sentiment state.",
      parameters: {
        type: "object",
        properties: {
          full_name: {
            type: ["string", "null"],
            description:
              "Customer's full legal name. MUST be a string with at least two words (first and last name, e.g. 'John Smith'). Single-word names are strictly rejected by the backend.",
          },
          phone_number: {
            type: ["string", "null"],
            pattern: "^\\d{10}$",
            description:
              "Customer's phone number. MUST be exactly 10 digits (Regex: ^\\d{10}$). Partial numbers (e.g. 7 or 8 digits) are strictly rejected by the backend.",
          },
          phone_digits: {
            type: ["string", "null"],
            pattern: "^\\d{10}$",
            description:
              "Phone number digits provided by customer. MUST be exactly 10 digits.",
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
            description: "Customer's issue or service need description (e.g. 'install a new central AC unit in living room')",
          },
          request_type: {
            type: ["string", "null"],
            enum: ["REPAIR", "INSTALLATION", "REPLACEMENT", "MAINTENANCE", "INSPECTION", "DIAGNOSTIC", "UPGRADE", "ESTIMATE", "GENERAL_SERVICE", "EMERGENCY", "OTHER", null],
            description: "High-level request type, e.g. 'INSTALLATION' for new AC unit, 'REPAIR' for broken equipment",
          },
          service: {
            type: ["string", "null"],
            description: "Specific service name or catalog item, e.g. 'AC_INSTALLATION', 'HEAT_PUMP_INSTALLATION', 'AC_REPAIR', etc.",
          },
          urgency: {
            type: ["string", "null"],
            enum: ["LOW", "NORMAL", "MEDIUM", "HIGH", "CRITICAL", null],
            description: "Customer urgency level: 'HIGH' or 'CRITICAL' for emergencies/floods/no-heat, 'NORMAL' for standard service",
          },
          date_time_preference: {
            type: ["string", "null"],
            description:
              "Customer's preferred date or time for service (e.g., 'Wednesday', 'tomorrow afternoon', 'today', 'Friday morning', 'ASAP')",
          },
          arrival_window: {
            type: ["string", "null"],
            description:
              "Chosen arrival window (e.g. '09:00 AM - 12:00 PM', '01:00 PM - 04:00 PM', 'morning', 'afternoon')",
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
          sentiment_state: {
            type: ["string", "null"],
            enum: ["empathetic", "urgent", "calm", "warm", null],
            description:
              "Hidden emotional prosody parameter for the TTS voice: 'empathetic' (for upset/angry), 'urgent' (for emergencies/floods), 'calm' (for elderly/confused), or 'warm' (standard friendly receptionist)",
          },
          caller_style: {
            type: ["string", "null"],
            enum: ["rushed", "elderly_confused", "angry_frustrated", "neutral", null],
            description:
              "Real-time psychological adaptation style of caller: 'rushed', 'elderly_confused', 'angry_frustrated', or 'neutral'",
          },
          customer_status: {
            type: ["string", "null"],
            enum: ["New Customer", "Existing Customer", null],
            description: "Whether the caller is a 'New Customer' or 'Existing Customer'",
          },
          priority: {
            type: ["string", "null"],
            enum: ["Normal", "Urgent", "Emergency (Life/Safety)", null],
            description: "Dispatch priority: 'Normal', 'Urgent', or 'Emergency (Life/Safety)'",
          },
          context_summary: {
            type: ["string", "null"],
            description: "1-2 sentence context summary of what the customer needs for technician dispatch",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_business_faq",
      description:
        "Search the business FAQ for answers about pricing, dispatch fees, hours of operation, service area, licensing, or warranty. ALWAYS call this tool when the customer asks a business-related question — do NOT answer from memory. After getting the answer, immediately pivot back to the Current Objective.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description:
              "The customer's exact question or topic (e.g. 'dispatch fee', 'hours', 'warranty', 'are you licensed', 'service area', 'pricing').",
          },
        },
        required: ["question"],
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
  // NOTE: Do NOT add generic terms like 'agent', 'hello', 'hi' here.
  // Only trigger on explicit requests for a live human being.
  // "Hi agent" / "Hello AI" / "You are a bot" are greetings, NOT escalation requests.
  return (
    lower.includes("real person") ||
    lower.includes("live person") ||
    lower.includes("real human") ||
    lower.includes("live human") ||
    lower.includes("live operator") ||
    lower.includes("real operator") ||
    lower.includes("talk to a human") ||
    lower.includes("speak to a human") ||
    lower.includes("connect me to a human") ||
    lower.includes("transfer me to a human") ||
    lower.includes("want a human") ||
    lower.includes("need a human") ||
    lower.includes("someone else") ||
    lower.includes("talk to someone") ||
    lower.includes("speak to someone") ||
    lower.includes("speak with someone") ||
    lower.includes("speak to a person") ||
    lower.includes("talk to a person") ||
    lower.includes("speak to manager") ||
    lower.includes("talk to manager") ||
    lower.includes("talk to supervisor") ||
    lower.includes("speak to supervisor") ||
    lower.includes("get me a representative") ||
    lower.includes("transfer me")
  );
}

function cleanSpokenUtterance(raw: string): string {
  if (!raw) return "";
  let clean = raw.trim();

  // 1. Cut off at the first occurrence of 3 or more dots or unicode ellipsis chains
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

  // 6. Meta-Text & Prosody Tag Removal (ZERO LEAKAGE: Never speak prosody tags, emoji tags, or speaker headers)
  clean = clean
    .replace(/^REGENT[:\s]*/i, "")
    .replace(/(?:☀️|❤️|⚡|🌿)?\s*(?:WARM|EMPATHETIC|URGENT|CALM)\s*PROSODY:?/gi, "")
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
    .replace(/\s*\((?:Note|Stage direction|Awaiting|Silence|Thinking)[\s\S]*?\)/gi, "")
    .replace(/\s*\[(?:Note|Stage direction|Awaiting|Silence|Thinking|SYSTEM)[\s\S]*?\]/gi, "")
    .replace(/\s*\(Note:[^)]*\)/gi, "")
    .replace(/^\s*[:\-\u2022]\s*/, "")
    .trim();

  // 7. ZERO LEAKAGE (CRITICAL): Strip raw JSON code, tool calls, and brackets
  clean = clean
    .replace(/```(?:json)?[\s\S]*?```/gi, "")
    .replace(/\{[\s\S]*?"(?:type|name)"\s*:\s*"(?:function|end_call|finalize_booking|extract_customer_info|save_customer_info|lookup_customer)"[\s\S]*?\}/gi, "")
    .replace(/\{[\s\S]*?"name"\s*:\s*"end_call"[\s\S]*?\}/gi, "")
    .replace(/\{[\s\S]*?"type"\s*:\s*"function"[\s\S]*?\}/gi, "")
    .replace(/\b(?:end_call|finalize_booking|extract_customer_info)\s*\([^)]*\)/gi, "")
    .replace(/\[(?:SYSTEM|DYNAMIC STATE|CURRENT SESSION STATE)[^\]]*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return clean;
}

export function normalizeSpokenDigits(text: string): string {
  if (!text) return "";
  let s = text.toLowerCase();

  const triples: Record<string, string> = {
    "triple zero": "000", "triple oh": "000",
    "triple one": "111", "triple two": "222", "triple three": "333",
    "triple four": "444", "triple five": "555", "triple six": "666",
    "triple seven": "777", "triple eight": "888", "triple nine": "999",
  };
  for (const [word, digits] of Object.entries(triples)) {
    s = s.replace(new RegExp(word, "g"), digits);
  }

  const doubles: Record<string, string> = {
    "double zero": "00", "double oh": "00",
    "double one": "11", "double two": "22", "double three": "33",
    "double four": "44", "double five": "55", "double six": "66",
    "double seven": "77", "double eight": "88", "double nine": "99",
  };
  for (const [word, digits] of Object.entries(doubles)) {
    s = s.replace(new RegExp(word, "g"), digits);
  }

  const singles: Record<string, string> = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    "oh": "0",
  };
  for (const [word, digit] of Object.entries(singles)) {
    s = s.replace(new RegExp(`\\b${word}\\b`, "g"), digit);
  }

  while (/(\d)\s+(\d)/.test(s)) {
    s = s.replace(/(\d)\s+(\d)/g, "$1$2");
  }

  return s;
}

interface ParsedAddress {
  street?: string;
  city?: string;
  zip?: string;
}

function parseAddressString(addr: string): ParsedAddress {
  if (!addr) return {};
  const res: ParsedAddress = {};

  const normalized = normalizeSpokenDigits(addr);
  const collapsedDigits = normalized.replace(/(\d)\s+(\d)/g, "$1$2").replace(/(\d)\s+(\d)/g, "$1$2");
  const zipMatch = addr.match(/\b\d{5}\b/) || normalized.match(/\b\d{5}\b/) || collapsedDigits.match(/\b\d{5}\b/);
  if (zipMatch) {
    res.zip = zipMatch[0];
  }

  // Address must have an actual indicator of an address: a street number/keyword, a 5-digit zip, or known city
  const hasStreetPattern = /\b\d{1,5}\s+[A-Za-z0-9\.\s]+(Terrace|Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Way|Lane|Ln|Court|Ct|Circle|Cir|Trail|Parkway)\b/i.test(addr);
  const hasZip = Boolean(res.zip);
  const hasCityIndicator = /(?:ciudad\s+(?:es|de)|city\s+(?:is|of))\s+[A-Za-z\s]+/i.test(addr) || /\b(dallas|fort worth|austin|houston|san antonio|arlington|plano|frisco)\b/i.test(addr);

  if (!hasStreetPattern && !hasZip && !hasCityIndicator) {
    return {};
  }

  // Clean conversational prefixes: "Okay, so my address is 123 Main St" -> "123 Main St"
  let clean = addr
    .replace(/^(?:okay|ok|yeah|sure|right|yes|um|uh|umm|got it)?[,\s]*(?:so\s+)?(?:my\s+(?:street\s+)?address\s+is\s+|it's\s+|it\s+is\s+|i'm\s+at\s+|living\s+at\s+|located\s+at\s+|at\s+)+/i, "")
    .replace(/^(?:okay|ok|yeah|sure|right|yes|um|uh|umm|got it)[,\s]+/i, "")
    .trim();

  // Remove zip for cleaner street/city parsing
  clean = clean.replace(/\b\d{5}\b/, "").trim().replace(/,\s*$/, "");
  const parts = clean.split(",").map((p) => p.trim().replace(/\.$/, "")).filter(Boolean);

  if (parts.length >= 2) {
    if (/\d/.test(parts[0]) || /(?:street|st|ave|blvd|rd|road|dr|drive|way|lane|ct)/i.test(parts[0])) {
      res.street = parts[0];
      // Only set city if it does not contain digits and is not a common filler/descriptor
      if (!/\d/.test(parts[1]) && !/\b(actually|facing|issue|cooler|problem|please|address|street|road|avenue)\b/i.test(parts[1])) {
        res.city = parts[1];
      }
    } else {
      // First part might be conversational filler that wasn't stripped; check second part
      if (/\d/.test(parts[1]) || /(?:street|st|ave|blvd|rd|road|dr|drive|way|lane|ct)/i.test(parts[1])) {
        res.street = parts[1];
        if (parts[2] && !/\d/.test(parts[2])) {
          res.city = parts[2];
        }
      }
    }
  } else if (parts.length === 1) {
    if (/\d+\s+[A-Za-z]/.test(parts[0]) || /(?:street|st|ave|blvd|rd|road|dr|drive|way|lane|ct)/i.test(parts[0])) {
      res.street = parts[0];
    } else if (hasCityIndicator && !/\d/.test(parts[0])) {
      res.city = parts[0];
    }
  }

  // Preemptive City Inference: If ZIP is present but city was omitted, infer city from ZIP
  if (res.zip && !res.city) {
    if (res.zip.startsWith("787")) res.city = "Austin";
    else if (res.zip.startsWith("750") || res.zip.startsWith("752")) res.city = "Dallas";
    else if (res.zip.startsWith("761")) res.city = "Fort Worth";
    else res.city = "Austin";
  }

  return res;
}

async function callChatCompletion(messages: any[]) {
  const groqApiKey = process.env.GROQ_API_KEY;
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;

  // Prioritize active, ultra-fast Groq models (sub-250ms TTFT)
  const groqModels = [
    "qwen/qwen3.8-27b",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
  ];

  let lastError: any = null;

  if (groqApiKey) {
    for (const model of groqModels) {
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
            temperature: 0.6,
            max_tokens: 220,
          }),
          signal: AbortSignal.timeout(4000),
        });

        if (!res.ok) {
          const errText = await res.text();
          lastError = new Error(`Groq ${model} returned ${res.status}: ${errText}`);
          if (res.status === 429) {
            await new Promise((r) => setTimeout(r, 400));
          }
          continue;
        }

        const data = await res.json();
        const msg = data.choices[0]?.message;
        const hasContent = msg?.content && msg.content.trim().length > 0;
        const hasToolCalls = msg?.tool_calls && msg.tool_calls.length > 0;
        if (!hasContent && !hasToolCalls) {
          lastError = new Error(`Groq ${model} returned an empty message.`);
          continue;
        }
        return msg;
      } catch (e) {
        lastError = e;
      }
    }
  }

  // Fallback to OpenRouter (Fast, High Availability)
  if (openrouterApiKey) {
    const openRouterModels = [
      "meta-llama/llama-3.3-70b-instruct",
      "google/gemini-2.5-flash",
    ];
    for (const model of openRouterModels) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openrouterApiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            tools: TOOLS,
            tool_choice: "auto",
            temperature: 0.6,
            max_tokens: 220,
          }),
          signal: AbortSignal.timeout(3500),
        });

        if (res.ok) {
          const data = await res.json();
          const msg = data.choices[0]?.message;
          const hasContent = msg?.content && msg.content.trim().length > 0;
          const hasToolCalls = msg?.tool_calls && msg.tool_calls.length > 0;
          if (hasContent || hasToolCalls) return msg;
        }
      } catch (e) {
        lastError = e;
      }
    }
  }

  // Fallback to OpenAI if configured
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          tools: TOOLS,
          tool_choice: "auto",
          temperature: 0.6,
          max_tokens: 220,
        }),
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const data = await res.json();
        const msg = data.choices[0]?.message;
        const hasContent = msg?.content && msg.content.trim().length > 0;
        const hasToolCalls = msg?.tool_calls && msg.tool_calls.length > 0;
        if (hasContent || hasToolCalls) return msg;
      }
    } catch (e) {
      lastError = e;
    }
  }

  console.error("[RelagentEngine] All LLM providers failed or returned empty. Delegating to intelligent state fallback.", lastError);
  return null;
}

export function generateIntelligentFallback(
  session: ConversationSession,
  userText: string
): string {
  const nameVal = session.lead.name?.value || "";
  const firstName = nameVal && nameVal !== "Missing" ? nameVal.trim().split(/\s+/)[0] : "";
  const lowerUser = (userText || "").toLowerCase();
  const normalizedUser = normalizeSpokenDigits(userText || "");

  // 1. Service Area / Location inquiries
  if (
    lowerUser.includes("service area") ||
    lowerUser.includes("where do you") ||
    lowerUser.includes("what area") ||
    lowerUser.includes("what cities") ||
    lowerUser.includes("where are you") ||
    lowerUser.includes("take the appointment") ||
    lowerUser.includes("outside")
  ) {
    return `Uh, we serve Dallas, Fort Worth, and surrounding North Texas areas, covering zip codes like 75001, 75201 through 75210, and 76102, as well as Austin (78701 through 78705). If you have an address in our service area, ${firstName ? firstName + ', ' : ''}what's the 5-digit zip code?`;
  }

  // 2. Customer gave a partial zip code or spoken digits (e.g., "Nine triple zero point" -> 9000)
  const partialDigits = normalizedUser.replace(/\D/g, "");
  if (partialDigits.length > 0 && partialDigits.length < 5) {
    return `Umm, I got ${partialDigits.split("").join("-")} so far${firstName ? `, ${firstName}` : ""} — could you please share the remaining digits of your 5-digit zip code?`;
  }

  // 3. Customer provided street/city but zip is missing
  if (lowerUser.includes("dallas") || lowerUser.includes("fort worth") || lowerUser.includes("austin") || lowerUser.includes("street") || lowerUser.includes("st")) {
    return `Got it, ${firstName ? firstName + ' — ' : ''}what's the 5-digit zip code for that address?`;
  }

  // 4. Customer restated or emphasized their problem / appliance
  if (
    lowerUser.includes("water cooler") ||
    lowerUser.includes("dispensing") ||
    lowerUser.includes("problem") ||
    lowerUser.includes("issue") ||
    lowerUser.includes("stated") ||
    lowerUser.includes("cooler")
  ) {
    const knownIssue = session.lead.problem?.value || "water cooler issue";
    if (!session.lead.name?.value || session.lead.name.status !== "VALID") {
      return `Uh, got it — a ${knownIssue}, no problem at all. Could you tell me your first and last name for the booking?`;
    }
    if (!session.lead.phone?.value || session.lead.phone.status !== "VALID") {
      return `Understood, ${firstName ? firstName + ' — ' : ''}I have your ${knownIssue} noted down. Could you give me your 10-digit phone number?`;
    }
    if (!session.lead.address?.value || session.lead.address.status !== "VALID") {
      return `Got it, ${firstName ? firstName + ' — ' : ''}I have that ${knownIssue} noted. What's the 5-digit zip code for your Dallas address?`;
    }
    if (!session.lead.timing?.value || session.lead.timing.status !== "VALID") {
      return `Got it, ${firstName ? firstName + ' — ' : ''}we'll get a tech out for your ${knownIssue}. What day and time works best for you — morning or afternoon?`;
    }
  }

  // 5. Follow the missing collection fields in priority order with personalized greetings:
  if (!session.lead.problem?.value) {
    return "Thanks for calling Apex Heating & Air! How can I help you with your home services today?";
  }

  if (!session.lead.name?.value || session.lead.name.status !== "VALID") {
    if (session.lead.name?.value) {
      return `Got it, ${session.lead.name.value} — and what's your last name?`;
    }
    return "Uh, got it — and could you tell me your first and last name for the booking?";
  }

  if (!session.lead.phone?.value || session.lead.phone.status !== "VALID") {
    return `Okay, ${firstName ? firstName + ' — ' : ''}could you give me your 10-digit phone number?`;
  }

  if (!session.lead.address?.value || session.lead.address.status !== "VALID") {
    return `Right, ${firstName ? firstName + ' — ' : ''}could you confirm the full street address, city, and 5-digit zip code?`;
  }

  if (!session.lead.timing?.value || session.lead.timing.status !== "VALID") {
    return `Great, ${firstName ? firstName + ' — ' : ''}what date and arrival window works best for our technician to visit?`;
  }

  // 6. Confirmation wrap-up if all 5 fields are present
  return `Thanks, ${firstName ? firstName : 'so much'} — let me get that finalized for you right now.`;
}

/**
 * Deterministic Out-of-Scope (OOS) & Abuse Enforcement Function
 * Bypasses LLM text generation to prevent hallucinated warnings, infinite loops, and inaccurate strike counts.
 */
export function handleDeterministicOOS(
  session: ConversationSession,
  businessName: string,
  tenantId: string,
  callerPhone?: string | null
): {
  response: string;
  session: ConversationSession;
  complete: boolean;
  sentimentState: SentimentState;
  strikeCount: number;
} {
  // 1. Strictly increment oos_strike_count by 1
  const newStrikeCount = (session.oos_strike_count || 0) + 1;
  session.oos_strike_count = newStrikeCount;
  session.offTopicCount = newStrikeCount;

  let response = "";
  let complete = false;

  if (newStrikeCount === 1) {
    // Strike 1: Firm prompt to refocus on tenant services
    response = `I'm specifically here to help with your ${businessName} service needs. Do you have an issue I can help book a technician for?`;
  } else if (newStrikeCount === 2) {
    // Strike 2: Firm warning about clearing the line
    response = `I can only assist with our business services. If you don't need a technician, I will need to clear this line for other customers.`;
  } else {
    // Strike >= 3: Forceful termination and permanent block
    response = `This line is reserved exclusively for customer service inquiries. Continued disruption will result in your number being permanently blocked. Good-bye.`;
    complete = true;
    session.state = "CLOSED";
    session.finalizationStatus = "COMPLETE";

    // ACTION: Immediately trigger end_call() to sever SIP/audio connection and update Supabase customers table to set is_blocked_caller = true
    const phone = session.lead.phone?.value || callerPhone || session.callerPhone || "UNKNOWN";
    disconnectAndBlockCaller(
      tenantId,
      phone,
      "Exceeded 2-strike out-of-scope limit. Disruption / abusive input.",
      session.conversationHistory.map((h) => `${h.role}: ${h.content}`).join("\n")
    ).catch(console.error);
  }

  return {
    response,
    session,
    complete,
    sentimentState: "urgent", // Firm prosody
    strikeCount: newStrikeCount,
  };
}

/**
 * STEP 3.2: The Call Conclusion & Summarization Hook (end_call)
 * Executes sequence:
 * Step A: Commit booking to appointments table (generating TKT-YYYYMMDD-XXXX).
 * Step B: Run fast secondary LLM prompt over full_transcript to extract:
 *         ai_summary_for_owner, action_needed, call_category.
 * Step C: Insert Step B's output + full transcript into call_logs table.
 */
export async function executeEndCallConclusionHook(
  session: ConversationSession,
  referenceDate: Date = new Date()
) {
  const businessId =
    session.businessId ||
    session.tenantId ||
    "b0000000-0000-0000-0000-000000000001";
  const phone = session.lead.phone?.value || session.callerPhone || "";
  const cleanPhone = phone.replace(/\D/g, "").slice(-10);
  const fullName = session.lead.name?.value || "Valued Customer";
  const address = session.lead.address?.value || "100 Main St, Austin 78701";
  const parsedAddr = parseAddressString(address);
  const city = parsedAddr.city || "Austin";
  const zip = parsedAddr.zip || "78701";

  const timingVal = session.lead.timing?.value || "";
  let scheduledDate = referenceDate.toISOString().split("T")[0];
  let arrivalWindow = "09:00 AM - 12:00 PM";
  const dateMatch = timingVal.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (dateMatch) scheduledDate = dateMatch[1];
  if (timingVal.includes(" - ")) {
    const winMatch = timingVal.match(/\b(\d{2}:\d{2}\s+(?:AM|PM)\s*-\s*\d{2}:\d{2}\s+(?:AM|PM))\b/i);
    if (winMatch) arrivalWindow = winMatch[1];
  } else {
    const winFound = resolveArrivalWindow(timingVal);
    if (winFound) arrivalWindow = winFound;
  }

  const ticketId = session.ticketId || generateTicketId(referenceDate);
  session.ticketId = ticketId;

  const fullTranscript = session.conversationHistory
    .map((h) => `${h.role}: ${h.content}`)
    .join("\n");

  const conclusionResult = await commitCallConclusion({
    businessId,
    customer: {
      id: session.customerId || undefined,
      fullName,
      phoneNumber: cleanPhone,
      streetAddress: address,
      city,
      zipCode: zip,
      isExistingCustomer: session.returningCustomer || false,
    },
    ticket: {
      ticketId,
      serviceCategory: session.trade || "HVAC",
      reportedIssue: session.lead.problem?.value || "Service intake",
      scheduledDate,
      arrivalWindow,
      status: "Confirmed",
      fullName,
      phoneNumber: cleanPhone,
      fullAddress: address,
      customerStatus: session.returningCustomer ? "Existing Customer" : "New Customer",
      priority:
        session.safety?.status === "CRITICAL"
          ? "Emergency (Life/Safety)"
          : session.sentimentState === "urgent"
          ? "Urgent"
          : "Normal",
      mood:
        session.moodDiagnostics?.sentimentTag === "angry"
          ? "Angry"
          : session.moodDiagnostics?.sentimentTag === "happy"
          ? "Happy"
          : session.sentimentState === "empathetic"
          ? "Frustrated"
          : "Neutral",
      callerStyle:
        session.callerStyle === "rushed"
          ? "Rushed"
          : session.callerStyle === "elderly_confused"
          ? "Confused"
          : session.callerStyle === "angry_frustrated"
          ? "Demanding"
          : "Calm",
      contextSummary:
        session.moodDiagnostics?.situationContextNotes ||
        session.lead.problem?.value ||
        "Service booking intake",
    },
    callRecord: {
      ticketId,
      customerMobile: cleanPhone,
      callTranscript: fullTranscript,
      callType:
        session.safety?.status === "CRITICAL"
          ? "emergency"
          : session.state === "ESCALATED"
          ? "human_escalation"
          : "standard_booking",
      callerMood:
        session.moodDiagnostics?.sentimentTag === "angry"
          ? "Angry"
          : session.moodDiagnostics?.sentimentTag === "happy"
          ? "Happy"
          : "Neutral",
      callerStyle:
        session.callerStyle === "rushed"
          ? "Rushed"
          : session.callerStyle === "elderly_confused"
          ? "Confused"
          : session.callerStyle === "angry_frustrated"
          ? "Demanding"
          : "Calm",
      customerStatus: session.returningCustomer ? "Existing Customer" : "New Customer",
      priority:
        session.safety?.status === "CRITICAL"
          ? "Emergency (Life/Safety)"
          : session.sentimentState === "urgent"
          ? "Urgent"
          : "Normal",
      contextSummary:
        session.moodDiagnostics?.situationContextNotes ||
        session.lead.problem?.value ||
        "Service booking intake",
    },
  });

  if (conclusionResult.customerId) {
    session.customerId = conclusionResult.customerId;
  }

  return conclusionResult;
}

export async function processRelagentTurn(
  request: EngineRequest
): Promise<EngineResponse> {
  const { session, utterance } = request;
  let updatedSession: ConversationSession = { ...session };

  // ── Multi-Tenant Profile Resolution ────────────────────────────────────────
  const tenant = await getTenantProfile(session.tenantId || session.callerPhone);
  const businessName = tenant.businessName || getBusinessName(session.trade);
  const aiAgentName = tenant.aiAgentName || "Regent";
  updatedSession.tenantId = tenant.tenantId;

  // Reference date evaluation
  const referenceDate = updatedSession.lead.context?.value?.startsWith("REF_DATE:")
    ? new Date(updatedSession.lead.context.value.replace("REF_DATE:", ""))
    : new Date();

  // ── 1. Deterministic Turn 0: FCC & TCPA 2-Party Consent Compliance ─────────
  const isStartTurn =
    session.turnCount === 0 ||
    session.state === "START" ||
    (!utterance && session.conversationHistory.length === 0);

  if (isStartTurn) {
    const greeting = `Thanks for calling ${businessName} on a recorded line. I'm ${aiAgentName}, your AI assistant. How can I help you today?`;

    updatedSession = {
      ...updatedSession,
      tenantId: tenant.tenantId,
      state: "COLLECTING",
      turnCount: 1,
      recordingDisclosureGiven: true,
      conversationHistory: [
        ...updatedSession.conversationHistory,
        { role: "REGENT", content: greeting },
      ],
      currentAction: "ANSWER_QUESTION",
      diagnosticReason: "Turn-0 FCC/TCPA 2-Party Consent Compliant Greeting",
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
      sentimentState: "warm",
      callerStyle: "neutral",
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

  // ── Deterministic Out-of-Scope (OOS) & Abuse Intercept ─────────────────────
  const isDirectOOS =
    checkOutOfScope(userText).isOutOfScope ||
    /\b(shut\s*up|shut-up|tell me a joke|who is the (?:ceo|president)|president of|capital of France)\b/i.test(userText);

  if (isDirectOOS && updatedSession.state !== "CLOSED") {
    const oos = handleDeterministicOOS(
      updatedSession,
      businessName,
      tenant.tenantId,
      session.callerPhone
    );
    updatedSession.conversationHistory.push({
      role: "REGENT",
      content: oos.response,
    });

    return {
      response: oos.response,
      session: updatedSession,
      shouldTransfer: false,
      complete: oos.complete,
      state: updatedSession.state,
      missingFields: updatedSession.missingFields,
      safety: { status: "NORMAL", category: null, confidence: 1.0 },
      currentAction: oos.complete ? "CLOSE_CALL" : "ANSWER_QUESTION",
      targetField: null,
      diagnosticReason: `Deterministic OOS Strike ${oos.strikeCount} Enforced`,
      sentimentState: oos.sentimentState,
      callerStyle: updatedSession.callerStyle || "neutral",
    };
  }

  // ── Preemptive Entity Extraction (Zero-Loop & Instant State Sync) ───────────
  // 0. Preemptive Name Extraction
  if (!updatedSession.lead.name?.value || updatedSession.lead.name.status !== "VALID") {
    const nameMatch = userText.match(
      /(?:my\s+(?:full\s+)?name\s+is|this\s+is|i\s+am|i'm|call\s+me)\s+([A-Za-z]+(?:\s+[A-Za-z]+)+)/i
    ) || (userText.trim().split(/\s+/).length >= 2 && !/\b(ac|air|heat|leak|pipe|water|repair|broken|facing|issue|problem|street|drive|avenue|road)\b/i.test(userText) ? userText.match(/^[A-Za-z]+(?:\s+[A-Za-z]+)+$/) : null);
    if (nameMatch && (nameMatch[1] || nameMatch[0])) {
      let extracted = (nameMatch[1] || nameMatch[0]).trim();
      // Clean up clauses like "and my location is...", "and my address is...", "and my phone is..."
      extracted = extracted
        .replace(/\b(?:and\s+)?(?:my\s+)?(?:location|address|phone|number|cell|zip|city|i\s+live|living)\b.*$/i, "")
        .replace(/\b(?:and\s+i'm|and\s+i\s+am|and\s+my)\b.*$/i, "")
        .replace(/^(?:uh|um|er|well)\s+/i, "")
        .trim();
      // Cap at 2 to 3 words (First [Middle] Last) to avoid swallowing subsequent spoken text
      const parts = extracted.split(/\s+/).filter(Boolean);
      if (parts.length > 3) {
        extracted = parts.slice(0, 2).join(" ");
      }
      const isCommonWord = /\b(actually|facing|issue|problem|calling|having|wondering|dealing|trying|water|cooler|here|there|fine|good|okay|sure|sorry|please)\b/i.test(extracted);
      if (extracted.split(/\s+/).length >= 2 && !isCommonWord) {
        updatedSession.lead.name = {
          value: extracted,
          status: "VALID",
          confidence: 0.95,
          sourceTurn: updatedSession.turnCount,
          updatedTurn: updatedSession.turnCount,
          turn: updatedSession.turnCount,
          validationReason: "Preemptively verified full name",
        };
      }
    }
  }

  // 1. Phone extraction
  const rawPhoneDigits = normalizeSpokenDigits(userText).replace(/\D/g, "");
  const rawPhoneMatch = userText.match(/\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/);
  if ((rawPhoneMatch || rawPhoneDigits.length === 10) && (!updatedSession.lead.phone?.value || updatedSession.lead.phone.status !== "VALID")) {
    const clean10 = rawPhoneMatch ? `${rawPhoneMatch[1]}${rawPhoneMatch[2]}${rawPhoneMatch[3]}` : rawPhoneDigits.slice(-10);
    updatedSession.lead.phone = {
      value: clean10,
      status: "VALID",
      confidence: 1.0,
      sourceTurn: updatedSession.turnCount,
      updatedTurn: updatedSession.turnCount,
      turn: updatedSession.turnCount,
      validationReason: "Preemptively verified 10-digit phone number",
    };
  }

  // 2. Address & Preemptive ZIP extraction
  const hasAddrSignal = Boolean(
    userText.match(
      /\b\d{1,5}\s+[A-Za-z0-9\.\s]+(Terrace|Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Way|Lane|Ln|Court|Ct|Circle|Cir)\b/i
    ) ||
      userText.match(/\b\d{5}\b/) ||
      normalizeSpokenDigits(userText).match(/\b\d{5}\b/) ||
      /\b(dallas|fort worth|austin|houston|san antonio)\b/i.test(userText)
  );

  if (hasAddrSignal) {
    const currentAddr = updatedSession.lead.address?.value || "";
    const currentParts = parseAddressString(currentAddr);
    let addrStreet = currentParts.street || "";
    let addrCity = currentParts.city || "";
    let addrZip = currentParts.zip || "";

    const parsedText = parseAddressString(userText);
    if (parsedText.street) addrStreet = parsedText.street;
    if (parsedText.city) addrCity = parsedText.city;
    if (parsedText.zip) addrZip = parsedText.zip;

    const streetMatch = userText.match(
      /\b\d{1,5}\s+[A-Za-z0-9\.\s]+(Terrace|Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Way|Lane|Ln|Court|Ct|Circle|Cir)\b/i
    );
    if (streetMatch) addrStreet = streetMatch[0].trim();

    const normalizedUtterance = normalizeSpokenDigits(userText);
    const zipMatch = userText.match(/\b\d{5}\b/) || normalizedUtterance.match(/\b\d{5}\b/);
    if (zipMatch) addrZip = zipMatch[0];

    const cityMatch = userText.match(
      /(?:ciudad\s+(?:es|de)|city\s+(?:is|of))\s+([A-Za-z\s]+?)(?=\s+(?:y|and|,|\.|$|\d))/i
    );
    if (cityMatch) {
      addrCity = cityMatch[1].trim();
    } else {
      const cityZipMatch = userText.match(/,\s*([A-Za-z\s]+?)(?:\s+\d{5}|\.|$)/);
      if (cityZipMatch && cityZipMatch[1]) {
        const c = cityZipMatch[1].trim().replace(/\.$/, "");
        if (c.length > 2 && !/street|st|ave|road|rd|address|actually|issue|problem|cooler|water/i.test(c)) {
          addrCity = c;
        }
      }
    }

    if (!addrCity && addrZip) {
      if (addrZip.startsWith("787")) addrCity = "Austin";
      else if (addrZip.startsWith("750") || addrZip.startsWith("752")) addrCity = "Dallas";
      else if (addrZip.startsWith("761")) addrCity = "Fort Worth";
      else addrCity = "Austin";
    }

    if (addrStreet && addrCity && addrZip) {
      const isZipCovered =
        !tenant.coveredZipCodes ||
        tenant.coveredZipCodes.length === 0 ||
        tenant.coveredZipCodes.includes(addrZip);

      const fullAddr = `${addrStreet}, ${addrCity} ${addrZip}`;
      updatedSession.lead.address = {
        value: fullAddr,
        status: isZipCovered ? "VALID" : "INVALID",
        confidence: 1.0,
        sourceTurn: updatedSession.lead.address?.sourceTurn || updatedSession.turnCount,
        updatedTurn: updatedSession.turnCount,
        turn: updatedSession.turnCount,
        validationReason: isZipCovered
          ? "Preemptively verified address and covered zip code"
          : `ZIP ${addrZip} outside covered area`,
      };
    } else if (addrStreet) {
      const partialAddr = [addrStreet, addrCity, addrZip].filter(Boolean).join(", ");
      updatedSession.lead.address = {
        value: partialAddr,
        status: "CAPTURED",
        confidence: 0.85,
        sourceTurn: updatedSession.lead.address?.sourceTurn || updatedSession.turnCount,
        updatedTurn: updatedSession.turnCount,
        turn: updatedSession.turnCount,
        validationReason: !addrZip ? "Missing ZIP code" : "Missing city",
      };
    }
  }

  // 2b. Preemptive Issue / Problem Correction
  const isIssueCorrectionSignal =
    (request.isInterrupted ||
      /\b(?:it's\s+not|not\s+(?:the\s+)?(?:ac|air\s+conditioner|heater|water|pipe|leak|drain)|actually\s+(?:it's|it\s+is|my)|instead\s+(?:it's|it\s+is))\b/i.test(
        userText
      )) &&
    /\b(?:flooding|burst|pipe|leak|water|drain|heater|furnace|ac|unit|broken|noise)\b/i.test(userText);

  if (isIssueCorrectionSignal) {
    const issueClean = userText
      .replace(/^(?:wait|no|hold\s+on|actually|sorry|stop)[,\.\s]*/i, "")
      .replace(/^(?:it's\s+not\s+[^,]+,\s*)/i, "")
      .trim();
    if (issueClean.length > 5) {
      updatedSession.lead.problem = {
        value: issueClean,
        status: "VALID",
        confidence: 0.95,
        sourceTurn: updatedSession.turnCount,
        updatedTurn: updatedSession.turnCount,
        turn: updatedSession.turnCount,
        validationReason: "Corrected issue description during barge-in",
      };
      if (/\b(?:flooding|burst|pipe|leak|smoke|fire|gas)\b/i.test(userText)) {
        updatedSession.sentimentState = "urgent";
      }
    }
  }

  // 3. Preemptive Date & Timing resolution
  if (
    (!updatedSession.lead.timing?.value || updatedSession.lead.timing.status !== "VALID") &&
    (/\b(today|tomorrow|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight|asap|whenever|next week|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.test(userText))
  ) {
    const tenantTz = tenant.timezone || "America/Chicago";
    const dateRes = resolveDateTime(userText, referenceDate, tenantTz);
    if (dateRes.isAmbiguous && dateRes.clarificationPrompt) {
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
      const hasWindow = Boolean(dateRes.arrivalWindow || (dateRes.timePreference && dateRes.timePreference.includes(" - ")));
      const needsWindow = dateRes.needsWindowClarification || !hasWindow;
      updatedSession.lead.timing = {
        value: dateRes.normalizedSchedule || dateRes.exactDate || userText,
        status: needsWindow ? "CAPTURED" : "VALID",
        confidence: needsWindow ? 0.8 : 1.0,
        sourceTurn: updatedSession.turnCount,
        updatedTurn: updatedSession.turnCount,
        turn: updatedSession.turnCount,
        validationReason: needsWindow ? dateRes.windowClarificationPrompt : `Resolved to: ${dateRes.normalizedSchedule || dateRes.exactDate}`,
      };
    }
  }

  // 4. Preemptive Confirmation Gate / Wrap-up
  const allFieldsCollected = Boolean(
    updatedSession.lead.name?.status === "VALID" &&
    updatedSession.lead.phone?.status === "VALID" &&
    updatedSession.lead.address?.status === "VALID" &&
    updatedSession.lead.problem?.status === "VALID" &&
    updatedSession.lead.timing?.status === "VALID"
  );
  const isAffirmativeConfirmation =
    ((updatedSession.state as string) === "READY_FOR_CONFIRMATION" || (updatedSession.state as string) === "CONFIRMING" || allFieldsCollected) &&
    !/\b(prefer|instead|morning|afternoon|evening|change|actually|different|wrong|no)\b/i.test(userText) &&
    (/^(?:yes|yeah|yep|correct|sounds good|sounds great|perfect|right|looks good|all set|that's right|that is right|fine|sure|great)[!.,\s]*$/i.test(userText.trim()) ||
     /\b(confirmed|confirm|book it|go ahead|looks good|sounds good|that's correct|that's right|all sound right|sounds right)\b/i.test(userText));

  if (isAffirmativeConfirmation) {
    const ticketId = updatedSession.ticketId || generateTicketId(referenceDate);
    updatedSession.ticketId = ticketId;
    updatedSession.state = "CLOSED";
    updatedSession.finalizationStatus = "COMPLETE";

    const spokenTicket = ticketId.replace(/-/g, " ");
    const wrapUpScript = `Perfect. Your appointment is confirmed under Ticket #${spokenTicket}. I've just triggered a confirmation text to your phone, and our team will text you 2 hours before arrival to ensure you're home. Thank you for choosing ${businessName}, have a wonderful day!`;

    updatedSession.conversationHistory.push({ role: "REGENT", content: wrapUpScript });

    // Background call conclusion & CRM sync
    const bId = updatedSession.businessId || updatedSession.tenantId || "b0000000-0000-0000-0000-000000000001";
    commitCallConclusion({
      businessId: bId,
      customer: {
        id: updatedSession.customerId || undefined,
        fullName: updatedSession.lead.name?.value || "Valued Customer",
        phoneNumber: updatedSession.lead.phone?.value || "5550000000",
        streetAddress: updatedSession.lead.address?.value || "Service Address",
        isExistingCustomer: false,
      },
      ticket: {
        ticketId,
        serviceCategory: updatedSession.trade || "HVAC",
        reportedIssue: updatedSession.lead.problem?.value || "Service intake",
        scheduledDate: referenceDate.toISOString().split("T")[0],
        arrivalWindow: "08:00 AM - 12:00 PM",
        status: "Confirmed",
        fullName: updatedSession.lead.name?.value || "Valued Customer",
        phoneNumber: updatedSession.lead.phone?.value || "5550000000",
        fullAddress: updatedSession.lead.address?.value || "Service Address",
        customerStatus: "New Customer",
        priority: "Normal",
        mood: "Neutral",
        callerStyle: "Calm",
        contextSummary: "Service booking intake",
        contextOfCall: "Service booking intake",
      },
      callRecord: {
        ticketId,
        customerMobile: updatedSession.lead.phone?.value || "5550000000",
        callTranscript: updatedSession.conversationHistory.map((h) => `${h.role}: ${h.content}`).join("\n"),
        callType: "standard_booking",
        callerMood: "Neutral",
        callerStyle: "Calm",
        customerStatus: "New Customer",
        priority: "Normal",
        summaryForBusinessOwner: `Booking confirmed for ${updatedSession.lead.name?.value || "Customer"}`,
        actionRequiredByTeam: `Dispatch technician for confirmed ticket #${ticketId}`,
        smsConfirmationSent: true,
      },
    }).catch(console.error);
    executeEndCallConclusionHook(updatedSession, referenceDate).catch(console.error);

    return {
      response: wrapUpScript,
      session: updatedSession,
      shouldTransfer: false,
      complete: true,
      state: "CLOSED",
      missingFields: [],
      safety: { status: "NORMAL", category: null, confidence: 1.0 },
      currentAction: "CLOSE_CALL",
      targetField: null,
      diagnosticReason: "Customer explicitly confirmed booking details — appointment finalized and call ended",
      sentimentState: "warm",
      callerStyle: updatedSession.callerStyle || "neutral",
      toolCalls: [
        {
          id: "end_call_" + Date.now(),
          name: "end_call",
          type: "function",
          function: {
            name: "end_call",
            arguments: JSON.stringify({ reason: "booking_confirmed", ticket_id: ticketId }),
          },
        },
      ],
    };
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

  // Date/Time components
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
    timingStatusStr = `${currentTiming} (VALID - Exact date and arrival window resolved)`;
  } else if (timingStatus === "CAPTURED") {
    timingStatusStr = `${currentTiming} (CAPTURED - Date known, now prompt customer for Arrival Window: Morning 9-12 or Afternoon 1-4)`;
  } else if (timingStatus === "AMBIGUOUS") {
    timingStatusStr = `${currentTiming} (AMBIGUOUS - Clarify: "${
      updatedSession.lead.timing?.validationReason ||
      "Do you mean today, or next week Wednesday?"
    }")`;
  }

  // Dynamic Tenant Rules Prompt Injection
  const coveredZips =
    tenant.coveredZipCodes && tenant.coveredZipCodes.length > 0
      ? tenant.coveredZipCodes.join(", ")
      : "75001, 75002, 75201, 75202, 75204, 76101, 76102, 78701, 78702, 78703, 78704, 78705";

  const tenantRulesPrompt = `MULTI-TENANT BUSINESS PROFILE & RULES:
- Business Name: ${businessName}
- AI Agent Name: ${aiAgentName}
- Covered Service ZIP Codes: ${coveredZips}. We only service these ZIP codes. Out of area callers must be politely informed we do not service their ZIP.
- Excluded Services: ${tenant.excludedServices || "We do NOT service commercial properties or refrigeration units."}
- After-Hours Dispatch Fee: ${tenant.afterHoursDispatchFee || "Standard emergency dispatch fee is $150."}`;

  // Inject current collected state summary for Zero-Loop Guarantee
  const stateSummary = `Current Collected State:
- Trade: ${updatedSession.trade || "NOT YET RESOLVED"}
- Request Type: ${updatedSession.requestType || "NOT YET RESOLVED"}
- Primary Service: ${updatedSession.primaryService || "NOT YET RESOLVED"}
- Urgency: ${updatedSession.lead.urgency?.value || "NORMAL"}
- Full Name: ${updatedSession.lead.name?.value || "NOT YET COLLECTED"}
- Phone: ${phoneStatusStr}
- Address: ${addressStatusStr}
- Issue: ${updatedSession.lead.problem?.value || "NOT YET COLLECTED"}
- Schedule / Preferred Date & Window: ${timingStatusStr}
- Today's Date & Weekday (US Timezone): ${usTodayFormatted} (STRICT: If user mentions "today", use strictly ${usTodayFormatted})
- Operating Hours: Mon-Fri 8:00 AM - 6:00 PM, Sat 9:00 AM - 2:00 PM, Sun Closed
- Customer Mood / Sentiment: ${
    updatedSession.moodDiagnostics?.sentimentTag?.toUpperCase() || "NEUTRAL"
  }${
    updatedSession.moodDiagnostics?.whyCustomerIsUpset
      ? ` (Note: ${updatedSession.moodDiagnostics.whyCustomerIsUpset})`
      : ""
  }
- Out-of-Scope (OOS) Strike Count: ${updatedSession.oos_strike_count || 0}
- Recording Consent Given: YES (Delivered deterministically on Turn 0)`;

  // FIX 3: Temporal Anchor Injection at the top of System Prompt
  const tenantTz = tenant.timezone || "America/New_York";
  const dayOfWeek = new Intl.DateTimeFormat("en-US", {
    timeZone: tenantTz,
    weekday: "long",
  }).format(referenceDate);
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: tenantTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(referenceDate);
  const timeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tenantTz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(referenceDate);
  const masterSystemPrompt = getMasterSystemPrompt(
    tenant,
    businessName,
    aiAgentName,
    referenceDate,
    updatedSession
  );

  const llmMessages: any[] = [
    { role: "system", content: masterSystemPrompt },
  ];

  for (let i = 0; i < updatedSession.conversationHistory.length; i++) {
    const turn = updatedSession.conversationHistory[i];
    // Barge-in injection: if user interrupted previous assistant utterance, inject note right before latest user turn
    if (
      request.isInterrupted &&
      i === updatedSession.conversationHistory.length - 1 &&
      turn.role === "CUSTOMER"
    ) {
      llmMessages.push({
        role: "system",
        content: "[System: User interrupted your previous message to provide a correction or update. Naturally acknowledge their update (e.g. 'Got it, updated that — ' or 'No problem, changed to [detail] — ') and smoothly continue with the next logical scheduling question. Never repeat your previous message.]",
      });
    }
    if (turn.role === "CUSTOMER") {
      llmMessages.push({ role: "user", content: turn.content });
    } else {
      llmMessages.push({ role: "assistant", content: turn.content });
    }
  }

  if (
    request.isInterrupted &&
    !llmMessages.some((m) => m.content.includes("User interrupted your previous message"))
  ) {
    llmMessages.push({
      role: "system",
      content: "[System: User interrupted your previous message to provide a correction or update. Naturally acknowledge their update (e.g. 'Got it, updated that — ' or 'No problem, changed to [detail] — ') and smoothly continue with the next logical scheduling question. Never repeat your previous message.]",
    });
  }

  let spokenReply = "";
  let isCallComplete = false;
  let assistantMsg: any = null;

  // FIX 3: Pre-generate ticket ID when all 5 fields are collected, BEFORE the LLM call.
  // This lets the LLM speak the real TKT-YYYYMMDD-XXXX ID in its confirmation sentence.
  const allFieldsReadyForTicket = Boolean(
    updatedSession.lead.name?.status === "VALID" &&
    updatedSession.lead.phone?.status === "VALID" &&
    updatedSession.lead.address?.status === "VALID" &&
    updatedSession.lead.problem?.status === "VALID" &&
    updatedSession.lead.timing?.status === "VALID"
  );
  // Only inject ticket wrap-up instruction if the customer has explicitly confirmed
  if (updatedSession.state === "CONFIRMED" || updatedSession.state === "CLOSED") {
    if (!updatedSession.ticketId) {
      updatedSession.ticketId = generateTicketId(referenceDate);
    }
    const cleanTicket = updatedSession.ticketId.replace(/-/g, " ");
    llmMessages.push({
      role: "system",
      content: `[SYSTEM: Customer has confirmed all booking details. The confirmed Ticket ID is ${cleanTicket}. ` +
        `Your wrap-up MUST follow this format: ` +
        `"Perfect, [First Name]. Your appointment is confirmed under Ticket #${cleanTicket}. ` +
        `I've just triggered a confirmation SMS to your phone, and our team will text you 2 hours before arrival ` +
        `to ensure you're home. Thank you for choosing ${businessName}, have a wonderful day!" ` +
        `Then immediately call end_call().]`,
    });
  } else if (allFieldsReadyForTicket) {
    updatedSession.state = "READY_FOR_CONFIRMATION";
  }

  try {
    assistantMsg = await callChatCompletion(llmMessages);

    // ── 3. Handle Tool Calls (Quiet Background Extraction & Validation) ─────────
    const validationErrors: string[] = [];

    if (assistantMsg?.tool_calls && assistantMsg.tool_calls.length > 0) {
      for (const tc of assistantMsg.tool_calls) {
        // ── query_business_faq: FAQ interrupt — answer caller's question, then pivot back to objective ──
        if (tc.function?.name === "query_business_faq") {
          try {
            const args = JSON.parse(tc.function.arguments || "{}");
            const question = (args.question || "").toLowerCase();
            const faq = tenant.faq || {};

            // Fuzzy slug match: "dispatch fee" → matches key "dispatch_fee"
            const matchEntry = Object.entries(faq).find(([key]) => {
              const readable = key.replace(/_/g, " ");
              return question.includes(readable) || readable.includes(question.split(" ").slice(0, 2).join(" "));
            });

            const toolResult = matchEntry
              ? {
                  status: "found",
                  answer: matchEntry[1],
                  pivot_instruction:
                    "Answer the customer's question naturally using the answer above, then immediately pivot back to the Current Objective.",
                }
              : {
                  status: "not_found",
                  answer: null,
                  pivot_instruction:
                    "Say: \"I don't have that info right in front of me, but I can have a manager get back to you on that.\" Then immediately pivot back to the Current Objective.",
                };

            const followUpForFaq = [
              ...llmMessages,
              assistantMsg,
              {
                role: "tool",
                tool_call_id: tc.id,
                name: "query_business_faq",
                content: JSON.stringify(toolResult),
              },
            ];
            assistantMsg = await callChatCompletion(followUpForFaq);
          } catch (faqErr) {
            console.error("[RelagentEngine] Error in query_business_faq handler:", faqErr);
          }
        }

        if (tc.function?.name === "handle_out_of_scope") {
          const oos = handleDeterministicOOS(
            updatedSession,
            businessName,
            tenant.tenantId,
            session.callerPhone
          );
          updatedSession.conversationHistory.push({
            role: "REGENT",
            content: oos.response,
          });

          return {
            response: oos.response,
            session: updatedSession,
            shouldTransfer: false,
            complete: oos.complete,
            state: updatedSession.state,
            missingFields: updatedSession.missingFields,
            safety: { status: "NORMAL", category: null, confidence: 1.0 },
            currentAction: oos.complete ? "CLOSE_CALL" : "ANSWER_QUESTION",
            targetField: null,
            diagnosticReason: `Deterministic OOS Strike ${oos.strikeCount} Enforced via Tool`,
            sentimentState: oos.sentimentState,
            callerStyle: updatedSession.callerStyle || "neutral",
          };
        }

        // FIX 2: lookup_customer tool handler
        if (tc.function?.name === "lookup_customer") {
          try {
            const args = JSON.parse(tc.function.arguments || "{}");
            const queryValue: string = args.search_value || args.phone_or_ticket_id || "";
            if (queryValue) {
              const bId = updatedSession.businessId || updatedSession.tenantId || "b0000000-0000-0000-0000-000000000001";
              const lookupResult = await lookupCustomer(bId, queryValue);

              // Build tool result message for LLM context
              let toolResultContent: string;
              if (lookupResult.found) {
                toolResultContent = JSON.stringify({
                  status: "found",
                  name: lookupResult.name,
                  phone: lookupResult.phone,
                  address: lookupResult.address,
                  last_issue: lookupResult.lastIssue,
                  last_ticket_id: lookupResult.lastTicketId,
                  last_scheduled_date: lookupResult.lastScheduledDate,
                  instruction: `Customer found. Pre-fill: name='${lookupResult.name}', address='${lookupResult.address}', last issue='${lookupResult.lastIssue}'. Say: "I see we have you at ${lookupResult.address} and we last worked on your ${lookupResult.lastIssue}. Is this service for the same address?" Do NOT re-ask for any data already found.`,
                });

                // Hydrate session with found data
                if (lookupResult.customerId) updatedSession.customerId = lookupResult.customerId;
                if (lookupResult.name && !updatedSession.lead.name?.value) {
                  updatedSession.lead.name = { value: lookupResult.name, status: "VALID", confidence: 0.95, sourceTurn: updatedSession.turnCount, updatedTurn: updatedSession.turnCount, turn: updatedSession.turnCount };
                }
                if (lookupResult.phone && !updatedSession.lead.phone?.value) {
                  const cleanPh = lookupResult.phone.replace(/\D/g, "").slice(-10);
                  if (cleanPh.length === 10) {
                    updatedSession.lead.phone = { value: cleanPh, status: "VALID", confidence: 1.0, sourceTurn: updatedSession.turnCount, updatedTurn: updatedSession.turnCount, turn: updatedSession.turnCount };
                  }
                }
                if (lookupResult.address && (!updatedSession.lead.address?.value || updatedSession.lead.address.status !== "VALID")) {
                  updatedSession.lead.address = { value: lookupResult.address, status: "VALID", confidence: 1.0, sourceTurn: updatedSession.turnCount, updatedTurn: updatedSession.turnCount, turn: updatedSession.turnCount };
                }
                updatedSession.returningCustomer = true;
                updatedSession.lookupStatus = "FOUND";
                updatedSession.lookupData = lookupResult;
              } else {
                toolResultContent = JSON.stringify({
                  status: "not_found",
                  instruction: "Customer not found in CRM. Warmly acknowledge it and proceed with the standard new-customer collection flow.",
                });
                updatedSession.lookupStatus = "NOT_FOUND";
              }

              // Inject tool result back so the LLM can use it
              if (!assistantMsg.tool_calls) assistantMsg.tool_calls = [];
              const followUpForLookup = [
                ...llmMessages,
                assistantMsg,
                {
                  role: "tool",
                  tool_call_id: tc.id,
                  name: "lookup_customer",
                  content: toolResultContent,
                },
              ];
              assistantMsg = await callChatCompletion(followUpForLookup);
            }
          } catch (lookupErr) {
            console.error("[RelagentEngine] Error in lookup_customer handler:", lookupErr);
          }
        }

        // Two-Step Ticket Sync: finalize_booking tool handler
        if (tc.function?.name === "finalize_booking") {
          try {
            const args = JSON.parse(tc.function.arguments || "{}");
            const rawFullName = (args.full_name || updatedSession.lead.name?.value || "").trim();
            const nameParts = rawFullName.split(/\s+/).filter(Boolean);

            // VALIDATION 1: Full Name (must have at least first & last name and not be a placeholder/filler)
            const isNameFiller = /\b(water|cooler|facing|actually|problem|issue|service|apex|heating|customer|appointment|nobody|valued)\b/i.test(rawFullName);
            if (nameParts.length < 2 || isNameFiller) {
              const firstName = nameParts[0] && !isNameFiller ? nameParts[0] : "there";
              if (!assistantMsg.tool_calls) assistantMsg.tool_calls = [];
              const followUpForNameRejection = [
                ...llmMessages,
                assistantMsg,
                {
                  role: "tool",
                  tool_call_id: tc.id,
                  name: "finalize_booking",
                  content: JSON.stringify({
                    status: "error",
                    code: "VALIDATION_FAILED",
                    missing_field: "full_name",
                    error: `Missing or invalid full name. Both First and Last name are strictly required. You provided '${rawFullName}'. You MUST ask the customer for their valid first and last name before booking can be finalized.`,
                  }),
                },
                {
                  role: "system",
                  content: `[SYSTEM ERROR: Booking rejected because full name is incomplete or invalid ('${rawFullName}'). You MUST naturally ask: "Got it, ${firstName}. And what is your last name?" Do NOT finalize until you have both first and last name.]`,
                },
              ];
              assistantMsg = await callChatCompletion(followUpForNameRejection);
              break;
            }

            // VALIDATION 2: Phone Number (must be exactly 10 digits and not all identical)
            const cleanPhone = (args.phone_number || updatedSession.lead.phone?.value || "").replace(/\D/g, "").slice(-10);
            const isInvalidPhone = cleanPhone.length !== 10 || cleanPhone === cleanPhone[0].repeat(10);
            if (isInvalidPhone) {
              if (!assistantMsg.tool_calls) assistantMsg.tool_calls = [];
              const followUpForPhoneRejection = [
                ...llmMessages,
                assistantMsg,
                {
                  role: "tool",
                  tool_call_id: tc.id,
                  name: "finalize_booking",
                  content: JSON.stringify({
                    status: "error",
                    code: "VALIDATION_FAILED",
                    missing_field: "phone_number",
                    error: `Invalid or incomplete phone number ('${args.phone_number || cleanPhone}'). A complete 10-digit phone number is strictly required before booking can be finalized. Ask the customer for their valid 10-digit phone number.`,
                  }),
                },
                {
                  role: "system",
                  content: `[SYSTEM ERROR: Booking rejected because phone number is invalid or incomplete. You MUST ask: "Could you confirm your complete 10-digit phone number?" Do NOT finalize until you have a valid 10-digit phone number.]`,
                },
              ];
              assistantMsg = await callChatCompletion(followUpForPhoneRejection);
              break;
            }

            // VALIDATION 3: Address & Covered ZIP (must include street, city, 5-digit zip code in service area)
            const rawAddress = (args.full_address || updatedSession.lead.address?.value || "").trim();
            const addrParts = parseAddressString(rawAddress);
            const isZipCovered = addrParts.zip && tenant.coveredZipCodes && tenant.coveredZipCodes.length > 0
              ? tenant.coveredZipCodes.includes(addrParts.zip)
              : Boolean(addrParts.zip);

            if (!addrParts.street || !addrParts.city || !addrParts.zip || !isZipCovered) {
              const missingParts = [
                !addrParts.street ? "street address (number and street)" : null,
                !addrParts.city ? "city" : null,
                !addrParts.zip ? "5-digit zip code" : null,
                !isZipCovered && addrParts.zip ? `covered zip code (${addrParts.zip} is outside our service area)` : null,
              ].filter(Boolean).join(", ");

              if (!assistantMsg.tool_calls) assistantMsg.tool_calls = [];
              const followUpForAddrRejection = [
                ...llmMessages,
                assistantMsg,
                {
                  role: "tool",
                  tool_call_id: tc.id,
                  name: "finalize_booking",
                  content: JSON.stringify({
                    status: "error",
                    code: "VALIDATION_FAILED",
                    missing_field: "full_address",
                    error: `Address is incomplete or invalid. Missing: ${missingParts}. Complete street address, city, and a covered zip code are strictly required before booking can be finalized.`,
                  }),
                },
                {
                  role: "system",
                  content: `[SYSTEM ERROR: Booking rejected because service address is incomplete or outside our service area (Missing: ${missingParts}). You MUST ask the customer for the missing/valid address details before finalizing.]`,
                },
              ];
              assistantMsg = await callChatCompletion(followUpForAddrRejection);
              break;
            }

            // VALIDATION 4: Issue Description (must be authentic and descriptive)
            const rawIssue = (args.issue_description || updatedSession.lead.problem?.value || "").trim();
            if (!rawIssue || rawIssue.length < 4 || /^(help|service|repair|problem|issue|something|broken|check)$/i.test(rawIssue)) {
              if (!assistantMsg.tool_calls) assistantMsg.tool_calls = [];
              const followUpForIssueRejection = [
                ...llmMessages,
                assistantMsg,
                {
                  role: "tool",
                  tool_call_id: tc.id,
                  name: "finalize_booking",
                  content: JSON.stringify({
                    status: "error",
                    code: "VALIDATION_FAILED",
                    missing_field: "issue_description",
                    error: `Issue description is incomplete. Please specify what equipment or appliance is having an issue and the symptoms before finalizing.`,
                  }),
                },
                {
                  role: "system",
                  content: `[SYSTEM ERROR: Booking rejected because the issue description is incomplete. Ask the customer what is going on with their equipment so the technician can be prepared.]`,
                },
              ];
              assistantMsg = await callChatCompletion(followUpForIssueRejection);
              break;
            }

            // VALIDATION 5: Scheduled Date and Arrival Window
            const rawDate = (args.scheduled_date || "").trim();
            const rawWindow = (args.arrival_window || "").trim();
            const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate);
            const isValidWindow = /08:00\s*AM\s*-\s*12:00\s*PM|01:00\s*PM\s*-\s*05:00\s*PM|After\s*Hours\s*Emergency/i.test(rawWindow);

            if (!isValidDate || !isValidWindow) {
              if (!assistantMsg.tool_calls) assistantMsg.tool_calls = [];
              const followUpForTimingRejection = [
                ...llmMessages,
                assistantMsg,
                {
                  role: "tool",
                  tool_call_id: tc.id,
                  name: "finalize_booking",
                  content: JSON.stringify({
                    status: "error",
                    code: "VALIDATION_FAILED",
                    missing_field: "scheduled_date_or_window",
                    error: `Booking requires an exact date (YYYY-MM-DD) and a standard arrival window ("08:00 AM - 12:00 PM" or "01:00 PM - 05:00 PM").`,
                  }),
                },
                {
                  role: "system",
                  content: `[SYSTEM ERROR: Booking rejected because the appointment date or time window is missing or incomplete. Ask the customer what date and arrival window works best for them.]`,
                },
              ];
              assistantMsg = await callChatCompletion(followUpForTimingRejection);
              break;
            }

            const finalPhone = cleanPhone;

            // Update session state with verified, complete data
            updatedSession.lead.phone = {
              value: cleanPhone,
              status: "VALID",
              confidence: 1.0,
              sourceTurn: updatedSession.turnCount,
              updatedTurn: updatedSession.turnCount,
              turn: updatedSession.turnCount,
              validationReason: "Strictly verified 10-digit phone via finalize_booking",
            };
            updatedSession.lead.name = {
              value: rawFullName,
              status: "VALID",
              confidence: 1.0,
              sourceTurn: updatedSession.turnCount,
              updatedTurn: updatedSession.turnCount,
              turn: updatedSession.turnCount,
              validationReason: "Strictly verified full name via finalize_booking",
            };
            updatedSession.lead.address = {
              value: `${addrParts.street}, ${addrParts.city} ${addrParts.zip}`,
              status: "VALID",
              confidence: 1.0,
              sourceTurn: updatedSession.turnCount,
              updatedTurn: updatedSession.turnCount,
              turn: updatedSession.turnCount,
              validationReason: "Strictly verified address and covered zip via finalize_booking",
            };
            updatedSession.lead.problem = {
              value: rawIssue,
              status: "VALID",
              confidence: 1.0,
              sourceTurn: updatedSession.turnCount,
              updatedTurn: updatedSession.turnCount,
              turn: updatedSession.turnCount,
              validationReason: "Strictly verified issue description via finalize_booking",
            };
            updatedSession.lead.timing = {
              value: `${rawDate} (${rawWindow})`,
              status: "VALID",
              confidence: 1.0,
              sourceTurn: updatedSession.turnCount,
              updatedTurn: updatedSession.turnCount,
              turn: updatedSession.turnCount,
              validationReason: "Strictly verified date and arrival window via finalize_booking",
            };

            const ticketId = updatedSession.ticketId || generateTicketId(referenceDate);
            updatedSession.ticketId = ticketId;
            updatedSession.state = "CONFIRMED";

            const bId = updatedSession.businessId || updatedSession.tenantId || "b0000000-0000-0000-0000-000000000001";

            await commitCallConclusion({
              businessId: bId,
              customer: {
                id: updatedSession.customerId || undefined,
                fullName: rawFullName,
                phoneNumber: finalPhone,
                streetAddress: args.full_address || updatedSession.lead.address?.value || "Pending Address",
                isExistingCustomer: args.customer_status === "Existing Customer",
              },
              ticket: {
                ticketId,
                serviceCategory: updatedSession.trade || "HVAC",
                reportedIssue: args.issue_description || updatedSession.lead.problem?.value || "Service intake",
                scheduledDate: args.scheduled_date || referenceDate.toISOString().split("T")[0],
                arrivalWindow: args.arrival_window || "08:00 AM - 12:00 PM",
                status: "Confirmed",
                fullName: rawFullName,
                phoneNumber: finalPhone,
                fullAddress: args.full_address || updatedSession.lead.address?.value || "Pending Address",
                customerStatus: args.customer_status || "New Customer",
                priority: args.priority || "Normal",
                mood: args.mood || "Neutral",
                callerStyle: args.caller_style || "Calm",
                contextSummary: args.context_of_call || "Service booking intake",
                contextOfCall: args.context_of_call || "Service booking intake",
              },
              callRecord: {
                ticketId,
                customerMobile: cleanPhone,
                callTranscript: updatedSession.conversationHistory.map((h) => `${h.role}: ${h.content}`).join("\n"),
                callType: args.priority?.includes("Emergency") ? "emergency" : "standard_booking",
                callerMood: args.mood || "Neutral",
                callerStyle: args.caller_style || "Calm",
                customerStatus: args.customer_status || "New Customer",
                priority: args.priority || "Normal",
                summaryForBusinessOwner: args.context_of_call || `Booking confirmed for ${args.full_name}`,
                actionRequiredByTeam: `Dispatch technician for arrival window ${args.arrival_window || "08:00 AM - 12:00 PM"}`,
                smsConfirmationSent: true,
              },
            });

            const spokenTicket = ticketId.replace(/-/g, " ");
            const wrapUpScript = `Perfect. Your appointment is confirmed under Ticket #${spokenTicket}. I've just triggered a confirmation text to your phone, and our team will text you 2 hours before arrival to ensure you're home. Thank you for choosing ${businessName}, have a wonderful day!`;

            isCallComplete = true;
            updatedSession.state = "CLOSED";
            updatedSession.finalizationStatus = "COMPLETE";
            spokenReply = wrapUpScript;

            assistantMsg = {
              role: "assistant",
              content: wrapUpScript,
              tool_calls: [
                {
                  id: "end_call_" + Date.now(),
                  type: "function",
                  function: {
                    name: "end_call",
                    arguments: JSON.stringify({ reason: "booking_confirmed" }),
                  },
                },
              ],
            };
            executeEndCallConclusionHook(updatedSession, referenceDate).catch(console.error);
          } catch (finalizeErr) {
            console.error("[RelagentEngine] Error in finalize_booking handler:", finalizeErr);
          }
        }
        if (tc.function?.name === "transfer_to_human") {
          updatedSession.state = "ESCALATED";
          const customerPhone = updatedSession.lead.phone?.value || session.callerPhone || "5550000000";
          const customerName = updatedSession.lead.name?.value || "Caller";
          commitCallConclusion({
            customer: {
              tenantId: tenant.tenantId,
              fullLegalName: customerName,
              firstName: customerName.split(" ")[0],
              mobileNumber: customerPhone,
              serviceAddress: updatedSession.lead.address?.value || "Transfer address pending",
              city: "Austin",
              postalCode: "78701",
            },
            callRecord: {
              tenantId: tenant.tenantId,
              customerMobile: customerPhone,
              callerMood: updatedSession.moodDiagnostics.sentimentTag === "angry" ? "angry" : "neutral",
              whyCustomerIsUpset: updatedSession.moodDiagnostics.whyCustomerIsUpset || "Customer requested live representative.",
              summaryForBusinessOwner: "Caller requested immediate transfer to live staff.",
              actionRequiredByTeam: "Priority live human answer / callback.",
              callTranscript: updatedSession.conversationHistory.map((h) => `${h.role}: ${h.content}`).join("\n"),
              smsConfirmationSent: false,
              callType: "human_escalation",
            },
          }).catch(console.error);

          const reply = "Absolutely, let me get you connected right now. Please hold for just a moment while I transfer you.";
          updatedSession.conversationHistory.push({ role: "REGENT", content: reply });
          return {
            response: reply,
            session: updatedSession,
            shouldTransfer: true,
            complete: true,
            state: "ESCALATED",
            missingFields: updatedSession.missingFields,
            safety: { status: "NORMAL", category: null, confidence: 1.0 },
            currentAction: "HANDLE_HUMAN_REQUEST",
            targetField: null,
            diagnosticReason: "Caller requested live representative (transfer_to_human tool called)",
            sentimentState: "empathetic",
            callerStyle: updatedSession.callerStyle || "neutral",
          };
        }
        if (tc.function?.name === "flag_emergency") {
          updatedSession.state = "ESCALATED";
          const customerPhone = updatedSession.lead.phone?.value || session.callerPhone || "5550000000";
          const customerName = updatedSession.lead.name?.value || "Emergency Caller";
          commitCallConclusion({
            customer: {
              tenantId: tenant.tenantId,
              fullLegalName: customerName,
              firstName: customerName.split(" ")[0],
              mobileNumber: customerPhone,
              serviceAddress: updatedSession.lead.address?.value || "Emergency address",
              city: "Austin",
              postalCode: "78701",
            },
            callRecord: {
              tenantId: tenant.tenantId,
              customerMobile: customerPhone,
              callerMood: "angry",
              whyCustomerIsUpset: "Emergency safety condition triggered",
              summaryForBusinessOwner: "EMERGENCY SAFETY TRIGGERED: Immediate on-call dispatch alert.",
              actionRequiredByTeam: "Immediate dispatch alert / safety verification.",
              callTranscript: updatedSession.conversationHistory.map((h) => `${h.role}: ${h.content}`).join("\n"),
              smsConfirmationSent: false,
              callType: "emergency",
            },
          }).catch(console.error);

          const reply = "This sounds very dangerous. Please evacuate to a safe area and call 911 immediately. I am alerting our emergency dispatch now.";
          updatedSession.conversationHistory.push({ role: "REGENT", content: reply });
          return {
            response: reply,
            session: updatedSession,
            shouldTransfer: true,
            complete: true,
            state: "ESCALATED",
            missingFields: updatedSession.missingFields,
            safety: { status: "CRITICAL", category: "SAFETY", confidence: 1.0 },
            currentAction: "ESCALATE_SAFETY",
            targetField: null,
            diagnosticReason: "Emergency safety condition flagged (flag_emergency tool called)",
            sentimentState: "urgent",
            callerStyle: "angry_frustrated",
          };
        }
        if (tc.function?.name === "end_call") {
          isCallComplete = true;
          updatedSession.state = "CLOSED";
          updatedSession.finalizationStatus = "COMPLETE";
          await executeEndCallConclusionHook(updatedSession, referenceDate);
        }
        if (tc.function?.name === "extract_customer_info" || tc.function?.name === "save_customer_info") {
          try {
            const args: ExtractedEntities = JSON.parse(tc.function.arguments);

            // Name: Support full names as well as partial slot updates (e.g. "Ayush" -> then "Raj" -> "Ayush Raj")
            if (args.full_name) {
              const inputName = args.full_name.trim();
              const existingName = updatedSession.lead.name?.value?.trim() || "";
              const nameParts = inputName.split(/\s+/).filter(Boolean);

              if (nameParts.length >= 2) {
                // Complete full name provided
                updatedSession.lead.name = {
                  value: inputName,
                  status: "VALID",
                  confidence: 0.95,
                  sourceTurn: updatedSession.lead.name?.sourceTurn || updatedSession.turnCount,
                  updatedTurn: updatedSession.turnCount,
                  turn: updatedSession.turnCount,
                };
              } else if (nameParts.length === 1) {
                if (existingName && !existingName.toLowerCase().includes(inputName.toLowerCase())) {
                  // Partial slot update: append new name piece to existing name! (e.g. "Ayush" + "Raj" = "Ayush Raj")
                  const combined = `${existingName} ${inputName}`.trim();
                  const combinedParts = combined.split(/\s+/).filter(Boolean);
                  const isValid = combinedParts.length >= 2;
                  updatedSession.lead.name = {
                    value: combined,
                    status: isValid ? "VALID" : "CAPTURED",
                    confidence: isValid ? 0.95 : 0.7,
                    sourceTurn: updatedSession.lead.name?.sourceTurn || updatedSession.turnCount,
                    updatedTurn: updatedSession.turnCount,
                    turn: updatedSession.turnCount,
                    validationReason: isValid ? "Complete full name (combined)" : "Partial name captured",
                  };
                } else {
                  // First partial name captured (e.g. "Ayush")
                  updatedSession.lead.name = {
                    value: inputName,
                    status: "CAPTURED",
                    confidence: 0.7,
                    sourceTurn: updatedSession.lead.name?.sourceTurn || updatedSession.turnCount,
                    updatedTurn: updatedSession.turnCount,
                    turn: updatedSession.turnCount,
                    validationReason: "First name captured, awaiting last name",
                  };
                  validationErrors.push(
                    `[System Error: Captured first name '${inputName}'. Ask naturally for their last name to complete the full name.]`
                  );
                }
              }
            }

            // Issue Description & Service Classification
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

            // Infer Trade if not already known
            const candidateText = args.issue_description || userText;
            if (!updatedSession.trade && candidateText) {
              const inferred = inferTrade(candidateText);
              if (inferred) updatedSession.trade = inferred as Trade;
            }

            // Canonicalize Request Type (e.g. INSTALLATION, REPAIR, MAINTENANCE)
            const resolvedRequestType = canonicalizeRequestType(args.request_type, candidateText);
            if (resolvedRequestType) {
              updatedSession.requestType = resolvedRequestType;
            }

            // Canonicalize Primary Service (e.g. AC_INSTALLATION)
            const resolvedService = canonicalizeService(
              args.service,
              updatedSession.trade,
              updatedSession.requestType,
              candidateText
            );
            if (resolvedService.serviceId) {
              updatedSession.primaryService = resolvedService.serviceId;
            }

            // Resolve Urgency
            const isHighUrgency = /\b(emergency|urgent|asap|leak|burst|flood|smoke|fire|sparks|no heat|freezing|water pouring)\b/i.test(candidateText);
            const urgencyVal = isHighUrgency ? "HIGH" : (args.urgency?.toUpperCase() || "NORMAL");
            updatedSession.lead.urgency = {
              value: urgencyVal,
              status: "VALID",
              confidence: 0.9,
              sourceTurn: updatedSession.turnCount,
              updatedTurn: updatedSession.turnCount,
              turn: updatedSession.turnCount,
              validationReason: `Classified urgency: ${urgencyVal}`,
            };

            // Phone Validation Engine: MUST be exactly 10 digits
            const rawPhone = args.phone_number || args.phone_digits || args.phone || "";
            const inputDigits = rawPhone.replace(/\D/g, "");
            const inputAreaCode = (args.area_code || "").replace(/\D/g, "");

            let currentDigits = (updatedSession.lead.phone?.value || "").replace(/\D/g, "");

            if (inputDigits.length === 10) {
              currentDigits = inputDigits;
            } else if (inputDigits.length > 0) {
              if (currentDigits.length > 0 && currentDigits.length < 10) {
                if (inputDigits.length === 3 && currentDigits.length === 7) {
                  currentDigits = inputDigits + currentDigits;
                } else if (currentDigits.length === 3 && inputDigits.length === 7) {
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

            if (currentDigits.length === 10) {
              updatedSession.lead.phone = {
                value: currentDigits,
                status: "VALID",
                confidence: 1.0,
                sourceTurn: updatedSession.turnCount,
                updatedTurn: updatedSession.turnCount,
                turn: updatedSession.turnCount,
                validationReason: "Complete 10-digit phone",
              };
            } else if (currentDigits.length > 0) {
              // Reject: MUST NOT save partial / invalid phone numbers
              if (updatedSession.lead.phone?.status !== "VALID") {
                updatedSession.lead.phone = {
                  value: null,
                  status: "INVALID",
                  confidence: 0,
                  sourceTurn: updatedSession.turnCount,
                  updatedTurn: updatedSession.turnCount,
                  turn: updatedSession.turnCount,
                  validationReason: `Rejected: Only ${currentDigits.length} digits provided (requires 10 digits)`,
                };
              }
              validationErrors.push(
                `[System Error: Phone number must be 10 digits. Ask user for remaining digits.]`
              );
            }

            // Address Validation Engine
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

            if (!addrCity && addrZip) {
              if (addrZip.startsWith("787")) addrCity = "Austin";
              else if (addrZip.startsWith("750") || addrZip.startsWith("752")) addrCity = "Dallas";
              else if (addrZip.startsWith("761")) addrCity = "Fort Worth";
              else addrCity = "Austin";
            }

            const addressPartsPresent = [addrStreet, addrCity, addrZip].filter(Boolean);
            if (addressPartsPresent.length > 0) {
              const isZipCovered = !addrZip || !tenant.coveredZipCodes || tenant.coveredZipCodes.length === 0 || tenant.coveredZipCodes.includes(addrZip);
              const isAddressValid = Boolean(addrStreet && addrZip && isZipCovered);
              const formattedAddress = isAddressValid
                ? `${addrStreet}, ${addrCity || "Austin"} ${addrZip}`
                : addressPartsPresent.join(", ");

              if (isAddressValid) {
                updatedSession.lead.address = {
                  value: formattedAddress,
                  status: "VALID",
                  confidence: 1.0,
                  sourceTurn: updatedSession.turnCount,
                  updatedTurn: updatedSession.turnCount,
                  turn: updatedSession.turnCount,
                  validationReason: "Complete address (Street, City, Zip)",
                };
              } else {
                if (addrZip && !isZipCovered) {
                  updatedSession.lead.address = {
                    value: formattedAddress,
                    status: "INVALID",
                    confidence: 0,
                    sourceTurn: updatedSession.turnCount,
                    updatedTurn: updatedSession.turnCount,
                    turn: updatedSession.turnCount,
                    validationReason: `Zip code ${addrZip} is outside our service area`,
                  };
                  validationErrors.push(
                    `[System Alert: Zip code ${addrZip} is outside our service area (${coveredZips}). Politely inform caller we do not service ${addrZip}, specify covered areas (Dallas, Fort Worth, Austin), and ask for an address in our service area.]`
                  );
                } else if (addrStreet && !addrZip) {
                  validationErrors.push(
                    `[System Error: Address is missing a Zip Code. Ask explicitly for the Zip Code.]`
                  );
                }
              }
            }

            // STEP 3.1: Customer UPSERT Hook (save_customer_info) — backgrounded for sub-second latency
            if (currentDigits.length === 10) {
              const bId =
                updatedSession.businessId ||
                updatedSession.tenantId ||
                "b0000000-0000-0000-0000-000000000001";
              upsertCustomer(bId, {
                fullName: updatedSession.lead.name?.value || args.full_name || "Valued Customer",
                phoneNumber: currentDigits,
                streetAddress: addrStreet || (updatedSession.lead.address?.value ? parseAddressString(updatedSession.lead.address.value).street : "") || "Pending Address",
                city: addrCity || "Austin",
                zipCode: addrZip || "78701",
              }).then((upsertRes) => {
                if (upsertRes.customerId) {
                  updatedSession.customerId = upsertRes.customerId;
                }
              }).catch((upsertErr) => {
                console.error("[RelagentEngine] Error in Customer UPSERT Hook:", upsertErr);
              });
            }

            // Date & Arrival Window Resolution Engine
            const timeRaw = args.date_time_preference || args.arrival_window;
            if (timeRaw) {
              const outHoursCheck = checkOutsideOperatingHours(timeRaw);
              if (outHoursCheck.isOutside) {
                updatedSession.lead.timing = {
                  value: timeRaw,
                  status: "AMBIGUOUS",
                  confidence: 0.5,
                  sourceTurn: updatedSession.turnCount,
                  updatedTurn: updatedSession.turnCount,
                  turn: updatedSession.turnCount,
                  validationReason: outHoursCheck.responsePrompt,
                };
              } else {
                const existingTiming = updatedSession.lead.timing?.value || "";
                const existingDateMatch = existingTiming.match(/\b(\d{4}-\d{2}-\d{2})\b/);
                const userArrivalWindow = resolveArrivalWindow(timeRaw);

                if (existingDateMatch && userArrivalWindow) {
                  const exactDateStr = existingDateMatch[1];
                  const normalized = `${exactDateStr} (${userArrivalWindow})`;
                  updatedSession.lead.timing = {
                    value: normalized,
                    status: "VALID",
                    confidence: 1.0,
                    sourceTurn: updatedSession.turnCount,
                    updatedTurn: updatedSession.turnCount,
                    turn: updatedSession.turnCount,
                    validationReason: `Resolved to exact date & window: ${normalized}`,
                  };
                } else {
                  const dateRes = resolveDateTime(timeRaw, referenceDate);
                if (dateRes.isOutsideOperatingHours) {
                  updatedSession.lead.timing = {
                    value: timeRaw,
                    status: "AMBIGUOUS",
                    confidence: 0.5,
                    sourceTurn: updatedSession.turnCount,
                    updatedTurn: updatedSession.turnCount,
                    turn: updatedSession.turnCount,
                    validationReason: dateRes.outsideHoursMessage,
                  };
                } else if (dateRes.isAmbiguous) {
                  updatedSession.lead.timing = {
                    value: timeRaw,
                    status: "AMBIGUOUS",
                    confidence: 0.5,
                    sourceTurn: updatedSession.turnCount,
                    updatedTurn: updatedSession.turnCount,
                    turn: updatedSession.turnCount,
                    validationReason: dateRes.clarificationPrompt,
                  };
                } else if (dateRes.isResolved) {
                  const hasWindow = Boolean(dateRes.arrivalWindow || (dateRes.timePreference && dateRes.timePreference.includes(" - ")));
                  const needsWindow = dateRes.needsWindowClarification || !hasWindow;
                  updatedSession.lead.timing = {
                    value: dateRes.normalizedSchedule || dateRes.exactDate || timeRaw,
                    status: needsWindow ? "CAPTURED" : "VALID",
                    confidence: needsWindow ? 0.8 : 1.0,
                    sourceTurn: updatedSession.turnCount,
                    updatedTurn: updatedSession.turnCount,
                    turn: updatedSession.turnCount,
                    validationReason: needsWindow
                      ? dateRes.windowClarificationPrompt
                      : `Resolved to: ${dateRes.normalizedSchedule || dateRes.exactDate}`,
                  };
                }
              }
            }
            }

            // Mood Diagnostics Extraction
            if (args.sentiment_tag) {
              updatedSession.moodDiagnostics.sentimentTag = args.sentiment_tag;
            }
            if (args.why_customer_is_upset) {
              updatedSession.moodDiagnostics.whyCustomerIsUpset = args.why_customer_is_upset;
            }
            if (args.situation_context_notes) {
              updatedSession.moodDiagnostics.situationContextNotes = args.situation_context_notes;
            }
            if (args.recommended_next_action) {
              updatedSession.moodDiagnostics.recommendedNextAction = args.recommended_next_action;
            }

            // Module 5: Emotional Sentiment State & Caller Style Extraction
            if (args.sentiment_state) {
              updatedSession.sentimentState = args.sentiment_state;
            }
            if (args.caller_style) {
              updatedSession.callerStyle = args.caller_style;
            }

            // Dispatch Board Context: Customer Status, Priority, Context Summary
            if (args.customer_status) {
              updatedSession.returningCustomer = args.customer_status === "Existing Customer";
            }
            if (args.context_summary) {
              updatedSession.moodDiagnostics.situationContextNotes = args.context_summary;
            }
            if (args.priority && args.priority.includes("Emergency")) {
              updatedSession.safety = {
                status: "CRITICAL",
                category: "SAFETY",
                confidence: 1.0,
              };
            }
          } catch (e) {
            console.error("[Relagent] Error parsing tool call args:", e);
          }
        }
      }

      // If validation failed or the model produced tool calls without text, feed execution and contextual system errors back
      if (validationErrors.length > 0 || !assistantMsg.content) {
        const followUpMessages = [
          ...llmMessages,
          assistantMsg,
          ...assistantMsg.tool_calls.map((tc: any) => ({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.function.name,
            content: tc.function.name === "end_call"
              ? JSON.stringify({ status: "call_ended", line_disconnected: true })
              : JSON.stringify({
                  status: validationErrors.length > 0 ? "validation_error" : "saved",
                  customer_id: updatedSession.customerId || null,
                  validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
                  phone: updatedSession.lead.phone?.value,
                  phone_status: updatedSession.lead.phone?.status,
                  name: updatedSession.lead.name?.value,
                  name_status: updatedSession.lead.name?.status,
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

        if (validationErrors.length > 0) {
          followUpMessages.push({
            role: "system",
            content: `${validationErrors.join("\n")}\nCRITICAL VALIDATION RULE: Never repeat a question blindly. If you are asking for information a second time, you MUST state exactly why (e.g., "I'm missing a couple of digits from that phone number, could you provide the full 10-digit number?"). Once a piece of information is successfully captured, NEVER ask for it again. Move immediately to the next missing required field.`,
          });
        }

        assistantMsg = await callChatCompletion(followUpMessages);
      }
    }

    // ── Background extraction fallback for corrections during barge-in or normal flow ──
    const isAddressCorrection =
      (request.isInterrupted ||
        /\b(?:change|instead|actually|wrong\s+address|not\s+(?:the\s+)?address|new\s+address|switch|update\s+address)\b/i.test(
          userText
        )) &&
      Boolean(
        userText.match(
          /\b\d{1,5}\s+[A-Za-z0-9\.\s]+(Terrace|Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Way|Lane|Ln|Court|Ct|Circle|Cir)\b/i
        ) ||
          userText.match(/,\s*[A-Za-z\s]+?\s+\d{5}/) ||
          userText.match(/\b\d{5}\b/) ||
          normalizeSpokenDigits(userText).match(/\b\d{5}\b/)
      );

    const hasAddressSignal = Boolean(
      userText.match(
        /\b\d{1,5}\s+[A-Za-z0-9\.\s]+(Terrace|Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Way|Lane|Ln|Court|Ct|Circle|Cir)\b/i
      ) ||
        userText.match(/\b\d{5}\b/) ||
        normalizeSpokenDigits(userText).match(/\b\d{5}\b/) ||
        /\b(dallas|fort worth|austin|houston|san antonio)\b/i.test(userText)
    );

    if ((updatedSession.lead.address?.status !== "VALID" || isAddressCorrection) && hasAddressSignal) {
      const currentAddr = updatedSession.lead.address?.value || "";
      const currentParts = parseAddressString(currentAddr);
      let addrStreet = (isAddressCorrection ? "" : currentParts.street) || existingAddrParts.street || "";
      let addrCity = (isAddressCorrection ? "" : currentParts.city) || existingAddrParts.city || "";
      let addrZip = (isAddressCorrection ? "" : currentParts.zip) || existingAddrParts.zip || "";

      // Parse structured address parts from userText
      const parsedText = parseAddressString(userText);
      if (parsedText.street) addrStreet = parsedText.street;
      if (parsedText.city) addrCity = parsedText.city;
      if (parsedText.zip) addrZip = parsedText.zip;

      const streetMatch = userText.match(
        /\b\d{1,5}\s+[A-Za-z0-9\.\s]+(Terrace|Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Way|Lane|Ln|Court|Ct|Circle|Cir)\b/i
      );
      if (streetMatch) addrStreet = streetMatch[0].trim();

      const normalizedUtterance = normalizeSpokenDigits(userText);
      const zipMatch = userText.match(/\b\d{5}\b/) || normalizedUtterance.match(/\b\d{5}\b/);
      if (zipMatch) addrZip = zipMatch[0];

      const cityMatch = userText.match(
        /(?:ciudad\s+(?:es|de)|city\s+(?:is|of))\s+([A-Za-z\s]+?)(?=\s+(?:y|and|,|\.|$|\d))/i
      );
      if (cityMatch) {
        addrCity = cityMatch[1].trim();
      } else {
        const cityZipMatch = userText.match(/,\s*([A-Za-z\s]+?)(?:\s+\d{5}|\.|$)/);
        if (cityZipMatch && cityZipMatch[1]) {
          const c = cityZipMatch[1].trim().replace(/\.$/, "");
          if (c.length > 2 && !/street|st|ave|road|rd|address|actually|issue|problem|cooler|water/i.test(c)) {
            addrCity = c;
          }
        }
      }

      if (!addrCity && existingAddrParts.city) addrCity = existingAddrParts.city;
      if (!addrZip && existingAddrParts.zip) addrZip = existingAddrParts.zip;

      if (!addrCity && addrZip) {
        if (addrZip.startsWith("787")) addrCity = "Austin";
        else if (addrZip.startsWith("750") || addrZip.startsWith("752")) addrCity = "Dallas";
        else if (addrZip.startsWith("761")) addrCity = "Fort Worth";
        else addrCity = "Austin";
      }

      const addressPartsPresent = [addrStreet, addrCity, addrZip].filter(Boolean);
      if (addressPartsPresent.length > 0) {
        const isZipCovered = !addrZip || !tenant.coveredZipCodes || tenant.coveredZipCodes.length === 0 || tenant.coveredZipCodes.includes(addrZip);
        const isAddressValid = Boolean(addrStreet && addrZip && isZipCovered);
        const isOutOfServiceArea = Boolean(addrZip && !isZipCovered);
        const formattedAddress = isAddressValid
          ? `${addrStreet}, ${addrCity || "Austin"} ${addrZip}`
          : addressPartsPresent.join(", ");

        updatedSession.lead.address = {
          value: formattedAddress,
          status: isAddressValid ? "VALID" : (isOutOfServiceArea ? "INVALID" : "CAPTURED"),
          confidence: isAddressValid ? 1.0 : (isOutOfServiceArea ? 0 : 0.7),
          sourceTurn: updatedSession.turnCount,
          updatedTurn: updatedSession.turnCount,
          turn: updatedSession.turnCount,
          validationReason: isAddressValid
            ? "Complete address (Street, City, Zip)"
            : (isOutOfServiceArea
              ? `Zip code ${addrZip} is outside our service area`
              : `Partial address (Missing: ${[!addrCity ? "City" : null, !addrZip ? "Zip" : null].filter(Boolean).join(", ")})`),
        };
      }
    }

    // Background extraction fallback for Name if not already VALID
    if (updatedSession.lead.name?.status !== "VALID") {
      const nameMatch = userText.match(
        /(?:my\s+(?:full\s+)?name\s+is|this\s+is|call\s+me)\s+([A-Za-z]+(?:\s+[A-Za-z]+)+)/i
      );
      if (nameMatch && nameMatch[1]) {
        const extracted = nameMatch[1].trim();
        const parts = extracted.split(/\s+/).filter(Boolean);
        const isCommonWord = /\b(actually|facing|issue|problem|calling|having|wondering|dealing|trying|water|cooler|here|there|fine|good|okay|sure|sorry|please)\b/i.test(extracted);
        if (parts.length >= 2 && !isCommonWord) {
          updatedSession.lead.name = {
            value: extracted,
            status: "VALID",
            confidence: 0.95,
            sourceTurn: updatedSession.turnCount,
            updatedTurn: updatedSession.turnCount,
            turn: updatedSession.turnCount,
            validationReason: "Deterministic name extraction",
          };
        }
      }
    }

    // Background extraction fallback for Phone if not already VALID
    if (updatedSession.lead.phone?.status !== "VALID") {
      const digits = userText.replace(/\D/g, "");
      if (digits.length === 10) {
        updatedSession.lead.phone = {
          value: digits,
          status: "VALID",
          confidence: 1.0,
          sourceTurn: updatedSession.turnCount,
          updatedTurn: updatedSession.turnCount,
          turn: updatedSession.turnCount,
          validationReason: "Deterministic 10-digit phone extraction",
        };
      }
    }

    // Background extraction fallback for Problem if not already VALID
    if (!updatedSession.lead.problem?.value) {
      if (/\b(water\s+cooler|cooler|ac|air\s+conditioner|heater|heating|furnace|plumbing|leak|faucet|toilet|drain)\b/i.test(userText)) {
        let problemClean = userText
          .replace(/^(?:hi|hello|hey)[,\s]+[A-Za-z]+[,\.\s]*/i, "")
          .replace(/^(?:hi|hello|hey|good\s+morning|good\s+afternoon)[,\.\s]*/i, "")
          .replace(/^(?:i'm\s+actually\s+facing\s+(?:an?\s+)?|i\s+have\s+(?:an?\s+)?|facing\s+(?:an?\s+)?|problem\s+with\s+(?:my\s+)?|issue\s+(?:in|with)\s+(?:my\s+)?)/i, "")
          .trim();
        if (problemClean.length >= 3) {
          updatedSession.lead.problem = {
            value: problemClean,
            status: "VALID",
            confidence: 0.95,
            sourceTurn: updatedSession.turnCount,
            updatedTurn: updatedSession.turnCount,
            turn: updatedSession.turnCount,
            validationReason: "Deterministic problem extraction",
          };
        }
      }
    }

    // Background extraction fallback for timing if not already VALID or if user is correcting it during barge-in
    const isTimingCorrection =
      (request.isInterrupted ||
        /\b(?:change|instead|actually|reschedule|switch|move\s+to|different\s+day|not\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(
          userText
        )) &&
      Boolean(
        resolveDateTime(userText, referenceDate).isResolved ||
          resolveArrivalWindow(userText) ||
          checkOutsideOperatingHours(userText).isOutside
      );

    if (updatedSession.lead.timing?.status !== "VALID" || isTimingCorrection) {
      const outHoursCheck = checkOutsideOperatingHours(userText);
      if (outHoursCheck.isOutside) {
        updatedSession.lead.timing = {
          value: userText,
          status: "AMBIGUOUS",
          confidence: 0.5,
          sourceTurn: updatedSession.turnCount,
          updatedTurn: updatedSession.turnCount,
          turn: updatedSession.turnCount,
          validationReason: outHoursCheck.responsePrompt,
        };
      } else {
        // Check if user is replying with an arrival window to complete a captured date
        const existingTiming = updatedSession.lead.timing?.value || "";
        const existingDateMatch = existingTiming.match(/\b(\d{4}-\d{2}-\d{2})\b/);
        let userArrivalWindow = resolveArrivalWindow(userText);

        // If user replied affirmatively (e.g. "yeah that works", "yes", "sure", "sounds good") after an arrival window was offered
        if (!userArrivalWindow && existingDateMatch) {
          const isAffirmative = /\b(?:yes|yeah|yep|sure|that works|sounds good|okay|ok|perfect|fine|go ahead|book it|schedule it|works for me|that's fine|please do)\b/i.test(userText);
          if (isAffirmative) {
            const exactDateStr = existingDateMatch[1];
            const availableSlots = getAvailableSlotsForDate(exactDateStr, referenceDate, "America/New_York");
            if (availableSlots.length > 0) {
              userArrivalWindow = availableSlots[0].window;
            }
          }
        }

        if (existingDateMatch && userArrivalWindow) {
          const exactDateStr = existingDateMatch[1];
          const normalized = `${exactDateStr} (${userArrivalWindow})`;
          updatedSession.lead.timing = {
            value: normalized,
            status: "VALID",
            confidence: 1.0,
            sourceTurn: updatedSession.turnCount,
            updatedTurn: updatedSession.turnCount,
            turn: updatedSession.turnCount,
            validationReason: `Resolved to exact date & window: ${normalized}`,
          };
        } else {
          const dateRes = resolveDateTime(userText, referenceDate);
          if (dateRes.isOutsideOperatingHours) {
            updatedSession.lead.timing = {
              value: userText,
              status: "AMBIGUOUS",
              confidence: 0.5,
              sourceTurn: updatedSession.turnCount,
              updatedTurn: updatedSession.turnCount,
              turn: updatedSession.turnCount,
              validationReason: dateRes.outsideHoursMessage,
            };
          } else if (dateRes.isAmbiguous) {
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
            const hasWindow = Boolean(dateRes.arrivalWindow || (dateRes.timePreference && dateRes.timePreference.includes(" - ")));
            const needsWindow = dateRes.needsWindowClarification || !hasWindow;
            updatedSession.lead.timing = {
              value: dateRes.normalizedSchedule || dateRes.exactDate || userText,
              status: needsWindow ? "CAPTURED" : "VALID",
              confidence: needsWindow ? 0.8 : 1.0,
              sourceTurn: updatedSession.turnCount,
              updatedTurn: updatedSession.turnCount,
              turn: updatedSession.turnCount,
              validationReason: needsWindow ? dateRes.windowClarificationPrompt : `Resolved to: ${dateRes.normalizedSchedule || dateRes.exactDate}`,
            };
          }
        }
      }
    }

    // Background extraction fallback for phone correction during barge-in
    const isPhoneCorrection =
      (request.isInterrupted ||
        /\b(?:number\s+is|phone\s+is|actually|wrong\s+number|instead|change\s+number|update\s+phone)\b/i.test(
          userText
        )) &&
      userText.replace(/\D/g, "").length >= 10;

    if (isPhoneCorrection) {
      const match10 = userText.match(/\b(?:\+?1[-.\s]?)?\(?([2-9]\d{2})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\b/);
      if (match10) {
        const clean10 = `${match10[1]}${match10[2]}${match10[3]}`;
        updatedSession.lead.phone = {
          value: clean10,
          status: "VALID",
          confidence: 1.0,
          sourceTurn: updatedSession.turnCount,
          updatedTurn: updatedSession.turnCount,
          turn: updatedSession.turnCount,
          validationReason: "Corrected 10-digit phone number",
        };
      }
    }

    // Background extraction fallback for issue description correction during barge-in
    const isIssueCorrection =
      request.isInterrupted &&
      /\b(?:it's\s+not|not\s+(?:the\s+)?(?:ac|air\s+conditioner|heater|water|pipe|leak|drain)|actually\s+(?:it's|it\s+is|my)|instead\s+(?:it's|it\s+is))\b/i.test(
        userText
      );
    if (isIssueCorrection) {
      const issueClean = userText
        .replace(/^(?:wait|no|hold\s+on|actually|sorry|stop)[,\.\s]*/i, "")
        .replace(/^(?:it's\s+not\s+[^,]+,\s*)/i, "")
        .trim();
      if (issueClean.length > 5) {
        updatedSession.lead.problem = {
          value: issueClean,
          status: "VALID",
          confidence: 0.95,
          sourceTurn: updatedSession.turnCount,
          updatedTurn: updatedSession.turnCount,
          turn: updatedSession.turnCount,
          validationReason: "Corrected issue description during barge-in",
        };
      }
    }

    // Background classification fallback for trade, requestType, and primaryService
    const problemText = updatedSession.lead.problem?.value || userText;
    if (problemText && (!updatedSession.requestType || !updatedSession.primaryService)) {
      if (!updatedSession.trade) {
        const inf = inferTrade(problemText);
        if (inf) updatedSession.trade = inf as Trade;
      }
      if (!updatedSession.requestType) {
        const req = canonicalizeRequestType(null, problemText);
        if (req) updatedSession.requestType = req;
      }
      if (!updatedSession.primaryService) {
        const svc = canonicalizeService(null, updatedSession.trade, updatedSession.requestType, problemText);
        if (svc.serviceId) updatedSession.primaryService = svc.serviceId;
      }
      if (!updatedSession.lead.urgency?.value || updatedSession.lead.urgency.value === "Pending") {
        const isHigh = /\b(emergency|urgent|asap|leak|burst|flood|smoke|fire|sparks|no heat|freezing|water pouring)\b/i.test(problemText);
        updatedSession.lead.urgency = {
          value: isHigh ? "HIGH" : "NORMAL",
          status: "VALID",
          confidence: 0.9,
          sourceTurn: updatedSession.turnCount,
          updatedTurn: updatedSession.turnCount,
          turn: updatedSession.turnCount,
          validationReason: `Classified urgency: ${isHigh ? "HIGH" : "NORMAL"}`,
        };
      }
    }

    // Background mood & bad experience analysis fallback
    const moodAnalysis = analyzeCustomerMood(
      userText,
      updatedSession.conversationHistory
        .filter((h) => h.role === "CUSTOMER")
        .map((h) => h.content)
        .join("\n")
    );
    if (moodAnalysis.isUpset) {
      updatedSession.moodDiagnostics.sentimentTag = "angry";
      updatedSession.customerBehavior = "ANGRY";
      if (!updatedSession.moodDiagnostics.whyCustomerIsUpset) {
        updatedSession.moodDiagnostics.whyCustomerIsUpset = moodAnalysis.whyCustomerIsUpset;
      }
      if (!updatedSession.moodDiagnostics.situationContextNotes) {
        updatedSession.moodDiagnostics.situationContextNotes = moodAnalysis.situationContextNotes;
      }
      if (!updatedSession.moodDiagnostics.recommendedNextAction) {
        updatedSession.moodDiagnostics.recommendedNextAction = moodAnalysis.recommendedNextAction;
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
      generateIntelligentFallback(updatedSession, userText);

    // Guard: Never allow generic greeting restarts on active calls (Turn 2+)
    if (
      updatedSession.turnCount > 1 &&
      /\bhow can i help you today\b/i.test(spokenReply)
    ) {
      spokenReply = generateIntelligentFallback(updatedSession, userText);
    }

    // ── Module 5: Psychological Adaptation & Dynamic Empathy Calibration ────────
    const isShortOrRushed =
      /\b(hurry|rush|in a rush|fast|quick|don't have all day|no time|hurry up|asap|faster)\b/i.test(userText) ||
      (userText.split(/\s+/).length <= 2 && updatedSession.turnCount > 1 && !/\b(yes|no|yeah|nope|ok|sure|morning|afternoon)\b/i.test(userText));

    const isElderlyOrConfused =
      /\b(confused|elderly|senior|hard of hearing|don't understand|what do you mean|speak slower|pardon|slow down|can you repeat|repeat that|lost me|too fast)\b/i.test(userText);

    const isAngryOrFrustrated =
      updatedSession.moodDiagnostics.sentimentTag === "angry" ||
      moodAnalysis.isUpset ||
      /\b(upset|angry|pissed|mad|furious|terrible service|horrible|unacceptable|ridiculous)\b/i.test(userText);

    if (isAngryOrFrustrated) {
      updatedSession.callerStyle = "angry_frustrated";
      updatedSession.sentimentState = "empathetic";
      const lowerReply = spokenReply.toLowerCase();
      const hasEmpathy =
        lowerReply.includes("understand") ||
        lowerReply.includes("frustrat") ||
        lowerReply.includes("upset") ||
        lowerReply.includes("sorry") ||
        lowerReply.includes("apologiz");
      if (!hasEmpathy) {
        spokenReply = `I completely understand why you're upset, let's get this fixed immediately. ${spokenReply}`;
      }
    } else if (isShortOrRushed) {
      updatedSession.callerStyle = "rushed";
      // Drop conversational filler and pleasantries for ultra-brief transactional response
      spokenReply = spokenReply
        .replace(/^(Certainly!|Absolutely!|I can certainly help with that\.|I would be glad to help with that\.|Thank you so much!|Thanks for providing that!|Got it,|Wonderful,|Great,)\s*/i, "")
        .trim();
      if (!updatedSession.sentimentState) updatedSession.sentimentState = "warm";
    } else if (isElderlyOrConfused) {
      updatedSession.callerStyle = "elderly_confused";
      updatedSession.sentimentState = "calm";
    } else {
      if (!updatedSession.sentimentState) updatedSession.sentimentState = "warm";
      if (!updatedSession.callerStyle) updatedSession.callerStyle = "neutral";
    }

    // Operating Hours / Time window prompt enforcement:
    if (
      updatedSession.lead.timing?.status === "AMBIGUOUS" &&
      updatedSession.lead.timing.validationReason?.includes("6:00 PM")
    ) {
      spokenReply = updatedSession.lead.timing.validationReason;
    } else if (
      updatedSession.lead.timing?.status === "CAPTURED" &&
      updatedSession.lead.timing.validationReason?.includes("morning window between 9:00 AM and 12:00 PM")
    ) {
      spokenReply = updatedSession.lead.timing.validationReason;
    } else if (
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

    // Intercept leaked raw JSON code (e.g. {"type": "function", "name": "end_call"})
    const hasRawEndCallJson =
      /\{[\s\S]*?"(?:name|type)"\s*:\s*"(?:end_call|function)"[\s\S]*?\}/i.test(spokenReply) ||
      /\bend_call\(\)/i.test(spokenReply);

    if (hasRawEndCallJson) {
      isCallComplete = true;
      updatedSession.state = "CLOSED";
      updatedSession.finalizationStatus = "COMPLETE";
      executeEndCallConclusionHook(updatedSession, referenceDate).catch(console.error);
    }

    spokenReply = cleanSpokenUtterance(spokenReply);

    if ((!spokenReply || hasRawEndCallJson) && (isCallComplete || updatedSession.state === "CLOSED")) {
      const ticketId = updatedSession.ticketId || generateTicketId(referenceDate);
      updatedSession.ticketId = ticketId;
      const spokenTicket = ticketId.replace(/-/g, " ");
      spokenReply = `Perfect. Your appointment is confirmed under Ticket #${spokenTicket}. I've just triggered a confirmation text to your phone, and our team will text you 2 hours before arrival to ensure you're home. Thank you for choosing ${businessName}, have a wonderful day!`;
    }
  } catch (err) {
    console.error("[Relagent] LLM execution error:", err);
    spokenReply = generateIntelligentFallback(updatedSession, userText);
  }

  // ── Phase 6: Instant Human Escalation ─────────────────────────────────────
  if (isHumanEscalationRequested(userText)) {
    spokenReply =
      "I'd be glad to connect you with one of our team members right away. Please hold while I transfer your call.";
    updatedSession.state = "ESCALATED";

    const customerPhone = updatedSession.lead.phone?.value || "5550000000";
    const customerName = updatedSession.lead.name?.value || "Caller";
    const firstName = customerName.split(" ")[0];

    commitCallConclusion({
      customer: {
        tenantId: tenant.tenantId,
        fullLegalName: customerName,
        firstName,
        mobileNumber: customerPhone,
        serviceAddress: updatedSession.lead.address?.value || "Transfer address pending",
        city: "Austin",
        postalCode: "78701",
      },
      callRecord: {
        tenantId: tenant.tenantId,
        customerMobile: customerPhone,
        callerMood: updatedSession.moodDiagnostics.sentimentTag === "angry" ? "angry" : "neutral",
        whyCustomerIsUpset:
          updatedSession.moodDiagnostics.whyCustomerIsUpset ||
          "Customer requested immediate live human transfer.",
        summaryForBusinessOwner: "Caller requested immediate transfer to live staff representative.",
        actionRequiredByTeam: "Immediate human representative answer / priority callback.",
        callTranscript: updatedSession.conversationHistory
          .map((h) => `${h.role}: ${h.content}`)
          .join("\n"),
        smsConfirmationSent: false,
        callType: "human_escalation",
      },
    }).catch(console.error);

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
      sentimentState: "empathetic",
      callerStyle: updatedSession.callerStyle || "neutral",
    };
  }

  // ── Phase 8 & Enterprise Patch: Emergency Protocol ─────────────────────────
  const emergencyCheck = checkEmergencySafety(userText);
  if (emergencyCheck.isEmergency) {
    updatedSession.sentimentState = "urgent";
    updatedSession.safety = {
      status: "CRITICAL",
      category: emergencyCheck.emergencyType as any,
      confidence: 1.0,
    };

    if (emergencyCheck.level === "LEVEL_1_LIFE_THREATENING") {
      spokenReply = emergencyCheck.verbalResponse!;
      updatedSession.state = "ESCALATED";

      const customerPhone = updatedSession.lead.phone?.value || "5550000000";
      const customerName = updatedSession.lead.name?.value || "Caller";
      const firstName = customerName.split(" ")[0];

      commitCallConclusion({
        customer: {
          tenantId: tenant.tenantId,
          fullLegalName: customerName,
          firstName,
          mobileNumber: customerPhone,
          serviceAddress: updatedSession.lead.address?.value || "Evacuation in progress",
          city: "Austin",
          postalCode: "78701",
        },
        callRecord: {
          tenantId: tenant.tenantId,
          customerMobile: customerPhone,
          callerMood: "anxious",
          whyCustomerIsUpset: "Life-threatening emergency (Gas smell, smoke, sparks, fire). Evacuation advised.",
          summaryForBusinessOwner: `CRITICAL SAFETY ALERT: Evacuation in progress due to ${emergencyCheck.emergencyType}. Caller instructed to evacuate immediately and dial emergency services.`,
          actionRequiredByTeam: emergencyCheck.actionRequiredByTeam!,
          callTranscript: updatedSession.conversationHistory
            .map((h) => `${h.role}: ${h.content}`)
            .join("\n"),
          smsConfirmationSent: false,
          callType: "emergency",
        },
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
        state: "ESCALATED",
        missingFields: updatedSession.missingFields,
        safety: { status: "CRITICAL", category: emergencyCheck.emergencyType as any, confidence: 1.0 },
        currentAction: "ESCALATE_SAFETY",
        targetField: null,
        diagnosticReason: "Level 1: Life-Threatening Emergency — Evacuate & Dial 911",
        sentimentState: "urgent",
        callerStyle: updatedSession.callerStyle || "neutral",
      };
    } else if (emergencyCheck.level === "LEVEL_2_PROPERTY_THREATENING") {
      spokenReply = `${emergencyCheck.verbalResponse} What is your street address and best callback number so our on-call technician can be dispatched immediately?`;

      commitCallConclusion({
        customer: {
          tenantId: tenant.tenantId,
          fullLegalName: updatedSession.lead.name?.value || "Caller",
          firstName: (updatedSession.lead.name?.value || "Caller").split(" ")[0],
          mobileNumber: updatedSession.lead.phone?.value || "5550000000",
          serviceAddress: updatedSession.lead.address?.value || "Pending urgent dispatch address",
          city: "Austin",
          postalCode: "78701",
        },
        callRecord: {
          tenantId: tenant.tenantId,
          customerMobile: updatedSession.lead.phone?.value || "5550000000",
          callerMood: "anxious",
          whyCustomerIsUpset: "Property-threatening emergency (Burst pipe / flooding). Urgent technician needed.",
          summaryForBusinessOwner: `URGENT DISPATCH: Property-threatening emergency reported (${emergencyCheck.emergencyType}). Priority alert dispatched to on-call technician.`,
          actionRequiredByTeam: emergencyCheck.actionRequiredByTeam!,
          callTranscript: updatedSession.conversationHistory
            .map((h) => `${h.role}: ${h.content}`)
            .join("\n"),
          smsConfirmationSent: false,
          callType: "emergency",
        },
      }).catch(console.error);
    }
  }

  // ── Phase 7: Abuse Handling Protocol (2-Strike Rule) ─────────────────────
  if (checkAbuse(userText)) {
    updatedSession.abuseCount += 1;
    if (updatedSession.abuseCount === 1) {
      spokenReply =
        "I understand you may be frustrated, but I kindly ask that you please refrain from using that kind of language so I can assist you. How can I help with your home service today?";
    } else {
      spokenReply =
        "Since the inappropriate language has continued, I am going to disconnect this call. You may reach out again when you're ready to communicate respectfully. Goodbye.";
      updatedSession.state = "CLOSED";

      const customerPhone = updatedSession.lead.phone?.value || "5550000000";
      const customerName = updatedSession.lead.name?.value || "Caller";
      const firstName = customerName.split(" ")[0];

      commitCallConclusion({
        customer: {
          tenantId: tenant.tenantId,
          fullLegalName: customerName,
          firstName,
          mobileNumber: customerPhone,
          serviceAddress: updatedSession.lead.address?.value || "Address withheld",
          city: "Austin",
          postalCode: "78701",
        },
        callRecord: {
          tenantId: tenant.tenantId,
          customerMobile: customerPhone,
          callerMood: "angry",
          whyCustomerIsUpset: "Caller used abusive language and was terminated after warning.",
          summaryForBusinessOwner: "Call disconnected after repeated abusive language.",
          actionRequiredByTeam: "Flag phone number for abusive behavior.",
          callTranscript: updatedSession.conversationHistory
            .map((h) => `${h.role}: ${h.content}`)
            .join("\n"),
          smsConfirmationSent: false,
          callType: "standard_booking",
        },
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
        sentimentState: "calm",
        callerStyle: "angry_frustrated",
      };
    }
  }

  // ── Module 5: Zero-Tolerance Out-of-Scope (OOS) & Trivia Enforcement ───────
  const scopeCheck = checkOutOfScope(userText);
  if (scopeCheck.isOutOfScope && updatedSession.state !== "CLOSED") {
    const oos = handleDeterministicOOS(
      updatedSession,
      businessName,
      tenant.tenantId,
      session.callerPhone
    );
    updatedSession.conversationHistory.push({
      role: "REGENT",
      content: oos.response,
    });

    return {
      response: oos.response,
      session: updatedSession,
      shouldTransfer: false,
      complete: oos.complete,
      state: updatedSession.state,
      missingFields: updatedSession.missingFields,
      safety: { status: "NORMAL", category: null, confidence: 1.0 },
      currentAction: oos.complete ? "CLOSE_CALL" : "ANSWER_QUESTION",
      targetField: null,
      diagnosticReason: `Deterministic OOS Strike ${oos.strikeCount} Enforced`,
      sentimentState: oos.sentimentState,
      callerStyle: updatedSession.callerStyle || "neutral",
    };
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

  isCallComplete = isCallComplete || updatedSession.state === "CLOSED";

  // ── 4. Confirmation, Ticket Generation & Call Wrap-up ─────────────────────
  if (updatedSession.ticketId) {
    const isCloseUtterance =
      /^(no|no thanks|nope|that's all|that is all|nothing else|nothing|all good|thanks bye|bye|goodbye)/i.test(
        userText.trim()
      ) ||
      userText.toLowerCase().includes("that's all") ||
      userText.toLowerCase().includes("nothing else");

    if (isCloseUtterance) {
      updatedSession.state = "CLOSED";
      isCallComplete = true;
      spokenReply = `Thank you for calling ${businessName}! We look forward to helping you. Have a wonderful rest of your day!`;

      // Persist final transcript to Supabase
      const customerName = updatedSession.lead.name?.value || "Customer";
      const firstName = customerName.split(" ")[0];
      const customerPhone = updatedSession.lead.phone?.value || "5550000000";

      commitCallConclusion({
        customer: {
          tenantId: tenant.tenantId,
          fullLegalName: customerName,
          firstName,
          mobileNumber: customerPhone,
          serviceAddress: updatedSession.lead.address?.value || "",
          city: "Austin",
          postalCode: "78701",
        },
        ticket: {
          tenantId: tenant.tenantId,
          ticketId: updatedSession.ticketId,
          serviceCategory: updatedSession.trade || "HVAC",
          reportedIssue: updatedSession.lead.problem?.value || "General Service",
          scheduledDate: referenceDate.toISOString().split("T")[0],
          arrivalWindow: resolveArrivalWindow(updatedSession.lead.timing?.value || "") || "09:00 AM - 12:00 PM",
          bookingStatus: "confirmed",
          isAfterHours: !isWithinOperatingHours(referenceDate),
        },
        callRecord: {
          tenantId: tenant.tenantId,
          ticketId: updatedSession.ticketId,
          customerMobile: customerPhone,
          callerMood: updatedSession.moodDiagnostics.sentimentTag === "angry" ? "angry" : "pleasant",
          whyCustomerIsUpset: updatedSession.moodDiagnostics.whyCustomerIsUpset,
          summaryForBusinessOwner: `Customer ${firstName} confirmed service booking. All details verified.`,
          actionRequiredByTeam: "Technician to arrive as scheduled.",
          callTranscript: updatedSession.conversationHistory
            .map((h) => `${h.role}: ${h.content}`)
            .join("\n"),
          smsConfirmationSent: true,
          callType: !isWithinOperatingHours(referenceDate) ? "after_hours" : "standard_booking",
        },
      }).catch(console.error);
    }
  } else if (allFieldsValid) {
    if (session.state !== "READY_FOR_CONFIRMATION") {
      // Transition to confirmation state — use natural spoken language, NOT a bullet list
      updatedSession.state = "READY_FOR_CONFIRMATION";
      const timingDisplay = updatedSession.lead.timing?.value || "";
      const rawPhone = updatedSession.lead.phone?.value || "";
      const cleanName = (updatedSession.lead.name?.value || "")
        .replace(/\b(?:and\s+)?(?:my\s+)?(?:location|address|phone|number|cell|zip|city|i\s+live)\b.*$/i, "")
        .replace(/^(?:uh|um|er)\s+/i, "")
        .trim();
      const cleanAddress = (updatedSession.lead.address?.value || "")
        .replace(/\b(?:uh|um)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      const cleanIssue = (updatedSession.lead.problem?.value || "service")
        .toLowerCase()
        .replace(/^(?:a\s+|an\s+)/, "")
        .trim();
      const customerFirstName = cleanName.split(" ")[0];
      const spokenPhone = formatPhoneForVoice(rawPhone);
      const spokenTiming = formatTimingForVoice(timingDisplay, referenceDate);
      const confirmText = `Alright, ${customerFirstName || "there"}, let me confirm everything with you: I have your name down as ${cleanName}, phone number ${spokenPhone}, service address ${cleanAddress}, for your ${cleanIssue}, scheduled for ${spokenTiming}. Does that all sound right to you, or would you like to change anything?`;
      if (
        !spokenReply.toLowerCase().includes("does that all sound right") &&
        !spokenReply.toLowerCase().includes("does that look correct") &&
        !spokenReply.toLowerCase().includes("does that sound correct") &&
        !spokenReply.toLowerCase().includes("anything to change")
      ) {
        spokenReply = confirmText;
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
        updatedSession.state = "CLOSED";
        isCallComplete = true;
        updatedSession.finalizationStatus = "COMPLETE";

        const customerName = updatedSession.lead.name?.value || "Customer";
        const firstName = customerName.split(" ")[0];
        const customerPhone = updatedSession.lead.phone?.value || "your phone";
        const timingVal = updatedSession.lead.timing?.value || "Monday 09:00 AM - 12:00 PM";

        let scheduledDate = referenceDate.toISOString().split("T")[0];
        let arrivalWindow = "09:00 AM - 12:00 PM";
        const dateMatch = timingVal.match(/\b(\d{4}-\d{2}-\d{2})\b/);
        if (dateMatch) scheduledDate = dateMatch[1];
        if (timingVal.includes(" - ")) {
          const winMatch = timingVal.match(/\b(\d{2}:\d{2}\s+(?:AM|PM)\s*-\s*\d{2}:\d{2}\s+(?:AM|PM))\b/i);
          if (winMatch) arrivalWindow = winMatch[1];
        } else {
          const winFound = resolveArrivalWindow(timingVal);
          if (winFound) arrivalWindow = winFound;
        }

        const fullAddress = updatedSession.lead.address?.value || "";
        const addrParts = parseAddressString(fullAddress);

        const spokenTicketId = ticketId.replace(/-/g, " ");
        spokenReply = `Perfect. Your appointment is confirmed under Ticket #${spokenTicketId}. I've just triggered a confirmation text to your phone, and our team will text you 2 hours before arrival to ensure you're home. Thank you for choosing ${businessName}, have a wonderful day!`;

        // Commit full conclusion pipeline to DB in background
        commitCallConclusion({
          customer: {
            tenantId: tenant.tenantId,
            fullLegalName: customerName,
            firstName,
            mobileNumber: customerPhone,
            serviceAddress: fullAddress || "100 Main St",
            city: addrParts.city || "Austin",
            postalCode: addrParts.zip || "78701",
            isExistingCustomer: updatedSession.returningCustomer || false,
          },
          ticket: {
            tenantId: tenant.tenantId,
            ticketId,
            serviceCategory: updatedSession.trade || "HVAC",
            reportedIssue: updatedSession.lead.problem?.value || "Standard service booking",
            scheduledDate,
            arrivalWindow,
            bookingStatus: "confirmed",
            isAfterHours: !isWithinOperatingHours(referenceDate),
            fullName: customerName,
            phoneNumber: customerPhone,
            fullAddress: fullAddress || "100 Main St",
            customerStatus: updatedSession.returningCustomer ? "Existing Customer" : "New Customer",
            priority:
              updatedSession.safety?.status === "CRITICAL"
                ? "Emergency (Life/Safety)"
                : updatedSession.sentimentState === "urgent"
                ? "Urgent"
                : "Normal",
            mood:
              updatedSession.moodDiagnostics.sentimentTag === "angry"
                ? "Angry"
                : updatedSession.moodDiagnostics.sentimentTag === "happy"
                ? "Happy"
                : updatedSession.sentimentState === "empathetic"
                ? "Frustrated"
                : "Neutral",
            callerStyle:
              updatedSession.callerStyle === "rushed"
                ? "Rushed"
                : updatedSession.callerStyle === "elderly_confused"
                ? "Confused"
                : updatedSession.callerStyle === "angry_frustrated"
                ? "Demanding"
                : "Calm",
            contextSummary:
              updatedSession.moodDiagnostics.situationContextNotes ||
              updatedSession.lead.problem?.value ||
              `Customer ${firstName} booked ${updatedSession.trade || "HVAC"} service.`,
          },
          callRecord: {
            tenantId: tenant.tenantId,
            ticketId,
            customerMobile: customerPhone,
            callerMood:
              updatedSession.moodDiagnostics.sentimentTag === "angry"
                ? "Angry"
                : updatedSession.moodDiagnostics.sentimentTag === "happy"
                ? "Happy"
                : "Neutral",
            callerStyle:
              updatedSession.callerStyle === "rushed"
                ? "Rushed"
                : updatedSession.callerStyle === "elderly_confused"
                ? "Confused"
                : updatedSession.callerStyle === "angry_frustrated"
                ? "Demanding"
                : "Calm",
            customerStatus: updatedSession.returningCustomer ? "Existing Customer" : "New Customer",
            priority:
              updatedSession.safety?.status === "CRITICAL"
                ? "Emergency (Life/Safety)"
                : updatedSession.sentimentState === "urgent"
                ? "Urgent"
                : "Normal",
            summaryForBusinessOwner: `Customer ${firstName} booked ${updatedSession.trade || "HVAC"} service for ${scheduledDate} (${arrivalWindow}). Issue: ${updatedSession.lead.problem?.value || "Standard service"}.`,
            actionRequiredByTeam: `Assign technician van for arrival window ${arrivalWindow}.`,
            callTranscript: updatedSession.conversationHistory
              .map((h) => `${h.role}: ${h.content}`)
              .join("\n"),
            smsConfirmationSent: true,
            callType: !isWithinOperatingHours(referenceDate) ? "after_hours" : "standard_booking",
          },
        }).catch(console.error);

        triggerNotificationWebhook(ticketId, {
          customerName,
          customerPhone,
          serviceAddress: fullAddress,
          trade: updatedSession.trade || "HVAC",
          issueDescription: updatedSession.lead.problem?.value || "",
          preferredSchedule: timingVal,
          scheduledDate,
          arrivalWindow,
          businessName,
          sessionId: updatedSession.sessionId,
        }).catch(console.error);
      } else if (isChange) {
        const currentChanges = updatedSession.corrections?.length || 0;
        if (currentChanges < 2) {
          updatedSession.corrections.push({
            field: "CUSTOMER_CHANGE",
            oldValue: null,
            newValue: userText,
            turn: updatedSession.turnCount,
          });

          if (!spokenReply.toLowerCase().includes("does that look correct")) {
            spokenReply += "\n\nDoes that look correct, or do you need to change anything?";
          }
        } else {
          // Max 2 changes reached -> Lock in and create ticket
          const ticketId = generateTicketId(referenceDate);
          updatedSession.ticketId = ticketId;
          updatedSession.state = "CLOSED";
          isCallComplete = true;
          updatedSession.finalizationStatus = "COMPLETE";

          const customerName = updatedSession.lead.name?.value || "Customer";
          const firstName = customerName.split(" ")[0];
          const customerPhone = updatedSession.lead.phone?.value || "your phone";
          const timingVal = updatedSession.lead.timing?.value || "Monday 09:00 AM - 12:00 PM";

          let scheduledDate = referenceDate.toISOString().split("T")[0];
          let arrivalWindow = "09:00 AM - 12:00 PM";
          const dateMatch = timingVal.match(/\b(\d{4}-\d{2}-\d{2})\b/);
          if (dateMatch) scheduledDate = dateMatch[1];
          if (timingVal.includes(" - ")) {
            const winMatch = timingVal.match(/\b(\d{2}:\d{2}\s+(?:AM|PM)\s*-\s*\d{2}:\d{2}\s+(?:AM|PM))\b/i);
            if (winMatch) arrivalWindow = winMatch[1];
          }

          const fullAddress = updatedSession.lead.address?.value || "";
          const addrParts = parseAddressString(fullAddress);

          spokenReply = `Perfect, ${firstName}. Your appointment is confirmed under Ticket #${ticketId}. I've just triggered a confirmation text to your phone, and our team will text you 2 hours before arrival to ensure you're home. Thank you for choosing ${businessName}, have a wonderful day!`;

          commitCallConclusion({
            customer: {
              tenantId: tenant.tenantId,
              fullLegalName: customerName,
              firstName,
              mobileNumber: customerPhone,
              serviceAddress: fullAddress || "100 Main St",
              city: addrParts.city || "Austin",
              postalCode: addrParts.zip || "78701",
              isExistingCustomer: updatedSession.returningCustomer || false,
            },
            ticket: {
              tenantId: tenant.tenantId,
              ticketId,
              serviceCategory: updatedSession.trade || "HVAC",
              reportedIssue: updatedSession.lead.problem?.value || "Updated service booking",
              scheduledDate,
              arrivalWindow,
              bookingStatus: "confirmed",
              isAfterHours: !isWithinOperatingHours(referenceDate),
              fullName: customerName,
              phoneNumber: customerPhone,
              fullAddress: fullAddress || "100 Main St",
              customerStatus: updatedSession.returningCustomer ? "Existing Customer" : "New Customer",
              priority:
                updatedSession.safety?.status === "CRITICAL"
                  ? "Emergency (Life/Safety)"
                  : updatedSession.sentimentState === "urgent"
                  ? "Urgent"
                  : "Normal",
              mood:
                updatedSession.moodDiagnostics.sentimentTag === "angry"
                  ? "Angry"
                  : updatedSession.moodDiagnostics.sentimentTag === "happy"
                  ? "Happy"
                  : updatedSession.sentimentState === "empathetic"
                  ? "Frustrated"
                  : "Neutral",
              callerStyle:
                updatedSession.callerStyle === "rushed"
                  ? "Rushed"
                  : updatedSession.callerStyle === "elderly_confused"
                  ? "Confused"
                  : updatedSession.callerStyle === "angry_frustrated"
                  ? "Demanding"
                  : "Calm",
              contextSummary:
                updatedSession.moodDiagnostics.situationContextNotes ||
                updatedSession.lead.problem?.value ||
                `Customer ${firstName} confirmed adjusted ${updatedSession.trade || "HVAC"} service booking.`,
            },
            callRecord: {
              tenantId: tenant.tenantId,
              ticketId,
              customerMobile: customerPhone,
              callerMood:
                updatedSession.moodDiagnostics.sentimentTag === "angry"
                  ? "Angry"
                  : updatedSession.moodDiagnostics.sentimentTag === "happy"
                  ? "Happy"
                  : "Neutral",
              callerStyle:
                updatedSession.callerStyle === "rushed"
                  ? "Rushed"
                  : updatedSession.callerStyle === "elderly_confused"
                  ? "Confused"
                  : updatedSession.callerStyle === "angry_frustrated"
                  ? "Demanding"
                  : "Calm",
              customerStatus: updatedSession.returningCustomer ? "Existing Customer" : "New Customer",
              priority:
                updatedSession.safety?.status === "CRITICAL"
                  ? "Emergency (Life/Safety)"
                  : updatedSession.sentimentState === "urgent"
                  ? "Urgent"
                  : "Normal",
              summaryForBusinessOwner: `Customer ${firstName} adjusted details and confirmed ${updatedSession.trade || "HVAC"} service for ${scheduledDate} (${arrivalWindow}).`,
              actionRequiredByTeam: `Assign technician for arrival window ${arrivalWindow}.`,
              callTranscript: updatedSession.conversationHistory
                .map((h) => `${h.role}: ${h.content}`)
                .join("\n"),
              smsConfirmationSent: true,
              callType: !isWithinOperatingHours(referenceDate) ? "after_hours" : "standard_booking",
            },
          }).catch(console.error);

          triggerNotificationWebhook(ticketId, {
            customerName,
            customerPhone,
            serviceAddress: fullAddress,
            trade: updatedSession.trade || "HVAC",
            issueDescription: updatedSession.lead.problem?.value || "",
            preferredSchedule: timingVal,
            scheduledDate,
            arrivalWindow,
            businessName,
            sessionId: updatedSession.sessionId,
          }).catch(console.error);
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
    diagnosticReason: `Patch: Turn Processed (State: ${updatedSession.state}, Ticket: ${
      updatedSession.ticketId || "none"
    })`,
    sentimentState: updatedSession.sentimentState || "warm",
    callerStyle: updatedSession.callerStyle || "neutral",
    // Fix 4: Surface ticket ID to frontend immediately (no DB poll needed)
    ticketId: updatedSession.ticketId || null,
    toolCalls: isCallComplete
      ? [
          {
            id: "end_call_" + Date.now(),
            name: "end_call",
            type: "function",
            function: {
              name: "end_call",
              arguments: JSON.stringify({ reason: "booking_confirmed", ticket_id: updatedSession.ticketId }),
            },
          },
        ]
      : (assistantMsg?.tool_calls || undefined),
  };
}
