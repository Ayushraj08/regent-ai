# Regent V1 Security Model

## Core Security Principles

### Authentication & Authorization
- All application routes (`/app/*`) must be strictly authenticated.
- Server-side authorization must be enforced on all API routes and Server Actions.
- Ensure cross-tenant data isolation: A business owner must only be able to access leads, calls, and settings associated with their own `business_id`.

### Environment & Secrets Management
- Environment secrets (API keys for Supabase, Gemini, Twilio, etc.) must never be exposed to the browser.
- Use strict environment variable naming (e.g., avoid `NEXT_PUBLIC_` for sensitive keys).

### Data Integrity & Safety
- **Input Validation:** All user inputs (both from web forms and LLM extracted data) must be validated (e.g., using Zod) before database insertion.
- **Rate Limiting:** Implement basic rate limiting on public-facing endpoints (like the Demo tool or incoming webhooks) to prevent abuse.
- **Safe DB Access:** Use parameterized queries or secure ORM/Client methods (like Supabase client) to prevent SQL injection.
- **Client Logs:** No sensitive customer data (phone numbers, addresses) should be printed in client-side console logs.

### Mode Separation
- Clearly separate DEMO data from LIVE business data in the database or via environment logical separation, ensuring demo usage does not pollute real business metrics or trigger live SMS messages.
