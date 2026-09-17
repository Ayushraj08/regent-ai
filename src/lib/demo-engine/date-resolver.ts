/**
 * Relagent Time Confirmation Engine & Operating Hours
 * Standards: US, UK, CA, AU Service Scheduling
 *
 * Requirements:
 * 1. Standard Operating Window:
 *    - Mon-Fri: 08:00 to 18:00 (8:00 AM – 6:00 PM)
 *    - Sat: 09:00 to 14:00 (9:00 AM – 2:00 PM)
 *    - Sun: Closed (After-Hours protocol applies)
 * 2. Service Arrival Windows (2-to-3 hour windows):
 *    - Morning Window: 08:00 – 11:00 or 09:00 – 12:00
 *    - Early Afternoon: 12:00 – 15:00 (12:00 PM – 3:00 PM)
 *    - Late Afternoon: 14:00 – 17:00 (2:00 PM – 5:00 PM)
 * 3. Conversational Time Flow:
 *    - Prompt: "We have availability on [Resolved Date] for either our morning window between 9:00 AM and 12:00 PM, or afternoon between 1:00 PM and 4:00 PM. Which works best for you?"
 *    - Out-of-hours: "Our standard service hours end at 6:00 PM. I can book you in for the first morning arrival between 8:00 AM and 10:00 AM the next day, or connect you with our on-call emergency dispatch if it cannot wait."
 *    - Final verification reads back both date AND time slot before confirming.
 */

export interface DateResolutionResult {
  isResolved: boolean;
  isAmbiguous: boolean;
  ambiguityReason?: string;
  clarificationPrompt?: string;
  exactDate?: string; // YYYY-MM-DD
  timePreference?: string; // Morning, Afternoon, Evening, Specific Time, ASAP
  arrivalWindow?: string; // e.g. "09:00 AM - 12:00 PM"
  normalizedSchedule?: string; // e.g. "2026-09-14 (09:00 AM - 12:00 PM)"
  rawInput: string;
  isOutsideOperatingHours?: boolean;
  outsideHoursMessage?: string;
  needsWindowClarification?: boolean;
  windowClarificationPrompt?: string;
}

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export const STANDARD_ARRIVAL_WINDOWS = {
  MORNING_9_12: "09:00 AM - 12:00 PM",
  MORNING_8_11: "08:00 AM - 11:00 AM",
  EARLY_AFTERNOON: "12:00 PM - 03:00 PM",
  AFTERNOON_1_4: "01:00 PM - 04:00 PM",
  LATE_AFTERNOON: "02:00 PM - 05:00 PM",
  FIRST_MORNING: "08:00 AM - 10:00 AM",
  EVENING_4_7: "04:00 PM - 07:00 PM",
  EVENING_3_6: "03:00 PM - 06:00 PM",
};

/**
 * Returns the standard arrival windows still available for a given target date,
 * considering the current real-world time. Windows whose START hour has already
 * passed (on the same calendar day as referenceDate) are excluded.
 *
 * For future dates (tomorrow, next week, etc.), all standard windows are returned.
 *
 * @param targetDateStr  - YYYY-MM-DD of the requested service day
 * @param referenceDate  - Current date/time (defaults to now)
 * @param timezone       - IANA timezone string (defaults to America/Chicago)
 */
