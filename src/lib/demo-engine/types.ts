import { z } from "zod";

// ─── Conversation State ────────────────────────────────────────────────────────

export const ConversationStateEnum = z.enum([
  "START",
  "COLLECTING",
  "ISSUE_CONFIRMATION",
  "CLOSING",
  "ESCALATED",
  "TRANSFER",
  "END"
]);
export type ConversationState = z.infer<typeof ConversationStateEnum>;

// ─── Action Types ─────────────────────────────────────────────────────────────

export const ActionTypeEnum = z.enum([
  "ASK_FIELD",
  "CLARIFY",
  "CONFIRM",
  "CONTINUE",
  "TRANSFER",
  "ESCALATE",
  "HANDLE_COMPLAINT",
  "COMPLETE",
  "CLOSE"
]);
export type ActionType = z.infer<typeof ActionTypeEnum>;

// ─── Trade ────────────────────────────────────────────────────────────────────

export const TradeEnum = z.enum(["HVAC", "PLUMBING", "ELECTRICAL"]);
export type Trade = z.infer<typeof TradeEnum>;

// ─── Intent ───────────────────────────────────────────────────────────────────

export const IntentEnum = z.enum([
  "NEW_SERVICE_REQUEST",
  "EXISTING_CUSTOMER",
  "EMERGENCY",
  "HUMAN_REQUEST",
  "PRICE_QUESTION",
  "HOURS_QUESTION",
  "SERVICE_AREA_QUESTION",
  "STATUS_QUESTION",
  "CANCELLATION",
  "RESCHEDULE",
  "GENERAL_QUESTION",
  "COMPLAINT",
  "WRONG_NUMBER",
  "SPAM_OR_ABUSE",
  "OFF_TOPIC",
  "UNSURE",
  "PROVIDE_INFORMATION",
  "END_CALL",
  "SOCIAL_QUESTION",
  "OTHER"
]);
export type Intent = z.infer<typeof IntentEnum>;

// ─── Request Type (first-class) ───────────────────────────────────────────────

export const RequestTypeEnum = z.enum([
  "REPAIR",
  "INSTALLATION",
  "REPLACEMENT",
  "MAINTENANCE",
  "INSPECTION",
  "DIAGNOSTIC",
  "UPGRADE",
  "ESTIMATE",
  "GENERAL_SERVICE",
  "EMERGENCY",
  "OTHER",
  "UNKNOWN"
]);
export type RequestType = z.infer<typeof RequestTypeEnum>;

// ─── Customer Behavior ────────────────────────────────────────────────────────

export const BehaviorEnum = z.enum([
  "CALM",
  "NEUTRAL",
  "POSITIVE",
  "CONFUSED",
  "ANXIOUS",
  "FRUSTRATED",
  "ANGRY",
  "RESISTANT",
  "RUSHED",
  "UNCERTAIN",
  "DISTRESSED",
  "HOSTILE",
  "COOPERATIVE",
  "UNCOOPERATIVE",
  "TALKATIVE",
  "MINIMAL",
  "OFF_TOPIC"
]);
export type Behavior = z.infer<typeof BehaviorEnum>;

// ─── Field Status ─────────────────────────────────────────────────────────────

export const FieldStatusEnum = z.enum([
  "MISSING",
  "CAPTURED",
  "VALID",           // Phase 1: added VALID
  "CONFIRMED",
  "CORRECTED",
  "AMBIGUOUS",
  "INVALID",
  "REFUSED",
  "UNKNOWN",
  "NOT_APPLICABLE"
]);
export type FieldStatus = z.infer<typeof FieldStatusEnum>;

// A set of statuses that indicate the field has a usable value
export const SETTLED_STATUSES: FieldStatus[] = [
  "VALID",
  "CAPTURED",
  "CONFIRMED",
  "CORRECTED"
];

export function isSettled(status: FieldStatus): boolean {
  return SETTLED_STATUSES.includes(status);
}

