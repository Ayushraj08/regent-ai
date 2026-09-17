-- RELAGENT ENTERPRISE MULTI-TENANT SCHEMA
-- Commercial B2B Multi-Tenant Platform

DROP TABLE IF EXISTS call_records CASCADE;
DROP TABLE IF EXISTS service_tickets CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS tenant_profiles CASCADE;

-- 1. Multi-Tenant Business Configurations
CREATE TABLE tenant_profiles (
    tenant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name TEXT NOT NULL,
    ai_agent_name TEXT DEFAULT 'Regent', -- Customizable AI name
    timezone TEXT NOT NULL DEFAULT 'America/New_York',
    covered_zip_codes TEXT[] NOT NULL, -- e.g., ['78701', '78702']
    excluded_services TEXT, -- e.g., "We do not service tankless water heaters or commercial roofing."
    after_hours_dispatch_fee TEXT, -- e.g., "$150 dispatch fee applies after 6 PM"
    manager_sms_number VARCHAR(15) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Customers (Linked to Tenant)
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenant_profiles(tenant_id) ON DELETE CASCADE,
    full_legal_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    mobile_number VARCHAR(15) NOT NULL,
    service_address TEXT NOT NULL,
    city TEXT NOT NULL,
    postal_code VARCHAR(12) NOT NULL,
    UNIQUE(tenant_id, mobile_number)
);

-- 3. Service Bookings
CREATE TABLE service_tickets (
    ticket_id VARCHAR(32) PRIMARY KEY, 
    tenant_id UUID REFERENCES tenant_profiles(tenant_id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    service_category TEXT NOT NULL, 
    reported_issue TEXT NOT NULL,
    scheduled_date DATE NOT NULL,
    arrival_window TEXT NOT NULL, 
    day_of_sms_confirmed BOOLEAN DEFAULT FALSE, -- Track if customer replied YES to the 2-hour text
    booking_status TEXT DEFAULT 'confirmed',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Interaction Records
CREATE TABLE call_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenant_profiles(tenant_id) ON DELETE CASCADE,
    ticket_id VARCHAR(32) REFERENCES service_tickets(ticket_id),
    customer_mobile VARCHAR(15),
    summary_for_business_owner TEXT NOT NULL, 
    call_transcript TEXT NOT NULL,
    call_type TEXT DEFAULT 'standard_booking'
);

-- Seed Multi-Tenant Contractor Profiles
INSERT INTO tenant_profiles (
    tenant_id, business_name, ai_agent_name, timezone, covered_zip_codes, excluded_services, after_hours_dispatch_fee, manager_sms_number
) VALUES
(
    '00000000-0000-0000-0000-000000000001',
    'Apex Heating & Air',
    'Regent',
    'America/New_York',
    ARRAY['78701', '78702', '78703', '78704', '78705'],
    'We do not service commercial chillers, ammonia refrigeration, or window units.',
    '$150 dispatch fee applies after 6:00 PM and on weekends.',
    '5552345001'
),
(
    '00000000-0000-0000-0000-000000000002',
    'Metro Flow Plumbing',
    'Piper',
    'America/Chicago',
    ARRAY['75201', '75202', '75203', '75204'],
    'We do not service septic tank pumping or municipal main sewer breaks.',
    '$125 emergency truck roll fee applies after 6:00 PM.',
    '5552345002'
),
(
    '00000000-0000-0000-0000-000000000003',
    'VoltGuard Electrical',
    'Sparky',
    'America/Los_Angeles',
    ARRAY['98101', '98102', '98103'],
    'We do not service industrial high-voltage substations or solar panel roofing.',
    '$175 after-hours diagnostic fee applies outside 8 AM - 6 PM.',
    '5552345003'
);

-- Seed Sample Customer & Ticket for Day-Of Testing
INSERT INTO customers (
    id, tenant_id, full_legal_name, first_name, mobile_number, service_address, city, postal_code
) VALUES
(
    'c0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Arthur Pendelton',
    'Arthur',
    '5552345671',
    '142 Elm Street',
    'Austin',
    '78701'
);

INSERT INTO service_tickets (
    ticket_id, tenant_id, customer_id, service_category, reported_issue, scheduled_date, arrival_window, day_of_sms_confirmed, booking_status
) VALUES
(
    'TKT-20260912-7F2A',
    '00000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'HVAC',
    'AC blowing warm air in living room',
    CURRENT_DATE,
    '09:00 AM - 12:00 PM',
    FALSE,
    'confirmed'
);

INSERT INTO call_records (
    tenant_id, ticket_id, customer_mobile, summary_for_business_owner, call_transcript, call_type
) VALUES
(
    '00000000-0000-0000-0000-000000000001',
    'TKT-20260912-7F2A',
    '5552345671',
    'Arthur booked AC service for today. Needs 2-hour pre-arrival confirmation.',
    'Caller: Hi I need AC repair... Regent: Booked.',
    'standard_booking'
);
