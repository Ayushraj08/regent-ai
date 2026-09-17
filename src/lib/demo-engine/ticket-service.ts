/**
 * Relagent Production Multi-Tenant Persistence & Call Conclusion Pipeline
 * Clean Schema: businesses, customers, appointments, call_logs
 */

import { Client } from "pg";

const SUPABASE_DB_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:@Ayushsingh1@db.kezsgmvwkuscdrroucdb.supabase.co:5432/postgres";

export interface BusinessProfile {
  id: string;
  companyName: string;
  aiAgentName: string;
  timezone: string;
  serviceZipCodes: string[];
  afterHoursRule?: string;
  dispatchPhoneNumber: string;
  createdAt?: string;

  // Compatibility fields for existing codebase
  tenantId: string;
  businessName: string;
  coveredZipCodes: string[];
  managerSmsNumber: string;
  excludedServices: string;
  afterHoursDispatchFee: string;
  /** Per-tenant FAQ. Key = topic slug (e.g. "dispatch_fee"), value = spoken answer for TTS. */
  faq?: Record<string, string>;
}

export type TenantProfile = BusinessProfile;

export const DEFAULT_BUSINESS_PROFILE: BusinessProfile = {
  id: "b0000000-0000-0000-0000-000000000001",
  companyName: "Apex Heating & Air",
  aiAgentName: "Regent",
  timezone: "America/New_York",
  serviceZipCodes: [
    "75001", "75002", "75201", "75202", "75204", "75205", "75206",
    "75207", "75208", "75209", "75210", "76101", "76102",
    "78701", "78702", "78703", "78704", "78705"
  ],
  afterHoursRule: "$150 dispatch fee applies after 6:00 PM and on weekends.",
  dispatchPhoneNumber: "5551234567",

  // Compatibility aliases
  tenantId: "b0000000-0000-0000-0000-000000000001",
  businessName: "Apex Heating & Air",
  coveredZipCodes: [
    "75001", "75002", "75201", "75202", "75204", "75205", "75206",
    "75207", "75208", "75209", "75210", "76101", "76102",
    "78701", "78702", "78703", "78704", "78705"
  ],
  managerSmsNumber: "5551234567",
  excludedServices: "We do not service commercial chillers, ammonia refrigeration, or window units.",
  afterHoursDispatchFee: "$150 dispatch fee applies after 6:00 PM and on weekends.",
  faq: {
    dispatch_fee: "Our standard dispatch fee is forty-nine dollars, which is waived if you book the repair with us. After hours and weekends carry a one-hundred-fifty dollar dispatch fee.",
    hours: "We are open Monday through Friday, eight AM to six PM, and Saturday nine AM to two PM. We are closed on Sundays.",
    warranty: "All repairs come with a ninety-day parts and labor warranty.",
    service_area: "We serve Dallas, Fort Worth, and the Austin metro areas. If you have an address in those cities, we can likely get someone out to you.",
    licensing: "Yes, we are fully licensed and insured in the state of Texas.",
    pricing: "Pricing depends on the specific repair, but our standard diagnostic visit starts at forty-nine dollars. We will give you a full estimate before any work begins.",
    eta: "Once booked, our tech will text you two to three hours before they head out so you know exactly when to expect them.",
  },
};

export const DEFAULT_TENANT_PROFILE = DEFAULT_BUSINESS_PROFILE;

function mapBusinessRow(row: any): BusinessProfile {
  const zipCodes = Array.isArray(row.service_zip_codes)
    ? row.service_zip_codes
    : typeof row.service_zip_codes === "string"
    ? row.service_zip_codes.replace(/[\{\}]/g, "").split(",")
    : [
        "75001", "75002", "75201", "75202", "75204", "75205", "75206",
        "75207", "75208", "75209", "75210", "76101", "76102",
        "78701", "78702", "78703", "78704", "78705"
      ];

  return {
    id: row.id,
    companyName: row.company_name,
    aiAgentName: row.ai_agent_name || "Regent",
    timezone: row.timezone || "America/New_York",
    serviceZipCodes: zipCodes,
    afterHoursRule: row.after_hours_rule || "$150 dispatch fee applies after 6:00 PM and on weekends.",
    dispatchPhoneNumber: row.dispatch_phone_number,
    createdAt: row.created_at,

    // Backward compatibility aliases
    tenantId: row.id,
    businessName: row.company_name,
    coveredZipCodes: zipCodes,
    managerSmsNumber: row.dispatch_phone_number,
    excludedServices: "We do not service commercial chillers, ammonia refrigeration, or window units.",
    afterHoursDispatchFee: row.after_hours_rule || "$150 dispatch fee applies after 6:00 PM and on weekends.",
  };
}