// ─── Field Metadata ───────────────────────────────────────────────────────────

export const FieldMetadataSchema = z.object({
  value: z.string().nullable(),
  status: FieldStatusEnum,
  confidence: z.number().min(0).max(1),
  sourceTurn: z.number().default(0),   // Phase 1: when first captured
  updatedTurn: z.number().default(0),  // Phase 1: when last updated
  // Legacy compat — keep 'turn' as an alias for updatedTurn
  turn: z.number().default(0).optional(),
  updatedAt: z.string().optional()
});
export type FieldMetadata = z.infer<typeof FieldMetadataSchema>;

/** Create a default empty field */
export function emptyField(): FieldMetadata {
  return { value: null, status: "MISSING", confidence: 0, sourceTurn: 0, updatedTurn: 0, turn: 0 };
}

// ─── Safety ───────────────────────────────────────────────────────────────────

export const SafetySchema = z.object({
  status: z.enum(["NORMAL", "ELEVATED", "CRITICAL", "UNKNOWN"]),
  category: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().nullable().optional()
});
export type Safety = z.infer<typeof SafetySchema>;

// ─── Question Ledger ──────────────────────────────────────────────────────────

export const QuestionLedgerEntrySchema = z.object({
  questionId: z.string(),
  field: z.string(),
  turnAsked: z.number(),
  answerTurn: z.number().nullable(),
  status: z.enum(["PENDING", "ANSWERED", "SKIPPED"]),
  clarificationCount: z.number().default(0)
});
export type QuestionLedgerEntry = z.infer<typeof QuestionLedgerEntrySchema>;

// ─── Correction Record ────────────────────────────────────────────────────────