export function getAvailableSlotsForDate(
  targetDateStr: string,
  referenceDate: Date = new Date(),
  timezone: string = "America/Chicago"
): { label: string; window: string }[] {
  // Standard windows with their cut-off hour (24h) and display label
  // If it is past 10:00 AM, morning slot for today cannot be scheduled.
  // If it is past 2:00 PM (14:00), afternoon slot is gone.
  // If it is past 6:00 PM (18:00), evening slot is gone.
  const ALL_SLOTS: { label: string; window: string; cutoffHour: number }[] = [
    { label: "morning (9:00 AM – 12:00 PM)",    window: STANDARD_ARRIVAL_WINDOWS.MORNING_9_12,    cutoffHour: 10 },
    { label: "afternoon (1:00 PM – 4:00 PM)",   window: STANDARD_ARRIVAL_WINDOWS.AFTERNOON_1_4,   cutoffHour: 14 },
    { label: "evening (4:00 PM – 7:00 PM)",     window: STANDARD_ARRIVAL_WINDOWS.EVENING_4_7,     cutoffHour: 18 },
  ];

  // Determine if target date is TODAY in the tenant's timezone
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(referenceDate); // returns YYYY-MM-DD

  if (targetDateStr !== todayStr) {
    // Future date — all standard slots are available
    return ALL_SLOTS.map(({ label, window }) => ({ label, window }));
  }

  // It IS today — get the current hour in tenant timezone
  const currentHourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).format(referenceDate);
  const currentHour = parseInt(currentHourStr, 10);

  // Keep only slots whose cutoff hour is strictly in the future (cutoffHour > currentHour)
  const available = ALL_SLOTS.filter(({ cutoffHour }) => cutoffHour > currentHour);
  return available.map(({ label, window }) => ({ label, window }));
}

/**
 * Checks if a given Date & time falls within standard operating hours.
 * Monday – Friday: 08:00 to 18:00
 * Saturday: 09:00 to 14:00
 * Sunday: Closed
 */
export function isWithinOperatingHours(date: Date, hour?: number): boolean {
  const day = date.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0) return false; // Sunday is closed
  if (hour === undefined) hour = date.getHours();

  if (day >= 1 && day <= 5) {
    return hour >= 8 && hour < 18;
  }
  if (day === 6) {
    return hour >= 9 && hour < 14;
  }
  return false;
}

/**
 * Normalizes colloquial time formats like "2:00 p.m..", "p.m.", "a.m." into standard "pm" and "am"
 */
