# Regent V1 Product Specification

## Product Overview
Regent is an AI missed-call receptionist for U.S. home-service businesses.
Initial verticals: HVAC, Plumbing, Electrical.
Core V1 promise: **Never lose a service lead because nobody answered the phone.**

Regent V1 is strictly a missed-call recovery system, not an autonomous technical diagnostician.

## Core Flow
1. CUSTOMER CALL
2. REGENT ANSWERS
3. IDENTIFIES INTENT
4. CAPTURES NAME + PHONE + ADDRESS + PROBLEM + URGENCY
5. APPLIES TRADE-SPECIFIC RULES
6. CREATES LEAD
7. NOTIFIES OWNER/DISPATCHER
8. HUMAN FALLBACK WHEN REQUIRED
9. CUSTOMER CONFIRMATION

## V1 Scope
**INCLUSIONS:**
- Customer-facing marketing website
- Regent brand identity and responsive UI
- Browser-based interactive demo
- HVAC, Plumbing, and Electrical conversation flows
- Structured lead capture, call records, and transcripts
- Owner and lead dashboards
- Business and agent settings
- Authentication and database architecture
- Deterministic conversation state machine + LLM interpretation
- Hard business rules and guardrails
- Human-transfer, SMS notification, and customer confirmation architectures
- Loading/error/empty UI states
- Testing infrastructure and browser QA

**EXCLUSIONS (Deferred to later versions):**
- Integrations with Jobber, Housecall Pro, ServiceTitan, or unnecessary CRMs
- Complex scheduling, autonomous dispatch, quoting, payments, or membership sales
- Multi-location management or advanced analytics
- Autonomous outbound sales
- Fake integrations, metrics, or AI behaviors

## Website Positioning
- **Primary headline:** Your phone should never lose a job.
- **Supporting statement:** Regent answers missed and after-hours calls for HVAC, plumbing and electrical companies, captures the job details, and sends the lead directly to your team.
- **Primary CTA:** Hear Regent Answer a Call
- **Secondary CTA:** See How It Works
- *Avoid vague language (e.g., "AI-powered solutions", "transform your business"). The messaging must communicate a concrete business outcome.*

## Design Direction
Regent must feel premium, industrial, modern, operational, credible, and restrained. It must NOT look like a generic AI SaaS, ChatGPT clone, or use excessive glassmorphism and robot themes.

**Brand Colors:**
- Obsidian: `#101417` (Main background)
- Bone: `#F4F1EA` (Primary light background)
- Regent Green: `#244A3A` (Primary brand accent)
- Electric Lime: `#B8E34A` (Live/success state only, used sparingly)
- Slate: `#6B7378` (Secondary text)
- Emergency Red: `#D94A4A` (Emergency/critical state only)
