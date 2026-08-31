import { z } from "zod";

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

export const ActionTypeEnum = z.enum([
  "ASK_FIELD", 
  "CLARIFY", 
  "CONFIRM", 
  "CONTINUE", 
  "TRANSFER", 
  "ESCALATE", 
  "COMPLETE", 
  "CLOSE"
]);
export type ActionType = z.infer<typeof ActionTypeEnum>;

export const TradeEnum = z.enum(["HVAC", "PLUMBING", "ELECTRICAL"]);
export type Trade = z.infer<typeof TradeEnum>;

export const IntentEnum = z.enum([
  "NEW_SERVICE_REQUEST", "EXISTING_CUSTOMER", "EMERGENCY", "HUMAN_REQUEST",
  "PRICE_QUESTION", "HOURS_QUESTION", "SERVICE_AREA_QUESTION", "STATUS_QUESTION",
  "CANCELLATION", "RESCHEDULE", "GENERAL_QUESTION", "COMPLAINT", "WRONG_NUMBER",
  "SPAM_OR_ABUSE", "OFF_TOPIC", "UNSURE", "OTHER"
]);
export type Intent = z.infer<typeof IntentEnum>;

export const BehaviorEnum = z.enum([
  "CALM", "NEUTRAL", "POSITIVE", "CONFUSED", "ANXIOUS", "FRUSTRATED", 
  "ANGRY", "RESISTANT", "RUSHED", "UNCERTAIN", "DISTRESSED", "HOSTILE", 
  "COOPERATIVE", "UNCOOPERATIVE", "TALKATIVE", "MINIMAL", "OFF_TOPIC"
]);
export type Behavior = z.infer<typeof BehaviorEnum>;

export const FieldStatusEnum = z.enum([
  "MISSING", "INFERRED", "CAPTURED", "CONFIRMED", "CORRECTED", "AMBIGUOUS", "INVALID", "REFUSED", "UNKNOWN", "NOT_APPLICABLE"
]);
export type FieldStatus = z.infer<typeof FieldStatusEnum>;

export const FieldMetadataSchema = z.object({
  value: z.string().nullable(),
  status: FieldStatusEnum,
  confidence: z.number().min(0).max(1),
  turn: z.number(),
  updatedAt: z.string().optional()
});
export type FieldMetadata = z.infer<typeof FieldMetadataSchema>;

export const RequestTypeEnum = z.enum([
  "REPAIR", "INSTALLATION", "REPLACEMENT", "MAINTENANCE", "INSPECTION", 
  "DIAGNOSTIC", "UPGRADE", "ESTIMATE", "GENERAL_SERVICE", "EMERGENCY", "OTHER", "UNKNOWN"
]);
export type RequestType = z.infer<typeof RequestTypeEnum>;

export const LeadSchema = z.object({
  name: FieldMetadataSchema,
  phone: FieldMetadataSchema,
  address: FieldMetadataSchema,
  requestType: FieldMetadataSchema,
  service: FieldMetadataSchema,
  problem: FieldMetadataSchema,
  urgency: FieldMetadataSchema,
  trade: TradeEnum.nullable(),
  ticketId: z.string().optional(),
});
export type Lead = z.infer<typeof LeadSchema>;

export const SafetySchema = z.object({
  status: z.enum(["NORMAL", "ELEVATED", "CRITICAL", "UNKNOWN"]),
  category: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().nullable().optional()
});
export type Safety = z.infer<typeof SafetySchema>;

export const QuestionCountersSchema = z.object({
  issueConfirmations: z.number().default(0),
  recaps: z.number().default(0),
  anythingElsePrompts: z.number().default(0),
  endCallPrompts: z.number().default(0),
});
export type QuestionCounters = z.infer<typeof QuestionCountersSchema>;

export const EngineRequestSchema = z.object({
  state: ConversationStateEnum,
  trade: z.string().nullable().optional(),
  lead: LeadSchema,
  utterance: z.string(),
  conversationHistory: z.array(z.object({
    role: z.enum(["CUSTOMER", "REGENT"]),
    content: z.string(),
  })),
  turnCount: z.number().default(0),
  ticketId: z.string().nullable().optional(),
  counters: QuestionCountersSchema.optional()
});
export type EngineRequest = z.infer<typeof EngineRequestSchema>;

export const NLUResponseSchema = z.object({
  intent: IntentEnum,
  behavior: BehaviorEnum,
  confidence: z.number().min(0).max(1),
  extracted: z.object({
    name: FieldMetadataSchema.optional(),
    phone: FieldMetadataSchema.optional(),
    address: FieldMetadataSchema.optional(),
    requestType: FieldMetadataSchema.optional(),
    service: FieldMetadataSchema.optional(),
    problem: FieldMetadataSchema.optional(),
    urgency: FieldMetadataSchema.optional()
  }).optional(),
  safety: SafetySchema
});
export type NLUResponse = z.infer<typeof NLUResponseSchema>;

export const EngineResponseSchema = z.object({
  response: z.string().describe("Regent's spoken response back to the customer"),
  state: ConversationStateEnum.describe("The next state in the state machine"),
  extracted: LeadSchema.describe("The lead object updated with newly extracted information"),
  missingFields: z.array(z.string()).describe("List of core fields still missing (name, phone, address, problem, urgency)"),
  safety: SafetySchema.describe("Safety status of the customer's utterance"),
  shouldTransfer: z.boolean().describe("Whether the conversation needs to be escalated to a human"),
  complete: z.boolean().describe("Whether all core fields have been gathered"),
  ticketId: z.string().nullable().optional().describe("Generated ticket ID when the lead is complete"),
  action: ActionTypeEnum.describe("The overarching action for the response generator"),
  targetField: z.string().optional().describe("The specific field to target (if action is ASK_FIELD or CLARIFY)"),
  responseType: z.string().optional()
});
export type EngineResponse = z.infer<typeof EngineResponseSchema>;

