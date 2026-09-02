-- Phase 4: Regent Supabase Schema
-- Designed for full CRM support, identity mapping, returning customers, and immutable history.

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLES

-- BUSINESSES
CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  trade TEXT,
  phone TEXT,
  email TEXT,
  timezone TEXT DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT,
  normalized_phone TEXT,
  email TEXT,
  preferred_contact_method TEXT DEFAULT 'PHONE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, normalized_phone)
);

-- SERVICE REQUESTS
CREATE TABLE IF NOT EXISTS requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ticket_id TEXT UNIQUE NOT NULL, -- Format: REG-XXXXXX
  trade TEXT NOT NULL,
  request_type TEXT NOT NULL,
  primary_service TEXT,
  additional_services JSONB DEFAULT '[]'::jsonb,
  problem TEXT,
  urgency TEXT,
  safety_status TEXT,
  timing TEXT,
  service_address TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  source_channel TEXT DEFAULT 'PHONE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CALLS / CONVERSATIONS
CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id TEXT NOT NULL UNIQUE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  request_id UUID REFERENCES requests(id) ON DELETE SET NULL,
  ticket_id TEXT,
  channel TEXT DEFAULT 'PHONE',
  outcome TEXT,
  summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- REQUEST EVENTS / HISTORY
CREATE TABLE IF NOT EXISTS request_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  source TEXT DEFAULT 'SYSTEM',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. INDEXES
CREATE INDEX IF NOT EXISTS idx_customers_bus_phone ON customers(business_id, normalized_phone);
CREATE INDEX IF NOT EXISTS idx_requests_bus_ticket ON requests(business_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_requests_customer ON requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_calls_conv_id ON calls(conversation_id);
CREATE INDEX IF NOT EXISTS idx_req_events_req_id ON request_events(request_id);

-- 4. ROW LEVEL SECURITY (RLS)
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_events ENABLE ROW LEVEL SECURITY;

-- Note: The current API connects via the Service Role key for backend operations. 
-- For client-side requests, authenticated users would use these policies:

CREATE POLICY "Users can view their own business" 
  ON businesses FOR SELECT 
  USING (auth.uid() = id); -- Using auth.uid() directly for simple tenant RLS

-- For service-role, RLS is automatically bypassed, which matches Regent's backend architecture.
