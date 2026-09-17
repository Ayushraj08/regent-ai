-- Streamlined Supabase Schema & 10 Test Scenarios Seed
-- Relagent Architectural Patch

DROP TABLE IF EXISTS call_records CASCADE;
DROP TABLE IF EXISTS service_tickets CASCADE;
DROP TABLE IF EXISTS customers CASCADE;

-- 1. Customers Table (Clean & Human-Readable)
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_legal_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    mobile_number VARCHAR(15) NOT NULL UNIQUE,
    service_address TEXT NOT NULL,
    city TEXT NOT NULL,
    postal_code VARCHAR(12) NOT NULL,
    is_blocked_caller BOOLEAN DEFAULT FALSE,
    blocked_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Service Bookings Table
CREATE TABLE service_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(32) NOT NULL UNIQUE, -- Format: TKT-YYYYMMDD-XXXX
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    service_category TEXT NOT NULL, -- 'HVAC', 'Plumbing', 'Electrical', 'Clinic'
    reported_issue TEXT NOT NULL,
    scheduled_date DATE NOT NULL,
    arrival_window TEXT NOT NULL, -- e.g. '09:00 AM - 12:00 PM'
    booking_status TEXT DEFAULT 'confirmed' CHECK (booking_status IN ('confirmed', 'rescheduled', 'escalated', 'cancelled')),
    is_after_hours BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Business Context & Interaction Records
