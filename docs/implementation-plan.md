# Regent V1 Implementation Plan

## Gated Development Sequence

### Gate 1: Architecture + Specifications
- Inspect current project and establish architecture.
- Define implementation boundaries.
- Produce planning and architecture artifacts (`/docs`).

### Gate 2: Brand + Marketing Website
- Set up Next.js, Tailwind, and styling constants.
- Implement the responsive marketing landing page with the defined color system and typography.
- Create static UI components for homepage sections (Hero, Missed calls, How it works, Trade examples, Pricing, FAQ).

### Gate 3: Browser Regent Demo
- Build the `/demo` route.
- Implement browser Web Speech APIs for microphone capture and synthesis (Demo Mode).
- Simulate the AI response and lead extraction to prove the UX conceptually.

### Gate 4: Agent Engine
- Build the deterministic state machine.
- Integrate the AIProvider abstraction (Gemini API) for intent and entity extraction.
- Implement trade configurations and hard business rules for HVAC, Plumbing, and Electrical.

### Gate 5: Database + Dashboard
- Initialize Supabase schema (`businesses`, `leads`, `calls`, `agent_settings`).
- Build the `/app` dashboard for owners (calls, leads metrics).
- Implement user authentication.

### Gate 6: SMS + Human Transfer
- Implement SMSProvider abstraction for owner alerts and customer confirmations.
- Build human fallback / transfer logic for escalation scenarios.

### Gate 7: Telephony
- Integrate TelephonyProvider (Twilio) to handle real PSTN inbound calls.
- Connect voice streams to the Agent Engine.
- Switch to LIVE MODE for pilot testing.

### Gate 8: End-to-End QA
- Full system test from real phone call to SMS notification and database record.
- Verify security, rate limits, and error handling.