const businessProfileCache = new Map<string, { profile: BusinessProfile; cachedAt: number }>();
const PROFILE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function getBusinessProfile(businessIdOrPhone?: string | null): Promise<BusinessProfile> {
  if (!businessIdOrPhone) return DEFAULT_BUSINESS_PROFILE;

  // Normalize legacy placeholder IDs
  const normalizedId =
    businessIdOrPhone === "00000000-0000-0000-0000-000000000001"
      ? "b0000000-0000-0000-0000-000000000001"
      : businessIdOrPhone;

  if (normalizedId === "b0000000-0000-0000-0000-000000000001") {
    return DEFAULT_BUSINESS_PROFILE;
  }

  const cached = businessProfileCache.get(normalizedId);
  if (cached && Date.now() - cached.cachedAt < PROFILE_CACHE_TTL_MS) {
    return cached.profile;
  }

  const client = new Client({ connectionString: SUPABASE_DB_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedId);
    const query = isUuid
      ? "SELECT * FROM public.businesses WHERE id = $1 LIMIT 1;"
      : "SELECT * FROM public.businesses WHERE dispatch_phone_number = $1 OR company_name ILIKE $1 LIMIT 1;";
    const res = await client.query(query, [normalizedId]);

    if (res.rows.length > 0) {
      const mapped = mapBusinessRow(res.rows[0]);
      businessProfileCache.set(normalizedId, { profile: mapped, cachedAt: Date.now() });
      return mapped;
    }
  } catch (e) {
    console.error("[TicketService] Error fetching business profile:", e);
  } finally {
    try { await client.end(); } catch {}
  }
  return DEFAULT_BUSINESS_PROFILE;
}

export const getTenantProfile = getBusinessProfile;

export async function getAllBusinessProfiles(): Promise<BusinessProfile[]> {
  const client = new Client({ connectionString: SUPABASE_DB_URL });
  try {
    await client.connect();
    const res = await client.query("SELECT * FROM public.businesses ORDER BY company_name ASC;");
    if (res.rows.length > 0) {
      return res.rows.map(mapBusinessRow);
    }
  } catch (e) {
    console.error("[TicketService] Error fetching all businesses:", e);
  } finally {
    try { await client.end(); } catch {}
  }
  return [DEFAULT_BUSINESS_PROFILE];
}

export const getAllTenantProfiles = getAllBusinessProfiles;

export interface CustomerData {
  id?: string;
  businessId?: string;
  tenantId?: string;
  fullLegalName?: string;
  fullName?: string;
  firstName?: string;
  mobileNumber?: string;
  phoneNumber?: string;
  serviceAddress?: string;
  streetAddress?: string;
  city?: string;
  postalCode?: string;
  zipCode?: string;
  isBlockedSpammer?: boolean;
}

/**
 * 1. Customer UPSERT Hook (save_customer_info)
 * Scoped to business_id and phone_number.
 * If customer exists, updates street_address, city, zip_code.
 * If new, creates row and returns customer_id.
 */
export async function upsertCustomer(
  businessId: string,
  customerData: {
    fullName: string;
    phoneNumber: string;
    streetAddress: string;
    city: string;
    zipCode: string;
    isBlockedSpammer?: boolean;
  }
): Promise<{ customerId?: string; error?: string }> {
  const client = new Client({ connectionString: SUPABASE_DB_URL });
  try {
    await client.connect();

    const resolvedBusinessId =
      businessId === "00000000-0000-0000-0000-000000000001"
        ? "b0000000-0000-0000-0000-000000000001"
        : businessId || "b0000000-0000-0000-0000-000000000001";

    const cleanPhone = (customerData.phoneNumber || "").replace(/\D/g, "").slice(-10);
    const fullName = (customerData.fullName || "Valued Customer").trim();
    const street = (customerData.streetAddress || "Pending Address Confirmation").trim();
    const city = (customerData.city || "Austin").trim();
    const zip = (customerData.zipCode || "78701").trim();
    const isBlocked = Boolean(customerData.isBlockedSpammer);

    const query = `
      INSERT INTO public.customers (
        business_id, full_name, phone_number, street_address, city, zip_code, is_blocked_spammer
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (business_id, phone_number) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        street_address = EXCLUDED.street_address,
        city = EXCLUDED.city,
        zip_code = EXCLUDED.zip_code,
        is_blocked_spammer = COALESCE(EXCLUDED.is_blocked_spammer, customers.is_blocked_spammer)
      RETURNING id;
    `;

    const res = await client.query(query, [
      resolvedBusinessId,
      fullName,
      cleanPhone,
      street,
      city,
      zip,
      isBlocked,
    ]);

    const customerId = res.rows[0]?.id;
    return { customerId };
  } catch (err: any) {
    console.error("[TicketService] Error upserting customer:", err);
    return { error: err.message };
  } finally {
    try { await client.end(); } catch {}
  }
}

export function generateTicketId(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const datePart = `${year}${month}${day}`;

  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return `TKT-${datePart}-${suffix}`;
}

/**
 * FIX 2: Returning Customer Lookup
 * Accepts a phone number (10 digits) or a ticket ID (TKT-YYYYMMDD-XXXX).
 * Queries customers + most recent appointment for that customer/business.
 * Returns found=true with customer snapshot so the LLM can skip re-collection.
 */
