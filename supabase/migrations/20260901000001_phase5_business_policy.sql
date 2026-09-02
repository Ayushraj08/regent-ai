-- Phase 5: Regent Business Policy Schema

-- 1. BUSINESS POLICIES (1-to-1 with businesses)
CREATE TABLE IF NOT EXISTS business_policies (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'UTC', -- Explicit business timezone
  after_hours_policy TEXT NOT NULL DEFAULT 'CAPTURE_LEAD',
  emergency_policy TEXT NOT NULL DEFAULT 'NORMAL',
  after_hours_message TEXT,
  out_of_area_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. BUSINESS HOURS
CREATE TABLE IF NOT EXISTS business_hours (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday, 6=Saturday
  open_time TIME,
  close_time TIME,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. BUSINESS SERVICE AREAS
CREATE TABLE IF NOT EXISTS business_service_areas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL, -- 'ZIP', 'CITY', 'STATE'
  rule_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. BUSINESS SERVICES (Catalog)
CREATE TABLE IF NOT EXISTS business_services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  trade TEXT NOT NULL,
  service_name TEXT NOT NULL,
  supported BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, trade, service_name)
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_bh_business_id ON business_hours(business_id);
CREATE INDEX IF NOT EXISTS idx_bsa_business_id ON business_service_areas(business_id);
CREATE INDEX IF NOT EXISTS idx_bs_business_id ON business_services(business_id);

-- RLS
ALTER TABLE business_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own business policy" ON business_policies FOR SELECT USING (auth.uid() = business_id);
CREATE POLICY "Users can view their own business hours" ON business_hours FOR SELECT USING (auth.uid() = business_id);
CREATE POLICY "Users can view their own service areas" ON business_service_areas FOR SELECT USING (auth.uid() = business_id);
CREATE POLICY "Users can view their own services" ON business_services FOR SELECT USING (auth.uid() = business_id);

-- SEED MOCK DATA FOR "DEMO-BUSINESS" (For testing purposes, assuming DEMO-BUSINESS gets mapped to a UUID or we just insert it via the script if we use actual UUIDs. 
-- In our system, 'DEMO-BUSINESS' is just a string used in testing, but the DB expects UUIDs. 
-- We'll rely on the application test script to insert a real UUID business and link these, OR we can alter the DB to allow text if it doesn't already, but Phase 4 used UUIDs.)
-- Wait, Phase 4 script used UUIDs for business_id. We'll seed this via the test script!
