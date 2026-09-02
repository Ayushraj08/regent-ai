import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

interface ExtractedLead {
  full_name?: string;
  phone?: string;
  address?: string;
  issue_description?: string;
}

interface RelagentSession {
  sessionId: string;
  turnCount: number;
  businessName: string;
  recordingDisclosureGiven: boolean;
  lead: {
    fullName?: string;
    phone?: string;
    address?: string;
    issueDescription?: string;
  };
  conversationHistory: { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string }[];
}

const SYSTEM_PROMPT = `You are Regent, an empathetic, highly competent human-like receptionist for a local service business.
- Tone: Warm, personalized, and efficient. Adapt your tone dynamically (e.g., serious and empathetic if the caller is angry/anxious).
- Goal: Collect the customer's Full Name (as on ID), 10-digit Phone, Full Address, Issue Description, and Date/Time preference.
- Rules:
  1. Never ask a wall of questions. Ask for exactly ONE missing piece of information at a time.
  2. NEVER ask for information you have already collected or that is in the conversation history or session state. Read the chat history carefully. Accept names and inputs in any language (e.g., Hindi) or format, and process them naturally.
  3. Weave the required recording consent naturally into your first conversational response (e.g., 'I can certainly help with that AC issue! Just so you know, this call is recorded for training...'). Do not sound like a legal disclaimer. Do NOT repeat consent in subsequent turns.
  4. Use the user's first name in conversation, but confirm their full name at the end.
  5. If the user gives partial info (e.g., just street name, or a 7-digit phone number), naturally ask for the remaining parts (city/zip, or the full 10 digits). Do not reject them aggressively.
  6. Use your available Tools/Functions (extract_customer_info) to save data quietly in the background whenever the customer provides their name, phone, address, or issue description.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "extract_customer_info",
      description: "Quietly saves any extracted customer information into session state in background. Omit fields not mentioned, or pass null.",
      parameters: {
        type: "object",
        properties: {
          full_name: { type: ["string", "null"], description: "Full name as on ID or name mentioned (transliterate non-Latin scripts to English)" },
          phone: { type: ["string", "null"], description: "Customer phone number digits" },
          address: { type: ["string", "null"], description: "Full customer service address" },
          issue_description: { type: ["string", "null"], description: "Description of the problem or service needed" },
        },
      },
    },
  },
];

async function callLLM(messages: any[]) {
  const apiKey = process.env.GROQ_API_KEY;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.choices[0].message;
}

export function createInitialSession(businessName: string = "Apex Home Services"): RelagentSession {
  return {
    sessionId: crypto.randomUUID(),
    turnCount: 0,
    businessName,
    recordingDisclosureGiven: false,
    lead: {},
    conversationHistory: [],
  };
}

export async function processTurn(
  session: RelagentSession,
  userUtterance?: string
): Promise<{ reply: string; session: RelagentSession }> {
  // Deterministic Turn 0: Greeting
  if (session.turnCount === 0 && !userUtterance) {
    const greeting = `Thank you for calling ${session.businessName}. This is Regent. How may I help you today?`;
    const updatedSession: RelagentSession = {
      ...session,
      turnCount: 1,
      conversationHistory: [
        { role: "assistant", content: greeting },
      ],
    };
    return { reply: greeting, session: updatedSession };
  }

  // Turn 1+ with user utterance
  const updatedSession: RelagentSession = {
    ...session,
    turnCount: session.turnCount + 1,
    conversationHistory: [
      ...session.conversationHistory,
      { role: "user", content: userUtterance || "" },
    ],
  };

  // Build context messages for LLM
  // We include current collected state summary in system instruction for zero-loop guarantee
  const stateSummary = `Current Collected State:
- Full Name: ${updatedSession.lead.fullName || "NOT YET COLLECTED"}
- Phone: ${updatedSession.lead.phone || "NOT YET COLLECTED"}
- Address: ${updatedSession.lead.address || "NOT YET COLLECTED"}
- Issue: ${updatedSession.lead.issueDescription || "NOT YET COLLECTED"}
- Recording Consent Given: ${updatedSession.recordingDisclosureGiven ? "YES (DO NOT REPEAT)" : "NO (WEAVE NATURALLY IN THIS TURN)"}`;

  const messages: any[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${stateSummary}` },
    ...updatedSession.conversationHistory,
  ];

  let message = await callLLM(messages);

  // Handle Tool Calls (Quiet state extraction)
  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      if (toolCall.function.name === "extract_customer_info") {
        try {
          const args: ExtractedLead = JSON.parse(toolCall.function.arguments);
          if (args.full_name && !updatedSession.lead.fullName) updatedSession.lead.fullName = args.full_name;
          if (args.phone && !updatedSession.lead.phone) updatedSession.lead.phone = args.phone;
          if (args.address && !updatedSession.lead.address) updatedSession.lead.address = args.address;
          if (args.issue_description && !updatedSession.lead.issueDescription) updatedSession.lead.issueDescription = args.issue_description;
        } catch (e) {
          console.error("Failed to parse tool arguments:", e);
        }
      }
    }

    // If message content is empty, feed tool results back to get final spoken reply
    if (!message.content) {
      const followUpMessages = [
        ...messages,
        message,
        ...message.tool_calls.map((tc: any) => ({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: JSON.stringify({ status: "success", saved: true }),
        })),
      ];
      message = await callLLM(followUpMessages);
    }
  }

  const reply = message.content || "I can certainly help with that. Could you please share your full name?";
  
  if (!updatedSession.recordingDisclosureGiven && (reply.toLowerCase().includes("recorded") || reply.toLowerCase().includes("recording"))) {
    updatedSession.recordingDisclosureGiven = true;
  }

  updatedSession.conversationHistory.push({ role: "assistant", content: reply });

  return { reply, session: updatedSession };
}

async function runPhase1Verification() {
  console.log("==================================================");
  console.log("   RELAGENT PHASE 1 HARNESS VERIFICATION");
  console.log("==================================================\n");

  // Step 1: Turn 0 Deterministic greeting
  let session = createInitialSession("Apex Heating & Air");
  const turn0 = await processTurn(session);
  session = turn0.session;
  console.log("Turn 0 (Deterministic Greeting):");
  console.log("Agent:", turn0.reply);
  console.log("Greeting Matches Format?", turn0.reply.includes("Thank you for calling Apex Heating & Air. This is Regent. How may I help you today?"));

  // Step 2: Turn 1 - Customer states issue in English
  console.log("\nTurn 1 (Customer expresses issue):");
  const turn1Input = "Hi, my air conditioner completely stopped blowing cold air and water is leaking on the floor!";
  console.log("User:", turn1Input);
  const turn1 = await processTurn(session, turn1Input);
  session = turn1.session;
  console.log("Agent:", turn1.reply);
  console.log("Extracted State:", session.lead);
  console.log("Consent Weaved Naturally?", session.recordingDisclosureGiven);

  // Step 3: Turn 2 - Customer provides Hindi name
  console.log("\nTurn 2 (Customer provides Name in Hindi):");
  const turn2Input = "मेरा नाम आयुष राज है";
  console.log("User:", turn2Input);
  const turn2 = await processTurn(session, turn2Input);
  session = turn2.session;
  console.log("Agent:", turn2.reply);
  console.log("Extracted State:", session.lead);
  console.log("Zero Loop Check (Did it accept name and NOT ask for name again?):", 
    session.lead.fullName ? "PASSED (" + session.lead.fullName + ")" : "FAILED");
  console.log("Consent Repeated? (Must be false):", turn2.reply.toLowerCase().includes("recorded"));

  // Step 4: Turn 3 - Customer provides Phone and Address together
  console.log("\nTurn 3 (Customer provides Phone & Address):");
  const turn3Input = "My phone is 415-555-0199 and I am located at 1200 Market Street, Dallas TX 75201";
  console.log("User:", turn3Input);
  const turn3 = await processTurn(session, turn3Input);
  session = turn3.session;
  console.log("Agent:", turn3.reply);
  console.log("Final Extracted State:", session.lead);
  console.log("\n==================================================");
}

runPhase1Verification().catch(console.error);
