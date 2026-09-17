import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

const connectionString = "postgres://postgres:@Ayushsingh1@db.kezsgmvwkuscdrroucdb.supabase.co:5432/postgres";

async function applyRelagentSchema() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log("Connected to Supabase PostgreSQL.");
    const sqlPath = path.join(process.cwd(), 'supabase', 'migrations', '20260912120000_enterprise_multitenant_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log("Applying enterprise multi-tenant schema and seed rows...");
    await client.query(sql);
    console.log("✅ Enterprise multi-tenant schema applied successfully!");

    // Verify row counts
    const resTenants = await client.query("SELECT COUNT(*) FROM public.tenant_profiles;");
    const resCustomers = await client.query("SELECT COUNT(*) FROM public.customers;");
    const resTickets = await client.query("SELECT COUNT(*) FROM public.service_tickets;");
    const resRecords = await client.query("SELECT COUNT(*) FROM public.call_records;");

    console.log(`Tenants in DB: ${resTenants.rows[0].count}`);
    console.log(`Customers in DB: ${resCustomers.rows[0].count}`);
    console.log(`Tickets in DB: ${resTickets.rows[0].count}`);
    console.log(`Call Records in DB: ${resRecords.rows[0].count}`);
  } catch (err) {
    console.error("Schema application error:", err);
  } finally {
    await client.end();
  }
}

applyRelagentSchema();