export async function lookupCustomer(
  businessId: string,
  phoneOrTicketId: string
): Promise<{
  found: boolean;
  customerId?: string;
  name?: string;
  phone?: string;
  address?: string;
  lastIssue?: string;
  lastTicketId?: string;
  lastScheduledDate?: string;
  error?: string;
}> {
  const client = new Client({ connectionString: SUPABASE_DB_URL });
  try {
    await client.connect();

    const resolvedBusinessId =
      businessId === "00000000-0000-0000-0000-000000000001"
        ? "b0000000-0000-0000-0000-000000000001"
        : businessId || "b0000000-0000-0000-0000-000000000001";

    const cleanInput = phoneOrTicketId.trim();
    const isTicketId = /^TKT-\d{8}-[A-Z0-9]{4}$/i.test(cleanInput);
    const cleanPhone = cleanInput.replace(/\D/g, "").slice(-10);

    let row: any = null;

    if (isTicketId) {
      // Lookup by ticket ID — join appointments → customers
      const res = await client.query(
        `SELECT
          c.id as customer_id,
          c.full_name,
          c.phone_number,
          c.street_address,
          c.city,
          c.zip_code,
          a.ticket_id,
          a.issue_description,
          to_char(a.scheduled_date, 'YYYY-MM-DD') as scheduled_date
        FROM public.appointments a
        JOIN public.customers c ON a.customer_id = c.id
        WHERE a.ticket_id = $1
          AND a.business_id = $2
        LIMIT 1;`,
        [cleanInput.toUpperCase(), resolvedBusinessId]
      );
      row = res.rows[0] || null;
    } else if (cleanPhone.length === 10) {
      // Lookup by phone — get customer + most recent appointment
      const res = await client.query(
        `SELECT
          c.id as customer_id,
          c.full_name,
          c.phone_number,
          c.street_address,
          c.city,
          c.zip_code,
          a.ticket_id,
          a.issue_description,
          to_char(a.scheduled_date, 'YYYY-MM-DD') as scheduled_date
        FROM public.customers c
        LEFT JOIN public.appointments a
          ON a.customer_id = c.id AND a.business_id = $2
        WHERE c.phone_number = $1
          AND c.business_id = $2
        ORDER BY a.created_at DESC NULLS LAST
        LIMIT 1;`,
        [cleanPhone, resolvedBusinessId]
      );
      row = res.rows[0] || null;
    }

    if (!row) {
      return { found: false };
    }

    const addressParts = [row.street_address, row.city, row.zip_code]
      .filter(Boolean)
      .join(", ");

    return {
      found: true,
      customerId: row.customer_id,
      name: row.full_name || undefined,
      phone: row.phone_number || undefined,
      address: addressParts || undefined,
      lastIssue: row.issue_description || undefined,
      lastTicketId: row.ticket_id || undefined,
      lastScheduledDate: row.scheduled_date || undefined,
    };
  } catch (err: any) {
    console.error("[TicketService] Error in lookupCustomer:", err);
    return { found: false, error: err.message };
  } finally {
    try { await client.end(); } catch {}
  }
}

export type ValidCallCategory =
  | "Booking"
  | "Emergency"
  | "Complaint"
  | "Out of Scope"
  | "Human Escalation"
  | "General Inquiry";

const VALID_CATEGORIES: ValidCallCategory[] = [
  "Booking",
  "Emergency",
  "Complaint",
  "Out of Scope",
  "Human Escalation",
  "General Inquiry",
];

/**
 * Step B (Crucial): Fast Secondary LLM Prompt
 * Takes raw full_transcript and extracts:
 * 1. ai_summary_for_owner: 2-sentence plain English summary of the call.
 * 2. action_needed: Short, actionable directive.
 * 3. call_category: Must strictly match one of the 6 allowed check constraint categories.
 */
