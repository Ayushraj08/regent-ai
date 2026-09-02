import { db } from "../src/lib/db/db-client";
import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

const BUSINESS_ID = "00000000-0000-0000-0000-000000000001";
const dbPath = path.join(process.cwd(), 'local-regent.db');
const sqliteDb = new Database(dbPath);

const fakeCustomers = [
  { name: "John Smith", phone: "1234567890", normalized: "1234567890", address: "123 Main St, New York" },
  { name: "Sarah Connor", phone: "2345678901", normalized: "2345678901", address: "456 Elm St, New York" },
  { name: "Michael Jordan", phone: "3456789012", normalized: "3456789012", address: "789 Oak St, New York" },
  { name: "Emily Blunt", phone: "4567890123", normalized: "4567890123", address: "101 Pine St, New York" },
  { name: "David Beckham", phone: "5678901234", normalized: "5678901234", address: "202 Maple St, New York" },
  { name: "Emma Watson", phone: "6789012345", normalized: "6789012345", address: "303 Cedar St, New York" },
  { name: "James Bond", phone: "7890123456", normalized: "7890123456", address: "404 Birch St, New York" },
  { name: "Alice Cooper", phone: "8901234567", normalized: "8901234567", address: "505 Walnut St, New York" },
  { name: "Bob Builder", phone: "9012345678", normalized: "9012345678", address: "606 Spruce St, New York" },
  { name: "Charlie Brown", phone: "0123456789", normalized: "0123456789", address: "707 Ash St, New York" }
];

async function seed() {
  console.log("Cleaning database...");
  sqliteDb.prepare('DELETE FROM tickets').run();
  sqliteDb.prepare('DELETE FROM service_requests').run();
  sqliteDb.prepare('DELETE FROM customers').run();

  console.log("Seeding database...");
  for (let i = 0; i < fakeCustomers.length; i++) {
    const c = fakeCustomers[i];
    const customerId = crypto.randomUUID();
    const serviceRequestId = crypto.randomUUID();
    const ticketId = crypto.randomUUID();
    const publicRef = `REG00${i}NY`;

    // Insert Customer
    sqliteDb.prepare(`
      INSERT INTO customers (id, business_id, name, phone, normalized_phone, email, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(customerId, BUSINESS_ID, c.name, c.phone, c.normalized, `${c.name.split(' ')[0].toLowerCase()}@example.com`, new Date().toISOString(), new Date().toISOString());

    // Insert Service Request
    sqliteDb.prepare(`
      INSERT INTO service_requests (id, customer_id, business_id, trade, request_type, primary_service, problem, urgency, timing, service_address, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(serviceRequestId, customerId, BUSINESS_ID, "HVAC", "INSTALLATION", "AC_INSTALLATION", "Need a new AC installed", "MEDIUM", "Tomorrow", c.address, "COMPLETED", new Date().toISOString(), new Date().toISOString());

    // Insert Ticket
    sqliteDb.prepare(`
      INSERT INTO tickets (id, service_request_id, business_id, public_reference, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(ticketId, serviceRequestId, BUSINESS_ID, publicRef, new Date().toISOString());
  }
  console.log("Seeded 10 realistic fake data rows!");
}

seed().catch(console.error);
