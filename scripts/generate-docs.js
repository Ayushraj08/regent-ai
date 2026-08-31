const fs = require('fs');
const path = require('path');

const docsDir = path.join(__dirname, '../docs/agent');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

const docs = {
  'intent-taxonomy.md': `# Intent Taxonomy\n\nAllowed intents: NEW_SERVICE_REQUEST, EXISTING_CUSTOMER, EMERGENCY, HUMAN_REQUEST, PRICE_QUESTION, HOURS_QUESTION, SERVICE_AREA_QUESTION, STATUS_QUESTION, CANCELLATION, RESCHEDULE, GENERAL_QUESTION, COMPLAINT, WRONG_NUMBER, SPAM_OR_ABUSE, OFF_TOPIC, UNSURE, OTHER.`,
  'behavior-taxonomy.md': `# Behavior Taxonomy\n\nAllowed behaviors: CALM, NEUTRAL, POSITIVE, CONFUSED, ANXIOUS, FRUSTRATED, ANGRY, RESISTANT, RUSHED, UNCERTAIN, DISTRESSED, HOSTILE, COOPERATIVE, UNCOOPERATIVE, TALKATIVE, MINIMAL, OFF_TOPIC.`,
  'safety-policy.md': `# Safety Policy\n\nStatus: NORMAL, ELEVATED, CRITICAL, UNKNOWN.\nCategories: GAS_SUSPECTED, FIRE, SMOKE, BURNING_ODOR, ELECTRICAL_HAZARD, IMMEDIATE_DANGER, ACTIVE_FLOODING, BURST_PIPE, UNCONTROLLED_LEAK, SEWAGE_BACKUP, PROPERTY_DAMAGE.`,
  'response-policy.md': `# Response Policy\n\nResponse types: GREETING, ACKNOWLEDGE, ASK_FIELD, CLARIFY, CONFIRM, REDIRECT, PRICE_POLICY_RESPONSE, HUMAN_TRANSFER, ESCALATION, ERROR_RECOVERY, GOODBYE.\nLength: 5-20 words max.`,
  'field-policy.md': `# Field Policy\n\nFields must have metadata: { value, status, confidence, turn, updatedAt }.\nStatuses: MISSING, INFERRED, CAPTURED, CONFIRMED, CORRECTED, REFUSED, UNKNOWN, NOT_APPLICABLE.`,
  'refusal-policy.md': `# Refusal Policy\n\nIf refused, set status=REFUSED. Do not endlessly loop. Follow business policy.`,
  'interruption-policy.md': `# Interruption Policy\n\nIf user asks unrelated question (e.g. price) while asking for address, answer safely, then return to field collection.`,
  'fallback-policy.md': `# Fallback Policy\n\nIf STT/LLM fails or provider unavailable, use: "I’m having trouble understanding that. I can connect you with the team, or you can tell me what service you need."`,
  'business-policy.md': `# Business Policy\n\nPricing: DO_NOT_DISCLOSE (default). Availability: Never fabricate. Service area/Hours: Answer deterministically if configured.`,
  'adversarial-cases.md': `# Adversarial Cases\n\nMust handle: "I don't know", "Stop asking", "Wrong number", absurd inputs. Do not invent info. Use OTHER or CLARIFY.`,
  'regression-matrix.md': `# Regression Matrix\n\nTest behaviors vs intents vs trades. Must verify: Lead extraction, State progression, Emergency overrides, Transfers, Text fallback.`
};

for (const [filename, content] of Object.entries(docs)) {
  fs.writeFileSync(path.join(docsDir, filename), content);
  console.log(`Created ${filename}`);
}
