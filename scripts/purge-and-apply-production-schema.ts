import { Client } from 'pg';

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://postgres:@Ayushsingh1@db.kezsgmvwkuscdrroucdb.supabase.co:5432/postgres";

async function runPurgeAndMigration() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log("Connected to Supabase PostgreSQL.");

    const sql = `
-- STEP 1: DROP OLD PROTOTYPE AND BOILERPLATE TABLES
DROP TABLE IF EXISTS call_logs CASCADE;
DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS call_records CASCADE;
DROP TABLE IF EXISTS service_tickets CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS tenant_profiles CASCADE;
DROP TABLE IF EXISTS businesses CASCADE;

DROP TABLE IF EXISTS abuse_logs CASCADE;
DROP TABLE IF EXISTS admin_logs CASCADE;
DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS api_logs CASCADE;
DROP TABLE IF EXISTS api_request_ids CASCADE;
DROP TABLE IF EXISTS branding_settings CASCADE;
DROP TABLE IF EXISTS email_logs CASCADE;
DROP TABLE IF EXISTS feature_toggles CASCADE;
DROP TABLE IF EXISTS followup_logs CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS team_logs CASCADE;

-- STEP 2: BUILD CLEAN PRODUCTION SCHEMA

-- 1. BUSINESSES (Tenant Profiles)
CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT NOT NULL,
    ai_agent_name TEXT DEFAULT 'Regent',
    timezone TEXT DEFAULT 'America/New_York',
    service_zip_codes TEXT[] NOT NULL,
    after_hours_rule TEXT,
    dispatch_phone_number VARCHAR(15) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CUSTOMERS (CRM)
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone_number VARCHAR(15) NOT NULL,
    street_address TEXT NOT NULL,
    city TEXT NOT NULL,
    zip_code VARCHAR(12) NOT NULL,
    is_blocked_spammer BOOLEAN DEFAULT FALSE,
    UNIQUE(business_id, phone_number)
);

-- 3. APPOINTMENTS (Booking Board)
CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(32) UNIQUE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id),
    service_type TEXT NOT NULL,
    issue_description TEXT NOT NULL,
    scheduled_date DATE NOT NULL,
    arrival_window TEXT NOT NULL,
    status TEXT DEFAULT 'Confirmed',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. CALL LOGS (Interaction & Context)
CREATE TABLE call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id),
    caller_phone VARCHAR(15),
    ai_summary_for_owner TEXT NOT NULL, 
    action_needed TEXT NOT NULL, 
    call_category TEXT NOT NULL CHECK (call_category IN ('Booking', 'Emergency', 'Complaint', 'Out of Scope', 'Human Escalation', 'General Inquiry')),
    full_transcript TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- STEP 4: SEED ONE PERFECT TEST CASE
INSERT INTO businesses (id, company_name, ai_agent_name, service_zip_codes, dispatch_phone_number) 
VALUES ('b0000000-0000-0000-0000-000000000001', 'Apex Heating & Air', 'Regent', ARRAY['78701', '78702'], '5551234567')
ON CONFLICT (id) DO NOTHING;
`;

    console.log("Executing SQL Purge, Table Creation, and Seed...");
    await client.query(sql);
    console.log("SQL executed successfully!");

    // Verify tables
    const resBusinesses = await client.query("SELECT COUNT(*) FROM businesses;");
    const resCustomers = await client.query("SELECT COUNT(*) FROM customers;");
    const resAppointments = await client.query("SELECT COUNT(*) FROM appointments;");
    const resCallLogs = await client.query("SELECT COUNT(*) FROM call_logs;");

    console.log(`Businesses in DB: ${resBusinesses.rows[0].count}`);
    console.log(`Customers in DB: ${resCustomers.rows[0].count}`);
    console.log(`Appointments in DB: ${resAppointments.rows[0].count}`);
    console.log(`Call Logs in DB: ${resCallLogs.rows[0].count}`);
  } catch (err) {
    console.error("Migration error:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runPurgeAndMigration();
