# Regent V1 Architecture

## Core Architectural Principle
**Do NOT create one giant unrestricted LLM prompt.**
The core engine consists of:
`DETERMINISTIC STATE MACHINE + LLM INTERPRETATION + STRUCTURED OUTPUT + HARD BUSINESS RULES`

The application controls state transitions while the LLM interprets customer language and extracts structured information. The LLM must not control arbitrary application behavior.

## Conversation States
- `START`
- `GREETING`
- `INTENT`
- `SERVICE`
- `URGENCY`
- `CONTACT`
- `ADDRESS`
- `CONFIRMATION`
- `NOTIFY`
- `TRANSFER_OR_END`

## Provider Abstractions
To ensure vendor lock-in is avoided, third-party services will be wrapped in interfaces:
- **AI:** `AIProvider` -> `GeminiProvider` (Future: OpenAI, Claude, etc.)
- **Telephony:** `TelephonyProvider` -> `TwilioProvider`
- **SMS:** `SMSProvider` -> `TwilioSMSProvider`

## Operational Modes
- **DEMO MODE:** Uses browser-based interaction (microphone/speakers), test data, and requires no production phone/SMS billing.
- **LIVE MODE:** Uses real phone numbers, real inbound calls, real SMS, and requires production provider configuration.

## Data Model Plan
- **businesses:** id, name, industry, phone, service_area, hours, emergency_rules
- **leads:** id, business_id, name, phone, address, trade, service, problem, urgency, status, created_at
- **calls:** id, business_id, lead_id, duration, transcript, outcome, transfer_reason, created_at
- **agent_settings:** business_id, greeting, voice, tone, rules

*Lead Statuses:* NEW, CONTACTED, BOOKED, LOST, TRANSFERRED

## Technical Preferences & Dependency List
- **Next.js:** Full-stack framework (React frontend, API routes backend) for unified deployment.
- **Tailwind CSS:** Utility-first CSS framework for rapid, consistent styling.
- **shadcn/ui (selectively):** Accessible, customizable UI components without heavy library bloat.
- **Supabase:** Managed PostgreSQL database with built-in Authentication (`Supabase Auth`) and row-level security.
- **Gemini API:** Chosen for initial LLM interpretation (cost-effective developer tier).
- **Twilio:** Industry standard for PSTN telephony and SMS (integrated behind abstractions).

*Rationale:* These tools provide a scalable, fast, and secure foundation while enabling a zero-cost initial development strategy (using free tiers) before transitioning to production infrastructure.