export function normalizeTimeText(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .replace(/(\d{1,2}(?::\d{2})?)\s*p\.m\.?/gi, "$1 pm")
    .replace(/(\d{1,2}(?::\d{2})?)\s*a\.m\.?/gi, "$1 am")
    .replace(/\bp\.m\.?/gi, "pm")
    .replace(/\ba\.m\.?/gi, "am")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses user input for arrival window preference.
 */
export function resolveArrivalWindow(input: string): string | null {
  if (!input) return null;

  // If already matches or contains a standard window, return it directly
  for (const win of Object.values(STANDARD_ARRIVAL_WINDOWS)) {
    if (input.includes(win)) return win;
  }

  const clean = normalizeTimeText(input);

  // 1. First morning arrival / 8 AM
  if (
    clean.includes("first morning") ||
    clean.includes("8 to 10") ||
    clean.includes("8-10") ||
    clean.includes("8 to 11") ||
    /\b8(?::00)?\s*am\b/.test(clean) ||
    /\b(?:at\s+)?8:00\b/.test(clean) ||
    /\bat 8\b/.test(clean)
  ) {
    return STANDARD_ARRIVAL_WINDOWS.MORNING_8_11;
  }

  // 2. Morning (9 to 12)
  if (
    clean.includes("morning") ||
    clean.includes("9 to 12") ||
    clean.includes("9-12") ||
    clean.includes("first option") ||
    clean.includes("first window") ||
    clean.includes("first one") ||
    clean.includes("earlier") ||
    /\b(?:9|10|11)(?::00)?\s*am\b/.test(clean) ||
    /\b(?:9:00|10:00|11:00)\b/.test(clean) ||
    /\bat (?:9|10|11)\b/.test(clean)
  ) {
    return STANDARD_ARRIVAL_WINDOWS.MORNING_9_12;
  }

  // 3. Early afternoon (12 to 3 / noon)
  if (
    clean.includes("12 to 3") ||
    clean.includes("early afternoon") ||
    /\bnoon\b/.test(clean) ||
    /\b12(?::00)?\s*pm\b/.test(clean) ||
    /\b12:00\b/.test(clean) ||
    /\bat 12\b/.test(clean)
  ) {
    return STANDARD_ARRIVAL_WINDOWS.EARLY_AFTERNOON;
  }

  // 4. Late Afternoon (2 to 5 / 2 PM) - evaluated before 1-4 PM so "2:00 pm" maps accurately
  if (
    clean.includes("2 to 5") ||
    clean.includes("2-5") ||
    clean.includes("late afternoon") ||
    /\b2(?::00)?\s*pm\b/.test(clean) ||
    /\b2:00\b/.test(clean) ||
    /\bat 2\b/.test(clean)
  ) {
    return STANDARD_ARRIVAL_WINDOWS.LATE_AFTERNOON;
  }

  // 5. Afternoon (1 to 4 / 1 PM / general afternoon)
  if (
    clean.includes("afternoon") ||
    clean.includes("1 to 4") ||
    clean.includes("1-4") ||
    clean.includes("1 to 5") ||
    clean.includes("second option") ||
    clean.includes("second window") ||
    clean.includes("second one") ||
    clean.includes("later") ||
    /\b1(?::00)?\s*pm\b/.test(clean) ||
    /\b1:00\b/.test(clean) ||
    /\bat 1\b/.test(clean)
  ) {
    return STANDARD_ARRIVAL_WINDOWS.AFTERNOON_1_4;
  }

  // 6. Evening (4 to 7 / evening / 4-7 / 5 to 7 / 6 PM)
  if (
    clean.includes("evening") ||
    clean.includes("4 to 7") ||
    clean.includes("4-7") ||
    clean.includes("third option") ||
    clean.includes("third window") ||
    clean.includes("third one") ||
    /\b(?:4|5|6)(?::00)?\s*pm\b/.test(clean) ||
    /\b(?:4:00|5:00|6:00)\b/.test(clean) ||
    /\bat (?:4|5|6)\b/.test(clean)
  ) {
    return STANDARD_ARRIVAL_WINDOWS.EVENING_4_7;
  }

  // 7. Evening fallback (3 to 6 / 3 PM)
  if (
    clean.includes("3 to 6") ||
    clean.includes("3-6") ||
    /\b3(?::00)?\s*pm\b/.test(clean) ||
    /\b3:00\b/.test(clean) ||
    /\bat 3\b/.test(clean)
  ) {
    return STANDARD_ARRIVAL_WINDOWS.EVENING_3_6;
  }

  return null;
}

/**
 * Checks if the customer is requesting a service hour outside standard business window.
 * (e.g. 8:00 PM on Tuesday, 9 PM, Sunday request)
 */
export function checkOutsideOperatingHours(
  input: string,
  targetDate?: Date
): { isOutside: boolean; reason?: string; responsePrompt?: string } {
  const clean = normalizeTimeText(input);

  // Sunday check
  if (clean.includes("sunday")) {
    return {
      isOutside: true,
      reason: "Sunday is closed under standard operating hours.",
      responsePrompt:
        "Our service desk is closed on Sundays for standard appointments. I can book you for our earliest arrival window on Monday morning between 9:00 AM and 12:00 PM, or route you to on-call emergency dispatch if urgent.",
    };
  }

  // Explicit night / late hours keywords outside 7pm
  const outHoursKeywords = [
    "8pm", "8 pm", "8:00 pm", "20:00",
    "9pm", "9 pm", "9:00 pm", "21:00",
    "10pm", "10 pm", "10:00 pm", "22:00",
    "11pm", "11 pm", "11:00 pm", "23:00",
    "midnight", "12am", "12:00 am",
    "late night", "after hours", "after 7", "past 7", "after 8", "past 8",
  ];

  for (const kw of outHoursKeywords) {
    if (clean.includes(kw)) {
      return {
        isOutside: true,
        reason: "Customer requested evening/night arrival after standard 6:00 PM closing.",
        responsePrompt:
          "Our standard service hours end at 6:00 PM. I can book you in for the first morning arrival between 8:00 AM and 10:00 AM the next day, or connect you with our on-call emergency dispatch if it cannot wait.",
      };
    }
  }

  // Check hour match:
  // Match hours with am/pm (e.g. 2pm, 2:00 pm), or time with minutes (e.g. 2:00, 14:00),
  // or hour preceded by preposition (e.g. "at 2", "around 7", "by 8")
  const hourWithModMatch = clean.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  const hourWithMinMatch = clean.match(/\b(\d{1,2}):(\d{2})\b/);
  const hourWithPrepMatch = clean.match(/\b(?:at|around|by|for|schedule.*?at)\s+(\d{1,2})\b/);

  let hourNum: number | null = null;
  let ampm = "";

  if (hourWithModMatch && !clean.match(/\b\d{5}\b/)) {
    hourNum = parseInt(hourWithModMatch[1], 10);
    ampm = hourWithModMatch[3].toLowerCase();
  } else if (hourWithMinMatch && !clean.match(/\b\d{5}\b/)) {
    hourNum = parseInt(hourWithMinMatch[1], 10);
    // In dispatch service (operating 8 AM - 7 PM), hours 1 to 7 without modifier are daytime PM
    if (hourNum >= 1 && hourNum <= 7) ampm = "pm";
    else if (hourNum >= 8 && hourNum <= 11) ampm = "am";
    else if (hourNum === 12) ampm = "pm";
  } else if (hourWithPrepMatch && !clean.match(/\b\d{5}\b/)) {
    hourNum = parseInt(hourWithPrepMatch[1], 10);
    if (hourNum >= 1 && hourNum <= 7) ampm = "pm";
    else if (hourNum >= 8 && hourNum <= 11) ampm = "am";
    else if (hourNum === 12) ampm = "pm";
  }

  if (hourNum !== null) {
    let hour24 = hourNum;
    if (ampm === "pm" && hourNum < 12) hour24 += 12;
    if (ampm === "am" && hourNum === 12) hour24 = 0;

    // Standard service operating hours are 08:00 to 19:00 (7:00 PM)
    if (hour24 >= 19 || hour24 < 8) {
      return {
        isOutside: true,
        reason: `Requested time ${hourNum}${ampm ? " " + ampm : ""} (${hour24}:00) is outside 08:00-19:00 operating window.`,
        responsePrompt:
          "Our standard service hours end at 7:00 PM. I can get you scheduled for our earliest arrival window tomorrow morning between 9:00 AM and 12:00 PM, or connect you with our on-call emergency dispatch if it cannot wait.",
      };
    }
  }

  return { isOutside: false };
}

export function resolveDateTime(
  rawInput: string,
  referenceDate: Date = new Date(),
  timezone: string = "America/Chicago"
): DateResolutionResult {
  if (!rawInput || rawInput.trim().length === 0) {
    return {
      isResolved: false,
      isAmbiguous: false,
      rawInput: rawInput || "",
    };
  }

  const clean = normalizeTimeText(rawInput);
  const ref = new Date(referenceDate);

  // Extract US timezone date components
  const usFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "long",
  });
  const parts = usFormatter.formatToParts(ref);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }
  const refYear = parseInt(partMap.year, 10);
  const refMonth = parseInt(partMap.month, 10) - 1; // 0-indexed month
  const refDate = parseInt(partMap.day, 10);
  const refWeekdayName = (partMap.weekday || "").toLowerCase();
  const refDay = WEEKDAYS.indexOf(refWeekdayName) !== -1
    ? WEEKDAYS.indexOf(refWeekdayName)
    : ref.getDay();

  // 1. Check out of operating hours request
  const outCheck = checkOutsideOperatingHours(clean);
  if (outCheck.isOutside) {
    return {
      isResolved: false,
      isAmbiguous: false,
      isOutsideOperatingHours: true,
      outsideHoursMessage: outCheck.responsePrompt,
      rawInput,
    };
  }

  // 2. Resolve Arrival Window if mentioned
  const detectedWindow = resolveArrivalWindow(clean);

  // Extract time of day preference
  let timePreference: string | undefined = detectedWindow || undefined;
  if (!timePreference) {
    if (clean.includes("morning") || clean.includes("am")) {
      timePreference = STANDARD_ARRIVAL_WINDOWS.MORNING_9_12;
    } else if (clean.includes("afternoon") || clean.includes("noon")) {
      timePreference = STANDARD_ARRIVAL_WINDOWS.AFTERNOON_1_4;
    } else if (clean.includes("evening") || clean.includes("pm")) {
      timePreference = STANDARD_ARRIVAL_WINDOWS.EVENING_4_7;
    } else if (clean.includes("asap") || clean.includes("emergency") || clean.includes("right now")) {
      timePreference = "Immediate Emergency";
    }
  }

  // Helper to format Date to YYYY-MM-DD
  const formatYYYYMMDD = (d: Date): string => {
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  };

  // Helper to format Date for friendly display in prompt (e.g. "Monday, September 14")
  const formatFriendlyDate = (d: Date): string => {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    return f.format(d);
  };

  const createResolvedResult = (
    targetDate: Date,
    exactDateStr: string
  ): DateResolutionResult => {
    const arrivalWindow = detectedWindow || (timePreference?.includes(" - ") ? timePreference : undefined);
    const needsWindow = !arrivalWindow && timePreference !== "Immediate Emergency";
    const friendlyDate = formatFriendlyDate(targetDate);

    // FIX 1: Time-Aware Slot Filtering
    // Get only the arrival windows that haven't passed yet for this date
    const availableSlots = getAvailableSlotsForDate(exactDateStr, referenceDate, timezone);

    // Check if user requested a slot for today that has ALREADY PASSED or is full
    const todayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(referenceDate);

    // Reject past date (e.g. earlier than today)
    if (exactDateStr < todayStr) {
      return {
        isResolved: false,
        isAmbiguous: true,
        clarificationPrompt: `That date has already passed. We have availability tomorrow morning between 9:00 AM and 12:00 PM, or tomorrow afternoon between 1:00 PM and 4:00 PM. Which of those works better for you?`,
        rawInput,
      };
    }

    if (exactDateStr === todayStr && arrivalWindow) {
      const isSlotStillAvailable = availableSlots.some((s) => s.window === arrivalWindow);
      if (!isSlotStillAvailable) {
        let binaryPrompt: string;
        if (availableSlots.length >= 2) {
          binaryPrompt = `Since our ${arrivalWindow.includes("09:00") || arrivalWindow.includes("08:00") ? "morning" : arrivalWindow.includes("01:00") ? "afternoon" : "requested"} window for today has already passed, we have an opening today in the ${availableSlots[0].label}, or the ${availableSlots[1].label}. Which of those works better for you?`;
        } else if (availableSlots.length === 1) {
          binaryPrompt = `Since our ${arrivalWindow.includes("09:00") || arrivalWindow.includes("08:00") ? "morning" : "earlier"} window for today has already passed, we still have an opening today in the ${availableSlots[0].label}, or tomorrow morning between 9:00 AM and 12:00 PM. Which of those works better for you?`;
        } else {
          binaryPrompt = `Since our service windows for today have already wrapped up, I can get you scheduled for tomorrow morning between 9:00 AM and 12:00 PM, or tomorrow afternoon between 1:00 PM and 4:00 PM. Which of those would you prefer?`;
        }

        return {
          isResolved: false,
          isAmbiguous: true,
          clarificationPrompt: binaryPrompt,
          rawInput,
        };
      }
    }

    // If the user requested "today" with no window, but NO slots remain today → offer tomorrow binary options
    if (needsWindow && availableSlots.length === 0) {
      return {
        isResolved: false,
        isAmbiguous: true,
        clarificationPrompt:
          "Since our service windows for today have already wrapped up, I can get you scheduled for tomorrow morning between 9:00 AM and 12:00 PM, or tomorrow afternoon between 1:00 PM and 4:00 PM. Which of those would you prefer?",
        rawInput,
      };
    }

    // Build the time-aware clarification prompt from only available slots
    let windowClarificationPrompt: string;
    if (availableSlots.length === 1) {
      windowClarificationPrompt = `We still have availability on ${friendlyDate} for our ${availableSlots[0].label} window. Does that work for you?`;
    } else if (availableSlots.length >= 2) {
      const slotList = availableSlots.map((s) => s.label).join(", or ");
      windowClarificationPrompt = `We have availability on ${friendlyDate} for our ${slotList}. Which works best for you?`;
    } else {
      // Fallback for future dates
      windowClarificationPrompt = `We have availability on ${friendlyDate} for either our morning window between 9:00 AM and 12:00 PM, or afternoon between 1:00 PM and 4:00 PM. Which works best for you?`;
    }

    const normalized = arrivalWindow
      ? `${exactDateStr} (${arrivalWindow})`
      : exactDateStr;

    return {
      isResolved: true,
      isAmbiguous: false,
      exactDate: exactDateStr,
      timePreference: arrivalWindow || timePreference,
      arrivalWindow: arrivalWindow || undefined,
      normalizedSchedule: normalized,
      needsWindowClarification: needsWindow,
      windowClarificationPrompt: needsWindow ? windowClarificationPrompt : undefined,
      rawInput,
    };
  };

  // 1. Direct explicit ISO date or YYYY-MM-DD
  const directIsoMatch = clean.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (directIsoMatch) {
    const exactDate = directIsoMatch[0];
    const [y, m, d] = exactDate.split("-").map((n) => parseInt(n, 10));
    const targetDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return createResolvedResult(targetDate, exactDate);
  }

  // 2. "today" / "tonight"
  if (clean.includes("today") || clean.includes("tonight")) {
    const targetDate = new Date(Date.UTC(refYear, refMonth, refDate, 12, 0, 0));
    const exactDate = formatYYYYMMDD(targetDate);
    return createResolvedResult(targetDate, exactDate);
  }

  // 3. "tomorrow" - strictly take CURRENT_DATE anchor and add +1 day
  if (clean.includes("tomorrow")) {
    const tomorrow = new Date(Date.UTC(refYear, refMonth, refDate + 1, 12, 0, 0));
    const exactDate = formatYYYYMMDD(tomorrow);
    return createResolvedResult(tomorrow, exactDate);
  }

  // 4. "day after tomorrow" - strictly take CURRENT_DATE anchor and add +2 days
  if (clean.includes("day after tomorrow")) {
    const dat = new Date(Date.UTC(refYear, refMonth, refDate + 2, 12, 0, 0));
    const exactDate = formatYYYYMMDD(dat);
    return createResolvedResult(dat, exactDate);
  }

  // 5. Weekday Resolution & Ambiguity Check
  let matchedDayIndex = -1;
  let matchedWeekdayName = "";
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const day = WEEKDAYS[i];
    const regex = new RegExp(`\\b${day}\\b`, "i");
    if (regex.test(clean)) {
      matchedDayIndex = i;
      matchedWeekdayName = day.charAt(0).toUpperCase() + day.slice(1);
      break;
    }
  }

  if (matchedDayIndex !== -1) {
    const isSameDayOfWeek = matchedDayIndex === refDay;
    const mentionsToday = clean.includes("today") || clean.includes("this morning") || clean.includes("this afternoon");
    const mentionsNext = clean.includes("next") || clean.includes("following");

    // Phase 3 Ambiguity Mandate:
    // If user says "Wednesday", the function checks today's date. If today is Wednesday,
    // the LLM must ask: "Do you mean today, or next week Wednesday?"
    if (isSameDayOfWeek && !mentionsToday && !mentionsNext) {
      return {
        isResolved: false,
        isAmbiguous: true,
        ambiguityReason: "SAME_DAY_WEEKDAY",
        clarificationPrompt: `Do you mean today, or next week ${matchedWeekdayName}?`,
        rawInput,
      };
    }

    let targetDate: Date;
    if (isSameDayOfWeek && mentionsToday) {
      targetDate = new Date(Date.UTC(refYear, refMonth, refDate, 12, 0, 0));
    } else if (isSameDayOfWeek && mentionsNext) {
      targetDate = new Date(Date.UTC(refYear, refMonth, refDate + 7, 12, 0, 0));
    } else {
      let daysAhead = matchedDayIndex - refDay;
      if (daysAhead <= 0) {
        daysAhead += 7;
      }
      if (mentionsNext && daysAhead <= 7 && !clean.includes("this")) {
        daysAhead += 7;
      }
      targetDate = new Date(Date.UTC(refYear, refMonth, refDate + daysAhead, 12, 0, 0));
    }

    const exactDate = formatYYYYMMDD(targetDate);
    return createResolvedResult(targetDate, exactDate);
  }

  // 6. Generic month/day parsing e.g. "September 15", "Sept 15th"
  const monthMatch = clean.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b\.?\s*(\d{1,2})(?:st|nd|rd|th)?/i
  );
  if (monthMatch) {
    const monthNames = [
      "jan", "feb", "mar", "apr", "may", "jun",
      "jul", "aug", "sep", "oct", "nov", "dec"
    ];
    const monthIndex = monthNames.findIndex((m) =>
      monthMatch[1].toLowerCase().startsWith(m)
    );
    const dayNum = parseInt(monthMatch[2], 10);
    if (monthIndex !== -1 && dayNum >= 1 && dayNum <= 31) {
      let targetYear = refYear;
      if (monthIndex < refMonth || (monthIndex === refMonth && dayNum < refDate)) {
        targetYear += 1;
      }
      const targetDate = new Date(targetYear, monthIndex, dayNum);
      const exactDate = formatYYYYMMDD(targetDate);
      return createResolvedResult(targetDate, exactDate);
    }
  }

  // 7. If input is just an arrival window without a date (e.g. user answering "morning" or "afternoon" after date was resolved)
  if (detectedWindow) {
    const todayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(referenceDate);
    const todaySlots = getAvailableSlotsForDate(todayStr, referenceDate, timezone);
    const isSlotAvailableToday = todaySlots.some((s) => s.window === detectedWindow);

    // If caller specifically asked for an arrival window that has ALREADY PASSED today
    if (!isSlotAvailableToday) {
      let binaryPrompt: string;
      if (todaySlots.length >= 2) {
        binaryPrompt = `Since our ${detectedWindow.includes("09:00") ? "morning" : "requested"} window for today has already passed, we have an opening today in the ${todaySlots[0].label}, or the ${todaySlots[1].label}. Which of those works better for you?`;
      } else if (todaySlots.length === 1) {
        binaryPrompt = `Since our morning window for today has already passed, we still have an opening today in the ${todaySlots[0].label}, or tomorrow morning between 9:00 AM and 12:00 PM. Which of those works better for you?`;
      } else {
        binaryPrompt = `Since our service windows for today have already wrapped up, I can get you scheduled for tomorrow morning between 9:00 AM and 12:00 PM, or tomorrow afternoon between 1:00 PM and 4:00 PM. Which of those would you prefer?`;
      }
      return {
        isResolved: false,
        isAmbiguous: true,
        clarificationPrompt: binaryPrompt,
        rawInput,
      };
    }

    return {
      isResolved: true,
      isAmbiguous: false,
      timePreference: detectedWindow,
      arrivalWindow: detectedWindow,
      normalizedSchedule: detectedWindow,
      rawInput,
    };
  }

  return {
    isResolved: false,
    isAmbiguous: false,
    rawInput,
  };
}
