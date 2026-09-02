/**
 * Relagent Phase 3: Background Deterministic Date/Time Resolution Logic
 *
 * Requirements:
 * 1. Deterministic function callable by LLM / engine to resolve relative dates.
 * 2. Ambiguity check: If user says weekday matching today's day (e.g., "Wednesday" on Wednesday),
 *    flag as ambiguous so LLM asks: "Do you mean today, or next week Wednesday?"
 * 3. Resolve to exact YYYY-MM-DD format before saving.
 */

export interface DateResolutionResult {
  isResolved: boolean;
  isAmbiguous: boolean;
  ambiguityReason?: string;
  clarificationPrompt?: string;
  exactDate?: string; // YYYY-MM-DD
  timePreference?: string; // Morning, Afternoon, Evening, Specific Time, ASAP
  normalizedSchedule?: string; // e.g. "2026-09-04 (Morning)" or "2026-09-03 14:00"
  rawInput: string;
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function resolveDateTime(
  rawInput: string,
  referenceDate: Date = new Date()
): DateResolutionResult {
  if (!rawInput || rawInput.trim().length === 0) {
    return {
      isResolved: false,
      isAmbiguous: false,
      rawInput: rawInput || "",
    };
  }

  const clean = rawInput.trim().toLowerCase();
  const ref = new Date(referenceDate);

  // Extract US timezone date components (America/New_York)
  const usFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
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

  // Extract time of day preference
  let timePreference: string | undefined;
  if (clean.includes("morning") || clean.includes("am")) {
    timePreference = "Morning";
  } else if (clean.includes("afternoon") || clean.includes("noon")) {
    timePreference = "Afternoon";
  } else if (clean.includes("evening") || clean.includes("night") || clean.includes("tonight")) {
    timePreference = "Evening";
  } else if (clean.includes("asap") || clean.includes("emergency") || clean.includes("right now")) {
    timePreference = "ASAP";
  }

  // Check for specific hour match e.g. "2 pm", "10:30 am", "14:00"
  const hourMatch = clean.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (hourMatch && !clean.match(/\b\d{5}\b/)) { // avoid zip code matching
    const hourNum = parseInt(hourMatch[1], 10);
    const minute = hourMatch[2] || "00";
    const ampm = hourMatch[3];
    if (ampm) {
      timePreference = `${hourNum}:${minute} ${ampm.toUpperCase()}`;
    } else if (hourNum <= 24) {
      timePreference = `${hourNum}:${minute}`;
    }
  }

  // Helper to format Date to YYYY-MM-DD
  const formatYYYYMMDD = (d: Date): string => {
    const p = usFormatter.formatToParts(d);
    const m: Record<string, string> = {};
    for (const item of p) {
      m[item.type] = item.value;
    }
    const y = m.year;
    const mo = String(m.month).padStart(2, "0");
    const da = String(m.day).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  };

  // 1. Direct explicit ISO date or YYYY-MM-DD
  const directIsoMatch = clean.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (directIsoMatch) {
    const exactDate = directIsoMatch[0];
    const normalized = timePreference
      ? `${exactDate} (${timePreference})`
      : exactDate;
    return {
      isResolved: true,
      isAmbiguous: false,
      exactDate,
      timePreference,
      normalizedSchedule: normalized,
      rawInput,
    };
  }

  // 2. "today" / "tonight"
  if (clean.includes("today") || clean.includes("tonight") || clean.includes("asap") || clean.includes("right now")) {
    const exactDate = formatYYYYMMDD(ref);
    const normalized = timePreference
      ? `${exactDate} (${timePreference})`
      : exactDate;
    return {
      isResolved: true,
      isAmbiguous: false,
      exactDate,
      timePreference: timePreference || "Today",
      normalizedSchedule: normalized,
      rawInput,
    };
  }

  // 3. "tomorrow"
  if (clean.includes("tomorrow")) {
    const tomorrow = new Date(refYear, refMonth, refDate + 1);
    const exactDate = formatYYYYMMDD(tomorrow);
    const normalized = timePreference
      ? `${exactDate} (${timePreference})`
      : exactDate;
    return {
      isResolved: true,
      isAmbiguous: false,
      exactDate,
      timePreference,
      normalizedSchedule: normalized,
      rawInput,
    };
  }

  // 4. "day after tomorrow"
  if (clean.includes("day after tomorrow")) {
    const dat = new Date(refYear, refMonth, refDate + 2);
    const exactDate = formatYYYYMMDD(dat);
    const normalized = timePreference
      ? `${exactDate} (${timePreference})`
      : exactDate;
    return {
      isResolved: true,
      isAmbiguous: false,
      exactDate,
      timePreference,
      normalizedSchedule: normalized,
      rawInput,
    };
  }

  // 5. Weekday Resolution & Ambiguity Check
  let matchedDayIndex = -1;
  let matchedWeekdayName = "";
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const day = WEEKDAYS[i];
    // Word boundary match
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

    // Phase 3 Mandate:
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
      targetDate = new Date(refYear, refMonth, refDate);
    } else if (isSameDayOfWeek && mentionsNext) {
      targetDate = new Date(refYear, refMonth, refDate + 7);
    } else {
      let daysAhead = matchedDayIndex - refDay;
      if (daysAhead <= 0) {
        // e.g. today is Thursday (4), and user said Monday (1) -> next Monday (+4 days)
        daysAhead += 7;
      }
      if (mentionsNext && daysAhead <= 7 && !clean.includes("this")) {
        // "next Friday" when today is Thursday could mean next week Friday (+7 days)
        daysAhead += 7;
      }
      targetDate = new Date(refYear, refMonth, refDate + daysAhead);
    }

    const exactDate = formatYYYYMMDD(targetDate);
    const normalized = timePreference
      ? `${exactDate} (${timePreference})`
      : `${exactDate} (${matchedWeekdayName})`;

    return {
      isResolved: true,
      isAmbiguous: false,
      exactDate,
      timePreference,
      normalizedSchedule: normalized,
      rawInput,
    };
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
      const normalized = timePreference
        ? `${exactDate} (${timePreference})`
        : exactDate;
      return {
        isResolved: true,
        isAmbiguous: false,
        exactDate,
        timePreference,
        normalizedSchedule: normalized,
        rawInput,
      };
    }
  }

  // Fallback if unable to resolve date deterministically
  return {
    isResolved: false,
    isAmbiguous: false,
    rawInput,
  };
}
