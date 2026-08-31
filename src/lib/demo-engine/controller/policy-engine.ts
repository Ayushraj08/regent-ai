import { EngineRequest, NLUResponse, ConversationState, Lead, FieldMetadata, EngineResponse, ActionType } from "../types";
import { validateName, validatePhone, validateAddress, validateService, validateProblem, validateUrgency } from "./validators";
import { ServiceCatalog } from "../config/taxonomy";

function validateRequestType(req: string | null) {
  if (!req || req.trim().length === 0) return { isValid: false, status: "MISSING" };
  return { isValid: true, status: "CAPTURED", normalizedValue: req.trim().toUpperCase() };
}

export function evaluatePolicy(request: EngineRequest, nlu: NLUResponse): Partial<EngineResponse> {
  const nextLead: Lead = JSON.parse(JSON.stringify(request.lead));
  const missingFields: string[] = [];

  // 1. Merge extracted info
  if (nlu.extracted) {
    const processField = (key: keyof Lead, extractedField: FieldMetadata | undefined, validator: (v: string | null) => any) => {
      if (!extractedField) return;
      const existing = nextLead[key] as FieldMetadata;
      if (!existing) return;

      // Treat empty string same as null for LLM outputs
      const hasNewValue = extractedField.value !== null && extractedField.value.trim() !== "";
      const isAlreadyCaptured = ['CAPTURED', 'CONFIRMED', 'VALID', 'CORRECTED'].includes(existing.status);

      if (hasNewValue) {
        const valRes = validator(extractedField.value);
        // Overwrite if the new value is valid, OR if we didn't already have a valid value
        if (valRes.isValid || !isAlreadyCaptured) {
          existing.value = valRes.normalizedValue || extractedField.value;
          existing.status = valRes.status;
          existing.confidence = extractedField.confidence;
          existing.turn = request.turnCount;
          existing.updatedAt = new Date().toISOString();
        }
      } else if (['REFUSED', 'NOT_APPLICABLE'].includes(extractedField.status)) {
        // Only accept explicit refusal if we don't already have a captured value
        if (!isAlreadyCaptured) {
          existing.status = extractedField.status;
          existing.turn = request.turnCount;
          existing.updatedAt = new Date().toISOString();
        }
      }
    };

    processField("name", nlu.extracted.name, validateName);
    processField("phone", nlu.extracted.phone, validatePhone);
    processField("address", nlu.extracted.address, validateAddress);
    processField("requestType", nlu.extracted.requestType, validateRequestType);
    processField("service", nlu.extracted.service, validateService);
    processField("problem", nlu.extracted.problem, validateProblem);
    processField("urgency", nlu.extracted.urgency, validateUrgency);
  }

  // 2. Safety & Escalation Rules
  if (nlu.safety.status === 'CRITICAL') {
    return { state: "ESCALATED", extracted: nextLead, missingFields: [], safety: nlu.safety, shouldTransfer: true, complete: false, action: "ESCALATE" };
  }
  if (nlu.intent === 'HUMAN_REQUEST') {
    return { state: "TRANSFER", extracted: nextLead, missingFields: [], safety: nlu.safety, shouldTransfer: true, complete: false, action: "TRANSFER" };
  }
  if (nlu.intent === 'OFF_TOPIC') {
    return { state: request.state, extracted: nextLead, missingFields: [], safety: nlu.safety, shouldTransfer: false, complete: false, action: "CLARIFY" };
  }
  
  // 3. Explicit End Request (V4 rule 27)
  const endSignal = /(bye|that's all|we should end|i need to go|nothing else|end the call)/i.test(request.utterance);
  if (endSignal && request.state !== "START") {
    const ticketId = request.ticketId || `REG-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    return { state: "END", extracted: nextLead, missingFields: [], safety: nlu.safety, shouldTransfer: false, complete: true, ticketId, action: "CLOSE" };
  }

  // 4. Determine missing fields based on dynamic taxonomy
  let requiredFields = ["name", "phone", "address", "requestType", "service"];
  const tradeName = nextLead.trade;
  const serviceId = nextLead.service?.value;
  const rType = nextLead.requestType?.value;

  let serviceDefinition = undefined;
  if (tradeName && serviceId && ServiceCatalog[tradeName]) {
    serviceDefinition = ServiceCatalog[tradeName].find(s => s.id === serviceId);
  }

  if (serviceDefinition) {
    for (const field of serviceDefinition.requiredFields) {
      if (!requiredFields.includes(field)) requiredFields.push(field);
    }
  } else {
    // If unknown service, fallback inference
    if (!rType || rType === "REPAIR" || rType === "EMERGENCY" || rType === "OTHER") {
      requiredFields.push("problem", "urgency");
    } else {
      requiredFields.push("urgency");
    }
  }

  let firstMissingField: string | null = null;
  for (const field of requiredFields) {
    const fieldData = nextLead[field as keyof Lead] as FieldMetadata;
    // Don't ask again if we already have it captured, confirmed, or corrected
    if (['MISSING', 'AMBIGUOUS', 'INVALID'].includes(fieldData.status)) {
      missingFields.push(field);
      if (!firstMissingField) firstMissingField = field;
    }
  }

  const complete = missingFields.length === 0;

  // 5. State transitions & action resolution
  let nextState: ConversationState = "COLLECTING";
  let action: ActionType = "CONTINUE";
  let targetField: string | undefined = undefined;
  let responseType = "ACKNOWLEDGE"; // legacy fallback

  if (!complete) {
    if (firstMissingField) {
      action = "ASK_FIELD";
      targetField = firstMissingField;
      responseType = `ASK_${firstMissingField.toUpperCase()}`;
    }
  } else {
    // Lead is complete. Transition smoothly to closing flow without repeating loops.
    if (request.state === "START" || request.state === "COLLECTING") {
      nextState = "ISSUE_CONFIRMATION";
      action = "CONFIRM";
      responseType = "ASK_ISSUE_CONFIRMATION";
    } else if (request.state === "ISSUE_CONFIRMATION") {
      nextState = "CLOSING";
      action = "CONTINUE";
      responseType = "LEAD_READY_RECAP";
    } else if (request.state === "CLOSING") {
      nextState = "END";
      action = "CLOSE";
      responseType = "END_CALL";
    } else if (request.state === "END") {
      nextState = "END";
      action = "CLOSE";
      responseType = "END_CALL";
    }
  }

  // 6. Action Guard (V4 rule 12)
  if (action === "ASK_FIELD" && targetField) {
    const targetFieldData = nextLead[targetField as keyof Lead] as FieldMetadata;
    if (targetFieldData && ['CAPTURED', 'CONFIRMED', 'VALID', 'CORRECTED'].includes(targetFieldData.status)) {
      console.warn(`[ACTION GUARD] Blocked attempt to ask for ${targetField} which is already ${targetFieldData.status}.`);
      action = "CLARIFY";
      targetField = undefined;
      responseType = "CLARIFY";
    }
  }

  // Generate ticket if complete and at the end of the line
  let ticketId = request.ticketId || null;
  if (complete && nextState !== "COLLECTING" && !ticketId) {
    ticketId = `REG-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }

  return {
    state: nextState,
    extracted: nextLead,
    missingFields,
    safety: nlu.safety,
    shouldTransfer: false,
    complete,
    ticketId,
    action,
    targetField,
    responseType
  };
}