export const CorrectionRecordSchema = z.object({
  field: z.string(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  turn: z.number()
});
export type CorrectionRecord = z.infer<typeof CorrectionRecordSchema>;

// ─── Conversation Turn ────────────────────────────────────────────────────────

export const ConversationTurnSchema = z.object({
  role: z.enum(["CUSTOMER", "REGENT"]),
  content: z.string()
});
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

// ─── Lead Fields ─────────────────────────────────────────────────────────────
// These are the independently-tracked customer data fields
// requestType and service are now SEPARATE top-level fields on ConversationSession

export const LeadFieldsSchema = z.object({
  name: FieldMetadataSchema,
  phone: FieldMetadataSchema,
  address: FieldMetadataSchema,
  problem: FieldMetadataSchema,
  urgency: FieldMetadataSchema,
  timing: FieldMetadataSchema,     // Phase 1: when do they need service
  equipment: FieldMetadataSchema,  // Phase 1: what equipment is involved
  context: FieldMetadataSchema,    // Phase 1: additional context
});
export type LeadFields = z.infer<typeof LeadFieldsSchema>;

// ─── Authoritative Conversation Session ───────────────────────────────────────
// This is the single source of truth for all conversation state.
// The client owns this state and sends it with every turn.

export const ConversationSessionSchema = z.object({
  sessionId: z.string(),
  turnCount: z.number().default(0),
  state: ConversationStateEnum,

  // First-class dimensions (separate from lead fields)
  intent: IntentEnum.nullable().default(null),
  trade: TradeEnum.nullable().default(null),
  requestType: RequestTypeEnum.nullable().default(null),   // INSTALLATION, REPAIR, etc.
  primaryService: z.string().nullable().default(null),     // catalog ID e.g. "AC_INSTALLATION"
  additionalServices: z.array(z.string()).default([]),     // additional catalog IDs

  // Independent field state
  lead: LeadFieldsSchema,

  // Safety
  safety: SafetySchema.default({
    status: "NORMAL",
    category: null,
    confidence: 1.0
  }),

  // Customer behavior
  customerBehavior: BehaviorEnum.default("NEUTRAL"),

  // Derived state (updated each turn by the engine)
  currentAction: ActionTypeEnum.default("CONTINUE"),
  missingFields: z.array(z.string()).default([]),

  // History
  corrections: z.array(CorrectionRecordSchema).default([]),
  questionLedger: z.array(QuestionLedgerEntrySchema).default([]),
  conversationHistory: z.array(ConversationTurnSchema).default([]),

  // Dev diagnostics — never expose in production
  diagnosticReason: z.string().default(""),

  // Legacy compat
  ticketId: z.string().nullable().optional()
});
export type ConversationSession = z.infer<typeof ConversationSessionSchema>;

/** Create an empty session for a given trade */
export function makeEmptySession(trade: Trade | null, sessionId?: string): ConversationSession {
  return {
    sessionId: sessionId ?? crypto.randomUUID(),
    turnCount: 0,
    state: "START",
    intent: null,
    trade,
    requestType: null,
    primaryService: null,
    additionalServices: [],
    lead: {
      name: emptyField(),
      phone: emptyField(),
      address: emptyField(),
      problem: emptyField(),
      urgency: emptyField(),
      timing: emptyField(),
      equipment: emptyField(),
      context: emptyField(),
    },
    safety: { status: "NORMAL", category: null, confidence: 1.0 },
    customerBehavior: "NEUTRAL",
    currentAction: "CONTINUE",
    missingFields: [],
    corrections: [],
    questionLedger: [],
    conversationHistory: [],
    diagnosticReason: ""
  };
}

// ─── NLU Response (what the LLM returns) ──────────────────────────────────────

export const NLUExtractedSchema = z.object({
  // Lead fields
  name: FieldMetadataSchema.optional(),
  phone: FieldMetadataSchema.optional(),
  address: FieldMetadataSchema.optional(),
  problem: FieldMetadataSchema.optional(),
  urgency: FieldMetadataSchema.optional(),
  timing: FieldMetadataSchema.optional(),
  equipment: FieldMetadataSchema.optional(),
  context: FieldMetadataSchema.optional(),

  // First-class dimensions extracted by LLM
  requestType: z.string().nullable().optional(),  // raw string, will be validated
  service: z.string().nullable().optional(),       // raw string / catalog ID candidate
  additionalService: z.string().nullable().optional(), // optional second service
});
export type NLUExtracted = z.infer<typeof NLUExtractedSchema>;

export const NLUResponseSchema = z.object({
  intent: IntentEnum,
  behavior: BehaviorEnum,
  confidence: z.number().min(0).max(1),
  extracted: NLUExtractedSchema.optional(),
  safety: SafetySchema,
  // Optional direct correction signal
  isCorrection: z.boolean().optional(),
  correctionField: z.string().nullable().optional(),
});
export type NLUResponse = z.infer<typeof NLUResponseSchema>;

// ─── Engine API Schemas ───────────────────────────────────────────────────────
// The API now accepts a ConversationSession + the new utterance

export const EngineRequestSchema = z.object({
  session: ConversationSessionSchema,
  utterance: z.string(),
});
export type EngineRequest = z.infer<typeof EngineRequestSchema>;

export const EngineResponseSchema = z.object({
  response: z.string(),
  session: ConversationSessionSchema,  // full updated session returned to client
  shouldTransfer: z.boolean(),
  complete: z.boolean(),
  // Legacy compatibility fields
  state: ConversationStateEnum,
  missingFields: z.array(z.string()),
  safety: SafetySchema,
  action: ActionTypeEnum,
  targetField: z.string().optional(),
  ticketId: z.string().nullable().optional(),
});
export type EngineResponse = z.infer<typeof EngineResponseSchema>;

// ─── Legacy types (kept for backward compat in older scripts) ─────────────────

export const QuestionCountersSchema = z.object({
  issueConfirmations: z.number().default(0),
  recaps: z.number().default(0),
  anythingElsePrompts: z.number().default(0),
  endCallPrompts: z.number().default(0),
});
export type QuestionCounters = z.infer<typeof QuestionCountersSchema>;
