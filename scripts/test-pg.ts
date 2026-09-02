import { Client } from 'pg';

const connectionString = "postgres://postgres.kezsgmvwkuscdrroucdb:@Ayushsingh1@aws-0-us-west-1.pooler.supabase.com:6543/postgres";

async function run() {
  const client = new Client({
    connectionString,
  });

  try {
    await client.connect();
    const res = await client.query('SELECT NOW()');
    console.log("Connected successfully:", res.rows[0]);
  } catch (err) {
    console.error("Connection error", err);
  } finally {
    await client.end();
  }
}

run();