CREATE TABLE call_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(32) REFERENCES service_tickets(ticket_id),
    customer_mobile VARCHAR(15),
    caller_mood TEXT NOT NULL, -- 'pleasant', 'neutral', 'anxious', 'angry', 'dissatisfied'
    why_customer_is_upset TEXT, -- Plain English explanation for team
    summary_for_business_owner TEXT NOT NULL, -- 2-sentence non-tech summary
    action_required_by_team TEXT NOT NULL, -- Immediate CTA for business staff
    call_transcript TEXT NOT NULL,
    sms_confirmation_sent BOOLEAN DEFAULT FALSE,
    call_type TEXT DEFAULT 'standard_booking' CHECK (call_type IN ('standard_booking', 'complaint', 'emergency', 'after_hours', 'out_of_scope', 'human_escalation')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Data for 10 Test Scenarios
INSERT INTO customers (id, full_legal_name, first_name, mobile_number, service_address, city, postal_code) VALUES
('a0000000-0000-0000-0000-000000000001', 'Arthur Pendelton', 'Arthur', '5552345671', '142 Elm Street', 'Austin', '78701'),
('a0000000-0000-0000-0000-000000000002', 'Brenda Vance', 'Brenda', '5552345672', '88 Victoria Rd', 'London', 'SW1A 1AA'),
('a0000000-0000-0000-0000-000000000003', 'Carlos Mendez', 'Carlos', '5552345673', '405 King St W', 'Toronto', 'M5V 1K4'),
('a0000000-0000-0000-0000-000000000004', 'Deborah Campbell', 'Deborah', '5552345674', '12 George St', 'Sydney', 'NSW 2000'),
('a0000000-0000-0000-0000-000000000005', 'Evan Wright', 'Evan', '5552345675', '710 Pine Ave', 'Seattle', '98101'),
('a0000000-0000-0000-0000-000000000006', 'Fiona Gallagher', 'Fiona', '5552345676', '33 Oak Lane', 'Manchester', 'M1 1AE'),
('a0000000-0000-0000-0000-000000000007', 'George Harrison', 'George', '5552345677', '55 Bay Street', 'Vancouver', 'V6B 2S8'),
('a0000000-0000-0000-0000-000000000008', 'Hannah Abbott', 'Hannah', '5552345678', '90 Flinders St', 'Melbourne', 'VIC 3000'),
('a0000000-0000-0000-0000-000000000009', 'Ian Malcolm', 'Ian', '5552345679', '210 Maple Rd', 'Dallas', '75201'),
('a0000000-0000-0000-0000-000000000010', 'Julia Roberts', 'Julia', '5552345680', '19 Church Street', 'Bristol', 'BS1 4SS');

INSERT INTO service_tickets (ticket_id, customer_id, service_category, reported_issue, scheduled_date, arrival_window, booking_status, is_after_hours) VALUES
('TKT-20260901-0001', 'a0000000-0000-0000-0000-000000000001', 'HVAC', 'AC blowing warm air in living room', '2026-09-14', '09:00 AM - 12:00 PM', 'confirmed', false),
('TKT-20260901-0002', 'a0000000-0000-0000-0000-000000000002', 'Plumbing', 'Previous kitchen drain repair leaking again', '2026-09-14', '01:00 PM - 04:00 PM', 'escalated', false),
('TKT-20260901-0003', 'a0000000-0000-0000-0000-000000000003', 'Electrical', 'Breaker tripping when laundry running', '2026-09-15', '08:00 AM - 11:00 AM', 'confirmed', false),
('TKT-20260901-0004', 'a0000000-0000-0000-0000-000000000004', 'Plumbing', 'Burst pipe in basement causing standing water', '2026-09-12', 'Immediate Emergency', 'confirmed', true),
('TKT-20260901-0005', 'a0000000-0000-0000-0000-000000000005', 'HVAC', 'Routine seasonal furnace maintenance', '2026-09-16', '02:00 PM - 05:00 PM', 'confirmed', false),
('TKT-20260901-0006', 'a0000000-0000-0000-0000-000000000006', 'Clinic', 'General consultation intake for back pain', '2026-09-15', '10:00 AM - 11:00 AM', 'confirmed', false),
('TKT-20260901-0007', 'a0000000-0000-0000-0000-000000000007', 'Electrical', 'Main panel humming noise after thunderstorm', '2026-09-14', '01:00 PM - 03:00 PM', 'confirmed', false),
('TKT-20260901-0008', 'a0000000-0000-0000-0000-000000000008', 'Plumbing', 'Customer requested reschedule from yesterday', '2026-09-17', '09:00 AM - 12:00 PM', 'rescheduled', false),
('TKT-20260901-0009', 'a0000000-0000-0000-0000-000000000009', 'HVAC', 'Thermostat blank screen and heat not turning on', '2026-09-14', '08:00 AM - 10:00 AM', 'confirmed', false),
('TKT-20260901-0010', 'a0000000-0000-0000-0000-000000000010', 'Plumbing', 'Water heater replacement estimate inquiry', '2026-09-18', '02:00 PM - 05:00 PM', 'confirmed', false);

INSERT INTO call_records (ticket_id, customer_mobile, caller_mood, why_customer_is_upset, summary_for_business_owner, action_required_by_team, call_transcript, sms_confirmation_sent, call_type) VALUES
('TKT-20260901-0001', '5552345671', 'pleasant', NULL, 'New customer booked regular AC diagnostic for next Monday morning.', 'Assign standard HVAC diagnostic van.', 'Caller: Hi my AC is warm... Regent: Booked.', true, 'standard_booking'),
('TKT-20260901-0002', '5552345672', 'angry', 'Drain repaired last Friday started leaking under floorboards again.', 'Existing client dissatisfied with warranty work. Needs senior supervisor callback.', 'Manager callback required before 10:00 AM tomorrow.', 'Caller: Your guy didn''t fix it right... Regent: Escalated.', true, 'complaint'),
('TKT-20260901-0003', '5552345673', 'neutral', NULL, 'Customer experiencing breaker trips when appliances run simultaneously.', 'Dispatch electrician with multi-meter and panel tester.', 'Caller: Need electrician... Regent: Booked Tuesday 8 AM.', true, 'standard_booking'),
('TKT-20260901-0004', '5552345674', 'anxious', 'Major pipe burst in basement with 2 inches of water.', 'Emergency water shut-off advised. On-call plumber dispatched after hours.', 'URGENT: On-call plumber dispatched immediately.', 'Caller: Water everywhere! Regent: Advised shut-off & dispatched.', true, 'emergency'),
('TKT-20260901-0005', '5552345675', 'pleasant', NULL, 'Repeat customer scheduled annual heating tune-up.', 'Routine maintenance booking logged.', 'Caller: Just regular tuneup please... Regent: Booked.', true, 'standard_booking'),
('TKT-20260901-0006', '5552345676', 'neutral', NULL, 'New patient requested intake consultation for chronic lower back strain.', 'Prep medical intake paperwork for arrival.', 'Caller: Need back consultation... Regent: Booked Clinic slot.', true, 'standard_booking'),
('TKT-20260901-0007', '5552345677', 'anxious', 'Panel buzzing after storm; concerned about electrical short.', 'Electrical inspection priority scheduled for Monday afternoon.', 'Inspect 200A main service panel.', 'Caller: Panel makes buzzing sound... Regent: Booked.', true, 'standard_booking'),
('TKT-20260901-0008', '5552345678', 'neutral', NULL, 'Customer changed appointment from Tuesday to Thursday due to work schedule.', 'Calendar updated. No further action needed.', 'Caller: Can I push it to Thursday? Regent: Rebooked.', true, 'standard_booking'),
('TKT-20260901-0009', '5552345679', 'neutral', NULL, 'Customer called after hours on Sunday evening. Selected first morning slot Monday.', 'Technician assigned for early Monday morning route.', 'Caller: Calling late... Regent: Booked next morning.', true, 'after_hours'),
('TKT-20260901-0010', '5552345680', 'pleasant', NULL, 'Customer requested quotation consultation for tankless water heater upgrade.', 'Provide tankless water heater brochure on arrival.', 'Caller: Looking for water heater estimate... Regent: Booked.', true, 'standard_booking');
