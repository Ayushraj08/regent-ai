-- Regent Phase 4 Master Record Schema
-- Note: Replace UUIDs and relations based on existing Supabase project structure if already defined.

-- Customers Table
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id TEXT NOT NULL, -- or UUID if there's a businesses table
    name TEXT,
    phone TEXT,
    normalized_phone TEXT,
    email TEXT,
    preferred_contact_method TEXT DEFAULT 'PHONE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Service Requests Table
CREATE TABLE IF NOT EXISTS public.service_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
    business_id TEXT NOT NULL,
    trade TEXT NOT NULL,
    request_type TEXT NOT NULL,
    primary_service TEXT,
    problem TEXT,
    urgency TEXT,
    timing TEXT,
    service_address TEXT,
    status TEXT DEFAULT 'PENDING' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tickets Table (Public-facing wrapper for a service request)
CREATE TABLE IF NOT EXISTS public.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id UUID REFERENCES public.service_requests(id) ON DELETE CASCADE,
    business_id TEXT NOT NULL,
    public_reference TEXT UNIQUE NOT NULL, -- e.g., REG-13KSRU
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Conversations Table (Formerly calls)
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id TEXT NOT NULL,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    service_request_id UUID REFERENCES public.service_requests(id) ON DELETE SET NULL,
    channel TEXT DEFAULT 'PHONE',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    outcome TEXT,
    summary TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Request Events (Audit Trail)
CREATE TABLE IF NOT EXISTS public.request_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id UUID REFERENCES public.service_requests(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL, -- e.g. ADDRESS_CHANGED, REQUEST_CREATED, CANCEL_REQUESTED
    old_value JSONB,
    new_value JSONB,
    source TEXT DEFAULT 'SYSTEM', -- e.g. CUSTOMER_REPORTED, AGENT_ACTION
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_customers_normalized_phone ON public.customers(normalized_phone);
CREATE INDEX IF NOT EXISTS idx_tickets_public_reference ON public.tickets(public_reference);
CREATE INDEX IF NOT EXISTS idx_service_requests_customer_id ON public.service_requests(customer_id);