export async function generateCallSummary(
  fullTranscript: string,
  hints?: {
    isEmergency?: boolean;
    isEscalation?: boolean;
    isOutOfScope?: boolean;
    hasAppointment?: boolean;
    trade?: string;
  }
): Promise<{
  aiSummaryForOwner: string;
  actionNeeded: string;
  callCategory: ValidCallCategory;
}> {
  const groqApiKey = process.env.GROQ_API_KEY;

  if (groqApiKey && fullTranscript && fullTranscript.length > 20) {
    try {
      const systemPrompt = `You are an elite business dispatcher and operational summarizer for home service businesses.
Analyze the provided full conversation transcript between the AI dispatcher and the caller.

You MUST respond with a valid JSON object matching EXACTLY these 3 fields:
{
  "ai_summary_for_owner": "A concise 2-sentence plain English summary of what happened on the call for the business owner.",
  "action_needed": "A short, actionable directive (e.g., 'Dispatch standard HVAC van', 'Urgent callback required by manager', 'No action needed - spam line terminated').",
  "call_category": "Booking"
}

ALLOWED VALUES FOR "call_category" (MUST BE EXACTLY ONE OF THESE SIX):
- "Booking" (appointments or service booked/scheduled)
- "Emergency" (safety hazard, gas leak, flooding, fire/smoke risk)
- "Complaint" (dissatisfied caller, billing dispute, poor prior job)
- "Out of Scope" (unsupported service, off-topic trivia, caller blocked)
- "Human Escalation" (caller requested live human transfer or manager)
- "General Inquiry" (general questions, pricing info, hours, service area)`;

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqApiKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Full Transcript:\n${fullTranscript}` },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 300,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          let rawCategory: string = (parsed.call_category || "").trim();

          // Normalize category to allowed enum values
          let category: ValidCallCategory = "General Inquiry";
          const match = VALID_CATEGORIES.find(
            (c) => c.toLowerCase() === rawCategory.toLowerCase()
          );
          if (match) {
            category = match;
          } else if (hints?.isEmergency) {
            category = "Emergency";
          } else if (hints?.hasAppointment) {
            category = "Booking";
          } else if (hints?.isEscalation) {
            category = "Human Escalation";
          } else if (hints?.isOutOfScope) {
            category = "Out of Scope";
          }

          if (parsed.ai_summary_for_owner && parsed.action_needed) {
            return {
              aiSummaryForOwner: parsed.ai_summary_for_owner.trim(),
              actionNeeded: parsed.action_needed.trim(),
              callCategory: category,
            };
          }
        }
      }
    } catch (llmErr) {
      console.warn("[TicketService] Fast LLM summarizer encountered error, using fallback:", llmErr);
    }
  }

  // Robust Heuristic Fallback
  let callCategory: ValidCallCategory = "General Inquiry";
  let actionNeeded = "Review call log for general inquiry.";
  let aiSummaryForOwner = "Caller reached the service desk to discuss general home service options. Details logged.";

  if (hints?.isEmergency || /emergency|gas leak|fire|smoke|burst pipe|flooding/i.test(fullTranscript)) {
    callCategory = "Emergency";
    actionNeeded = "Priority emergency dispatch or safety response required immediately.";
    aiSummaryForOwner = "Caller reported a severe emergency condition requiring immediate attention. Safety guidance was issued and on-call dispatch alerted.";
  } else if (hints?.hasAppointment || /appointment|booking|scheduled|confirmed|arrival window|ticket/i.test(fullTranscript)) {
    callCategory = "Booking";
    actionNeeded = `Dispatch standard ${hints?.trade || "service"} technician for scheduled arrival window.`;
    aiSummaryForOwner = `Customer successfully scheduled an appointment for ${hints?.trade || "home"} service. All customer information and service window confirmed.`;
  } else if (hints?.isEscalation || /transfer|human|manager|supervisor|live person/i.test(fullTranscript)) {
    callCategory = "Human Escalation";
    actionNeeded = "Urgent callback required by manager or live staff representative.";
    aiSummaryForOwner = "Caller requested immediate transfer or escalation to a live human representative. Transfer initiated.";
  } else if (hints?.isOutOfScope || /out of scope|strike|blocked|trivia|joke/i.test(fullTranscript)) {
    callCategory = "Out of Scope";
    actionNeeded = "No action needed - inquiry terminated as out-of-scope.";
    aiSummaryForOwner = "Caller engaged with irrelevant inquiries or off-topic requests beyond business scope. Line disconnected.";
  } else if (/angry|complaint|unhappy|terrible|bad service|refund/i.test(fullTranscript)) {
    callCategory = "Complaint";
    actionNeeded = "Manager outreach advised to address customer dissatisfaction.";
    aiSummaryForOwner = "Caller expressed dissatisfaction regarding previous service or billing. Account flagged for customer service follow-up.";
  }

  return {
    aiSummaryForOwner,
    actionNeeded,
    callCategory,
  };
}

export interface AppointmentData {
  ticketId?: string;
  businessId?: string;
  customerId?: string;
  serviceType: string;
  issueDescription: string;
  scheduledDate: string; // YYYY-MM-DD
  arrivalWindow: string; // e.g. "09:00 AM - 12:00 PM"
  status?: string;

  // Flattened Dispatch Board & Context Columns (No JOIN needed)
  fullName?: string;
  phoneNumber?: string;
  fullAddress?: string;
  customerStatus?: "New Customer" | "Existing Customer" | string;
  priority?: "Normal" | "Urgent" | "Emergency (Life/Safety)" | string;
  mood?: string;
  callerStyle?: string;
  contextSummary?: string;
  contextOfCall?: string;
}

export async function createAppointment(
  businessId: string,
  data: AppointmentData
): Promise<{ appointmentId?: string; ticketId: string; error?: string }> {
  const client = new Client({
    connectionString: SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();

    const ticketId = data.ticketId || generateTicketId();
    const scheduledDate =
      data.scheduledDate && /^\d{4}-\d{2}-\d{2}$/.test(data.scheduledDate)
        ? data.scheduledDate
        : new Date().toISOString().split("T")[0];
    const arrivalWindow = data.arrivalWindow || "09:00 AM - 12:00 PM";
    const status = data.status || "Confirmed";
    const serviceType = data.serviceType || "HVAC";
    const issueDesc = data.issueDescription || "Service request";

    // Flattened dispatch board values
    const fullName = data.fullName || null;
    const phoneNumber = data.phoneNumber || null;
    const fullAddress = data.fullAddress || null;

    let customerStatus = data.customerStatus || "New Customer";
    if (customerStatus !== "New Customer" && customerStatus !== "Existing Customer") {
      customerStatus = /existing/i.test(customerStatus) ? "Existing Customer" : "New Customer";
    }

    let priority = data.priority || "Normal";
    if (priority !== "Normal" && priority !== "Urgent" && priority !== "Emergency (Life/Safety)") {
      if (/emergency|safety|danger|hazard/i.test(priority)) priority = "Emergency (Life/Safety)";
      else if (/urgent|asap|today|rush/i.test(priority)) priority = "Urgent";
      else priority = "Normal";
    }

    const mood = data.mood || "Neutral";
    const callerStyle = data.callerStyle || "Calm";
    const contextSummary = data.contextSummary || data.contextOfCall || issueDesc;
    const contextOfCall = data.contextOfCall || contextSummary;

    const query = `
      INSERT INTO public.appointments (
        ticket_id, business_id, customer_id, service_type, issue_description,
        scheduled_date, arrival_window, status,
        full_name, phone_number, full_address, customer_status, priority, mood, caller_style, context_summary, context_of_call
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (ticket_id) DO UPDATE SET
        scheduled_date = EXCLUDED.scheduled_date,
        arrival_window = EXCLUDED.arrival_window,
        status = EXCLUDED.status,
        service_type = EXCLUDED.service_type,
        issue_description = EXCLUDED.issue_description,
        full_name = COALESCE(EXCLUDED.full_name, appointments.full_name),
        phone_number = COALESCE(EXCLUDED.phone_number, appointments.phone_number),
        full_address = COALESCE(EXCLUDED.full_address, appointments.full_address),
        customer_status = COALESCE(EXCLUDED.customer_status, appointments.customer_status),
        priority = COALESCE(EXCLUDED.priority, appointments.priority),
        mood = COALESCE(EXCLUDED.mood, appointments.mood),
        caller_style = COALESCE(EXCLUDED.caller_style, appointments.caller_style),
        context_summary = COALESCE(EXCLUDED.context_summary, appointments.context_summary),
        context_of_call = COALESCE(EXCLUDED.context_of_call, appointments.context_of_call)
      RETURNING id, ticket_id;
    `;

    const res = await client.query(query, [
      ticketId,
      businessId,
      data.customerId || null,
      serviceType,
      issueDesc,
      scheduledDate,
      arrivalWindow,
      status,
      fullName,
      phoneNumber,
      fullAddress,
      customerStatus,
      priority,
      mood,
      callerStyle,
      contextSummary,
      contextOfCall,
    ]);

    return {
      appointmentId: res.rows[0]?.id,
      ticketId: res.rows[0]?.ticket_id,
    };
  } catch (err: any) {
    console.error("[TicketService] Error creating appointment:", err);
    return { ticketId: data.ticketId || "", error: err.message };
  } finally {
    try { await client.end(); } catch {}
  }
}

export interface CallLogData {
  businessId: string;
  appointmentId?: string | null;
  callerPhone?: string | null;
  aiSummaryForOwner: string;
  actionNeeded: string;
  callCategory: ValidCallCategory;
  fullTranscript: string;
}

export async function recordCallLog(
  data: CallLogData
): Promise<{ logId?: string; error?: string }> {
  const client = new Client({ connectionString: SUPABASE_DB_URL });
  try {
    await client.connect();

    const query = `
      INSERT INTO public.call_logs (
        business_id, appointment_id, caller_phone, ai_summary_for_owner,
        action_needed, call_category, full_transcript
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id;
    `;

    const res = await client.query(query, [
      data.businessId,
      data.appointmentId || null,
      data.callerPhone || null,
      data.aiSummaryForOwner,
      data.actionNeeded,
      data.callCategory,
      data.fullTranscript,
    ]);

    return { logId: res.rows[0]?.id };
  } catch (err: any) {
    console.error("[TicketService] Error recording call log:", err);
    return { error: err.message };
  } finally {
    try { await client.end(); } catch {}
  }
}

export interface CallConclusionPayload {
  businessId?: string;
  tenantId?: string;
  customer?: CustomerData & {
    isExistingCustomer?: boolean;
    customerStatus?: string;
  };
  ticket?: Partial<AppointmentData> & {
    tenantId?: string;
    ticketId?: string;
    serviceCategory?: string;
    reportedIssue?: string;
    isAfterHours?: boolean;
    bookingStatus?: string;
    dayOfSmsConfirmed?: boolean;
  };
  callRecord?: {
    tenantId?: string;
    ticketId?: string;
    customerMobile?: string;
    summaryForBusinessOwner?: string;
    actionRequiredByTeam?: string;
    callTranscript?: string;
    callType?: string;
    callerMood?: string;
    callerStyle?: string;
    customerStatus?: string;
    priority?: string;
    contextSummary?: string;
    whyCustomerIsUpset?: string | null;
    smsConfirmationSent?: boolean;
  };
}

/**
 * STEP 3.2: The Call Conclusion & Summarization Hook (end_call)
 * Sequence:
 * Step A: Commit the booking to appointments table (generating TKT-YYYYMMDD-XXXX).
 * Step B: Run fast, secondary LLM prompt over full_transcript to extract:
 *         ai_summary_for_owner, action_needed, call_category.
 * Step C: Insert Step B's output + full transcript into call_logs table.
 */
export async function commitCallConclusion(
  payload: CallConclusionPayload
): Promise<{
  success: boolean;
  customerId?: string;
  appointmentId?: string;
  ticketId?: string;
  callLogId?: string;
  aiSummaryForOwner?: string;
  actionNeeded?: string;
  callCategory?: string;
  error?: string;
}> {
  try {
    const rawBusinessId =
      payload.businessId ||
      payload.tenantId ||
      payload.customer?.businessId ||
      payload.customer?.tenantId ||
      DEFAULT_BUSINESS_PROFILE.id;

    const businessId =
      rawBusinessId === "00000000-0000-0000-0000-000000000001"
        ? DEFAULT_BUSINESS_PROFILE.id
        : rawBusinessId;

    // 1. UPSERT Customer if customer details provided
    let customerId: string | undefined = payload.customer?.id;
    const phone =
      payload.ticket?.phoneNumber ||
      payload.customer?.phoneNumber ||
      payload.customer?.mobileNumber ||
      payload.callRecord?.customerMobile ||
      "";
    const cleanPhone = phone.replace(/\D/g, "").slice(-10);

    if (cleanPhone.length === 10) {
      const fullName =
        payload.customer?.fullName ||
        payload.customer?.fullLegalName ||
        "Valued Customer";
      const address =
        payload.customer?.streetAddress ||
        payload.customer?.serviceAddress ||
        "Pending Address Confirmation";
      const city = payload.customer?.city || "Austin";
      const zip = payload.customer?.zipCode || payload.customer?.postalCode || "78701";

      const upsertRes = await upsertCustomer(businessId, {
        fullName,
        phoneNumber: cleanPhone,
        streetAddress: address,
        city,
        zipCode: zip,
        isBlockedSpammer: payload.customer?.isBlockedSpammer,
      });
      if (upsertRes.customerId) {
        customerId = upsertRes.customerId;
      }
    }

    // Step A: Commit booking to appointments table (generate TKT-YYYYMMDD-XXXX ID)
    let appointmentId: string | undefined;
    let committedTicketId: string | undefined =
      payload.ticket?.ticketId || payload.callRecord?.ticketId;

    const hasBookingData = Boolean(
      payload.ticket?.ticketId ||
      payload.ticket?.serviceType ||
      payload.ticket?.serviceCategory ||
      payload.ticket?.scheduledDate
    );

    if (hasBookingData || payload.callRecord?.callType === "standard_booking") {
      committedTicketId = committedTicketId || generateTicketId();
      const serviceType =
        payload.ticket?.serviceType ||
        payload.ticket?.serviceCategory ||
        "HVAC";
      const issueDesc =
        payload.ticket?.issueDescription ||
        payload.ticket?.reportedIssue ||
        "Home service booking";
      const scheduledDate =
        payload.ticket?.scheduledDate || new Date().toISOString().split("T")[0];
      const arrivalWindow = payload.ticket?.arrivalWindow || "09:00 AM - 12:00 PM";
      const status = payload.ticket?.status || payload.ticket?.bookingStatus || "Confirmed";

      // Denormalized customer & dispatch fields
      const derivedFullName =
        payload.ticket?.fullName ||
        payload.customer?.fullName ||
        payload.customer?.fullLegalName ||
        "Valued Customer";

      const derivedPhoneNumber =
        payload.ticket?.phoneNumber ||
        cleanPhone ||
        payload.customer?.phoneNumber ||
        payload.customer?.mobileNumber ||
        payload.callRecord?.customerMobile ||
        "";

      const derivedFullAddress =
        payload.ticket?.fullAddress ||
        payload.customer?.streetAddress ||
        payload.customer?.serviceAddress ||
        "Pending Address";

      const isExisting =
        payload.ticket?.customerStatus === "Existing Customer" ||
        payload.customer?.customerStatus === "Existing Customer" ||
        payload.customer?.isExistingCustomer === true ||
        payload.callRecord?.customerStatus === "Existing Customer";
      const derivedCustomerStatus = isExisting ? "Existing Customer" : "New Customer";

      let derivedPriority =
        payload.ticket?.priority ||
        payload.callRecord?.priority ||
        (payload.callRecord?.callType === "emergency" ? "Emergency (Life/Safety)" : "Normal");
      if (derivedPriority !== "Normal" && derivedPriority !== "Urgent" && derivedPriority !== "Emergency (Life/Safety)") {
        if (/emergency|safety|danger|hazard/i.test(derivedPriority)) derivedPriority = "Emergency (Life/Safety)";
        else if (/urgent|asap|today|rush/i.test(derivedPriority)) derivedPriority = "Urgent";
        else derivedPriority = "Normal";
      }

      const derivedMood =
        payload.ticket?.mood ||
        payload.callRecord?.callerMood ||
        "Neutral";

      const derivedCallerStyle =
        payload.ticket?.callerStyle ||
        payload.callRecord?.callerStyle ||
        "Calm";

      const derivedContextSummary =
        payload.ticket?.contextSummary ||
        payload.ticket?.contextOfCall ||
        payload.callRecord?.contextSummary ||
        payload.callRecord?.summaryForBusinessOwner ||
        issueDesc;

      const apptRes = await createAppointment(businessId, {
        ticketId: committedTicketId,
        businessId,
        customerId,
        serviceType,
        issueDescription: issueDesc,
        scheduledDate,
        arrivalWindow,
        status,
        fullName: derivedFullName,
        phoneNumber: derivedPhoneNumber,
        fullAddress: derivedFullAddress,
        customerStatus: derivedCustomerStatus,
        priority: derivedPriority,
        mood: derivedMood,
        callerStyle: derivedCallerStyle,
        contextSummary: derivedContextSummary,
        contextOfCall: derivedContextSummary,
      });

      if (apptRes.appointmentId) {
        appointmentId = apptRes.appointmentId;
        committedTicketId = apptRes.ticketId;
      }
    }

    // Step B: Run fast, secondary LLM prompt in background taking raw full_transcript
    const fullTranscript =
      payload.callRecord?.callTranscript ||
      `Caller reached service desk. Appointment booked: ${committedTicketId || "None"}.`;

    const summaryResult = await generateCallSummary(fullTranscript, {
      isEmergency: payload.callRecord?.callType === "emergency",
      isEscalation: payload.callRecord?.callType === "human_escalation",
      isOutOfScope: payload.callRecord?.callType === "out_of_scope",
      hasAppointment: Boolean(appointmentId || committedTicketId),
      trade: payload.ticket?.serviceType || payload.ticket?.serviceCategory,
    });

    const aiSummaryForOwner =
      payload.callRecord?.summaryForBusinessOwner &&
      payload.callRecord.summaryForBusinessOwner.length > 30 &&
      !payload.callRecord.summaryForBusinessOwner.includes("Customer contacted service desk")
        ? payload.callRecord.summaryForBusinessOwner
        : summaryResult.aiSummaryForOwner;

    const actionNeeded =
      payload.callRecord?.actionRequiredByTeam &&
      payload.callRecord.actionRequiredByTeam.length > 5
        ? payload.callRecord.actionRequiredByTeam
        : summaryResult.actionNeeded;

    const callCategory = summaryResult.callCategory;

    // Step C: Insert Step B's output + full transcript into call_logs table
    const logRes = await recordCallLog({
      businessId,
      appointmentId,
      callerPhone: cleanPhone.length > 0 ? cleanPhone : null,
      aiSummaryForOwner,
      actionNeeded,
      callCategory,
      fullTranscript,
    });

    console.log(
      `[TicketService] end_call conclusion complete: business=${businessId}, customer=${customerId}, appt=${appointmentId}, log=${logRes.logId}`
    );

    return {
      success: true,
      customerId,
      appointmentId,
      ticketId: committedTicketId,
      callLogId: logRes.logId,
      aiSummaryForOwner,
      actionNeeded,
      callCategory,
    };
  } catch (err: any) {
    console.error("[TicketService] Error in commitCallConclusion:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Updates status when customer confirms attendance via SMS
 */
export async function confirmDayOfSms(ticketId: string): Promise<{ success: boolean; error?: string }> {
  const client = new Client({ connectionString: SUPABASE_DB_URL });
  try {
    await client.connect();
    const res = await client.query(
      `UPDATE public.appointments
       SET status = 'Confirmed (SMS Confirmed)'
       WHERE ticket_id = $1
       RETURNING ticket_id, status;`,
      [ticketId]
    );
    return { success: res.rows.length > 0 };
  } catch (err: any) {
    console.error("[TicketService] Error confirming day-of SMS:", err);
    return { success: false, error: err.message };
  } finally {
    try { await client.end(); } catch {}
  }
}

export interface DayOfSmsTicket {
  ticketId: string;
  tenantId: string;
  businessName: string;
  firstName: string;
  customerMobile: string;
  scheduledDate: string;
  arrivalWindow: string;
  serviceCategory: string;
  reportedIssue: string;
  dayOfSmsConfirmed: boolean;
  smsMessage: string;
}

export async function getPendingDayOfSmsTickets(businessId?: string): Promise<DayOfSmsTicket[]> {
  const client = new Client({ connectionString: SUPABASE_DB_URL });
  try {
    await client.connect();
    let query = `
      SELECT 
        a.ticket_id,
        a.business_id,
        a.service_type,
        a.issue_description,
        to_char(a.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
        a.arrival_window,
        (a.status LIKE '%SMS Confirmed%') as day_of_sms_confirmed,
        COALESCE(c.full_name, 'Valued Customer') as full_name,
        COALESCE(c.phone_number, '555-0100') as phone_number,
        COALESCE(b.company_name, 'Apex Heating & Air') as company_name
      FROM public.appointments a
      LEFT JOIN public.customers c ON a.customer_id = c.id
      LEFT JOIN public.businesses b ON a.business_id = b.id
      WHERE (a.scheduled_date >= CURRENT_DATE - INTERVAL '1 day' OR a.scheduled_date IS NOT NULL)
    `;
    const params: any[] = [];
    if (businessId) {
      const normalized =
        businessId === "00000000-0000-0000-0000-000000000001"
          ? "b0000000-0000-0000-0000-000000000001"
          : businessId;
      params.push(normalized);
      query += ` AND a.business_id = $1`;
    }
    query += ` ORDER BY a.created_at DESC LIMIT 20;`;

    const res = await client.query(query, params);
    return res.rows.map((r) => {
      const firstName = r.full_name.split(" ")[0] || "Valued Customer";
      const smsMessage = `Hi ${firstName}, your ${r.company_name} tech is scheduled to arrive between ${r.arrival_window} today. Please reply YES to confirm someone is home.`;
      return {
        ticketId: r.ticket_id,
        tenantId: r.business_id,
        businessName: r.company_name,
        firstName,
        customerMobile: r.phone_number,
        scheduledDate: r.scheduled_date,
        arrivalWindow: r.arrival_window,
        serviceCategory: r.service_type,
        reportedIssue: r.issue_description,
        dayOfSmsConfirmed: Boolean(r.day_of_sms_confirmed),
        smsMessage,
      };
    });
  } catch (err) {
    console.error("[TicketService] Error fetching day-of SMS tickets:", err);
    return [];
  } finally {
    try { await client.end(); } catch {}
  }
}

/**
 * Builds the confirmation SMS body to send to the customer immediately after booking.
 * Format is concise, all info present, and instructs the customer to reply YES.
 */
export function buildCustomerConfirmationSms(params: {
  ticketId: string;
  customerFirstName: string;
  businessName: string;
  serviceAddress: string;
  issueDescription: string;
  scheduledDate: string;
  arrivalWindow: string;
}): string {
  const { ticketId, customerFirstName, businessName, serviceAddress, issueDescription, scheduledDate, arrivalWindow } = params;

  // Format arrival window as "between 1 PM and 4 PM" not "01:00 PM - 04:00 PM"
  const readableWindow = arrivalWindow.replace(
    /^(\d{2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{2}):(\d{2})\s*(AM|PM)$/i,
    (_full: string, h1: string, _m1: string, p1: string, h2: string, _m2: string, p2: string) =>
      `between ${parseInt(h1, 10)} ${p1.toUpperCase()} and ${parseInt(h2, 10)} ${p2.toUpperCase()}`
  );

  return [
    `Hi ${customerFirstName}! Your ${businessName} appointment is confirmed.`,
    ``,
    `Ticket: ${ticketId}`,
    `Service: ${issueDescription}`,
    `Address: ${serviceAddress}`,
    `Date: ${scheduledDate}`,
    `Window: ${readableWindow}`,
    ``,
    `ACTION REQUIRED: Reply YES to confirm someone will be home.`,
    `Our technician will call or SMS you 2-3 hours before leaving for your job.`,
    ``,
    `Questions? Call ${businessName} directly.`,
  ].join("\n");
}

export async function triggerNotificationWebhook(
  ticketId: string,
  payload: {
    customerName: string;
    customerPhone: string;
    serviceAddress: string;
    trade?: string;
    issueDescription: string;
    preferredSchedule: string;
    scheduledDate?: string;
    arrivalWindow?: string;
    businessName?: string;
    sessionId?: string;
  }
): Promise<{ success: boolean; customerSmsBody?: string; teamNotification?: object }> {
  const firstName = (payload.customerName || "").split(" ")[0] || "Valued Customer";
  const biz = payload.businessName || "Apex Heating & Air";
  const schedDate = payload.scheduledDate || new Date().toISOString().split("T")[0];
  const window = payload.arrivalWindow || payload.preferredSchedule || "Scheduled Window";

  const customerSmsBody = buildCustomerConfirmationSms({
    ticketId,
    customerFirstName: firstName,
    businessName: biz,
    serviceAddress: payload.serviceAddress,
    issueDescription: payload.issueDescription,
    scheduledDate: schedDate,
    arrivalWindow: window,
  });

  const teamNotification = {
    event: "NEW_JOB_BOOKED",
    ticketId,
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    serviceAddress: payload.serviceAddress,
    trade: payload.trade || "HVAC",
    issue: payload.issueDescription,
    scheduledDate: schedDate,
    arrivalWindow: window,
    action: "Assign technician. Notify tech to call/SMS customer 2-3 hours before departure. Await customer YES confirmation.",
    timestamp: new Date().toISOString(),
    sessionId: payload.sessionId,
  };

  // Log both payloads (real SMS/push integration would go here)
  console.log(JSON.stringify({ event: "REGENT_CUSTOMER_SMS", ticketId, to: payload.customerPhone, body: customerSmsBody, timestamp: new Date().toISOString() }));
  console.log(JSON.stringify({ event: "REGENT_TEAM_NOTIFICATION", ticketId, payload: teamNotification, timestamp: new Date().toISOString() }));

  return { success: true, customerSmsBody, teamNotification };
}


/**
 * Disconnect and block spammer in the new schema:
 * 1. Sets is_blocked_spammer = TRUE in customers
 * 2. Logs termination in call_logs with call_category = 'Out of Scope'
 */
export async function disconnectAndBlockCaller(
  businessId: string,
  customerMobile?: string | null,
  reason: string = "Repeated out-of-scope trivia / non-business inquiries (Strike 3 limit reached)",
  transcript?: string
): Promise<{ success: boolean; event: string }> {
  const resolvedBusinessId =
    businessId === "00000000-0000-0000-0000-000000000001"
      ? DEFAULT_BUSINESS_PROFILE.id
      : businessId || DEFAULT_BUSINESS_PROFILE.id;

  const eventPayload = {
    event: "disconnect_and_block",
    webhook: "DISCONNECT_AND_BLOCK",
    businessId: resolvedBusinessId,
    customerMobile: customerMobile || "UNKNOWN",
    reason,
    timestamp: new Date().toISOString(),
    action: "TERMINATE_CALL_AND_BLACKLIST_CALLER",
  };

  console.log(`[WEBHOOK_DISPATCH] disconnect_and_block:`, JSON.stringify(eventPayload));

  const client = new Client({ connectionString: SUPABASE_DB_URL });
  try {
    await client.connect();

    const cleanPhone = (customerMobile || "").replace(/\D/g, "").slice(-10);

    // 1. Mark customer as blocked spammer
    if (cleanPhone) {
      await client.query(
        `UPDATE public.customers
         SET is_blocked_spammer = TRUE
         WHERE phone_number = $1 AND business_id = $2;`,
        [cleanPhone, resolvedBusinessId]
      );
    }

    // 2. Insert call log under 'Out of Scope'
    await client.query(
      `INSERT INTO public.call_logs (
        business_id,
        caller_phone,
        ai_summary_for_owner,
        action_needed,
        call_category,
        full_transcript
      ) VALUES ($1, $2, $3, $4, $5, $6);`,
      [
        resolvedBusinessId,
        cleanPhone || null,
        `Call terminated and caller blocked: ${reason}`,
        "No action needed - spam line terminated.",
        "Out of Scope",
        transcript || "Caller repeatedly asked out-of-scope trivia after warnings.",
      ]
    );

    return { success: true, event: "disconnect_and_block" };
  } catch (err) {
    console.error("[TicketService] Error in disconnectAndBlockCaller:", err);
    return { success: false, event: "disconnect_and_block" };
  } finally {
    try { await client.end(); } catch {}
  }
}
