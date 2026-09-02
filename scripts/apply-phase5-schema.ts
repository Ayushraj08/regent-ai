import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

const connectionString = "postgres://postgres:@Ayushsingh1@db.kezsgmvwkuscdrroucdb.supabase.co:5432/postgres";

async function run() {
  const client = new Client({
    connectionString,
  });

  try {
    await client.connect();
    const sqlPath = path.join(process.cwd(), 'supabase', 'migrations', '20260901000001_phase5_business_policy.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log("Applying Phase 5 schema...");
    await client.query(sql);
    console.log("Schema applied successfully.");
  } catch (err) {
    console.error("Schema apply error", err);
  } finally {
    await client.end();
  }
}

run();
