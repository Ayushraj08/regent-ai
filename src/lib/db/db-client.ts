import Database from 'better-sqlite3';
import { supabase } from './client';
import path from 'path';

let sqliteDb: any = null;

if (!supabase) {
  const dbPath = path.join(process.cwd(), 'local-regent.db');
  sqliteDb = new Database(dbPath);
  
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      normalized_phone TEXT,
      email TEXT,
      preferred_contact_method TEXT DEFAULT 'PHONE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS service_requests (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      business_id TEXT NOT NULL,
      trade TEXT NOT NULL,
      request_type TEXT NOT NULL,
      primary_service TEXT,
      problem TEXT,
      urgency TEXT,
      timing TEXT,
      service_address TEXT,
      status TEXT DEFAULT 'PENDING' NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      service_request_id TEXT NOT NULL,
      business_id TEXT NOT NULL,
      public_reference TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      customer_id TEXT,
      service_request_id TEXT,
      channel TEXT DEFAULT 'PHONE',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      outcome TEXT,
      summary TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS request_events (
      id TEXT PRIMARY KEY,
      service_request_id TEXT NOT NULL,
      conversation_id TEXT,
      event_type TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      source TEXT DEFAULT 'SYSTEM',
      created_at TEXT NOT NULL
    );
  `);
}

function generateUUID() {
  return crypto.randomUUID();
}

export const db = {
  // ── CUSTOMERS ─────────────────────────────────────────────────────────────
  
  async findCustomerByPhone(phone: string, businessId: string) {
    if (supabase) {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('business_id', businessId)
        .eq('normalized_phone', phone)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    } else {
      const stmt = sqliteDb.prepare('SELECT * FROM customers WHERE business_id = ? AND normalized_phone = ?');
      return stmt.get(businessId, phone) || null;
    }
  },

  async findCustomerById(id: string) {
    if (supabase) {
      const { data, error } = await supabase.from('customers').select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    } else {
      return sqliteDb.prepare('SELECT * FROM customers WHERE id = ?').get(id) || null;
    }
  },
  
  async createCustomer(customer: any) {
    if (supabase) {
      const { data, error } = await supabase.from('customers').insert(customer).select().single();
      if (error) throw error;
      return data;
    } else {
      const id = customer.id || generateUUID();
      const now = new Date().toISOString();
      const stmt = sqliteDb.prepare(`
        INSERT INTO customers (id, business_id, name, phone, normalized_phone, email, preferred_contact_method, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id, customer.business_id, customer.name, customer.phone, customer.normalized_phone, 
        customer.email, customer.preferred_contact_method || 'PHONE', now, now
      );
      return sqliteDb.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    }
  },

  async updateCustomer(id: string, updates: any) {
    if (supabase) {
      const { data, error } = await supabase.from('customers').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    } else {
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = Object.values(updates);
      const stmt = sqliteDb.prepare(`UPDATE customers SET ${setClauses}, updated_at = ? WHERE id = ?`);
      stmt.run(...values, new Date().toISOString(), id);
      return sqliteDb.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    }
  },

  // ── SERVICE REQUESTS ──────────────────────────────────────────────────────
  
  async findRequestsByCustomer(customerId: string) {
    if (supabase) {
      const { data, error } = await supabase.from('requests').select('*').eq('customer_id', customerId);
      if (error) throw error;
      return data;
    } else {
      return sqliteDb.prepare('SELECT * FROM service_requests WHERE customer_id = ?').all(customerId);
    }
  },

  async findServiceRequestById(id: string) {
    if (supabase) {
      const { data, error } = await supabase.from('requests').select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    } else {
      return sqliteDb.prepare('SELECT * FROM service_requests WHERE id = ?').get(id) || null;
    }
  },
  
  async createServiceRequest(request: any) {
    if (supabase) {
      const { data, error } = await supabase.from('requests').insert(request).select().single();
      if (error) throw error;
      return data;
    } else {
      const id = request.id || generateUUID();
      const now = new Date().toISOString();
      const stmt = sqliteDb.prepare(`
        INSERT INTO service_requests (id, customer_id, business_id, trade, request_type, primary_service, problem, urgency, timing, service_address, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id, request.customer_id, request.business_id, request.trade, request.request_type,
        request.primary_service, request.problem, request.urgency, request.timing, request.service_address,
        request.status || 'PENDING', now, now
      );
      return sqliteDb.prepare('SELECT * FROM service_requests WHERE id = ?').get(id);
    }
  },

  async updateServiceRequest(id: string, updates: any) {
    if (supabase) {
      const { data, error } = await supabase.from('requests').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    } else {
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = Object.values(updates);
      const stmt = sqliteDb.prepare(`UPDATE service_requests SET ${setClauses}, updated_at = ? WHERE id = ?`);
      stmt.run(...values, new Date().toISOString(), id);
      return sqliteDb.prepare('SELECT * FROM service_requests WHERE id = ?').get(id);
    }
  },

  // ── TICKETS ───────────────────────────────────────────────────────────────

  async findTicketByPublicReference(publicRef: string, businessId: string) {
    if (supabase) {
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('business_id', businessId)
        .eq('public_reference', publicRef)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    } else {
      return sqliteDb.prepare('SELECT * FROM tickets WHERE business_id = ? AND public_reference = ?').get(businessId, publicRef) || null;
    }
  },

  async createTicket(ticket: any) {
    if (supabase) {
      const { data, error } = await supabase.from('tickets').insert(ticket).select().single();
      if (error) throw error;
      return data;
    } else {
      const id = ticket.id || generateUUID();
      const now = new Date().toISOString();
      const stmt = sqliteDb.prepare(`
        INSERT INTO tickets (id, service_request_id, business_id, public_reference, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(id, ticket.service_request_id, ticket.business_id, ticket.public_reference, now);
      return sqliteDb.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    }
  },

  // ── EVENTS & CONVERSATIONS ────────────────────────────────────────────────

  async createRequestEvent(event: any) {
    if (supabase) {
      const { data, error } = await supabase.from('request_events').insert(event).select().single();
      if (error) throw error;
      return data;
    } else {
      const id = generateUUID();
      const now = new Date().toISOString();
      const stmt = sqliteDb.prepare(`
        INSERT INTO request_events (id, service_request_id, conversation_id, event_type, old_value, new_value, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id, event.service_request_id, event.conversation_id, event.event_type,
        event.old_value ? JSON.stringify(event.old_value) : null,
        event.new_value ? JSON.stringify(event.new_value) : null,
        event.source || 'SYSTEM', now
      );
      return sqliteDb.prepare('SELECT * FROM request_events WHERE id = ?').get(id);
    }
  },

  async createConversationRecord(conv: any) {
    if (supabase) {
      const { error } = await supabase.from('calls').insert(conv);
      if (error) throw error;
      return conv;
    } else {
      const id = conv.id || generateUUID();
      const now = new Date().toISOString();
      const stmt = sqliteDb.prepare(`
        INSERT INTO conversations (id, business_id, customer_id, service_request_id, channel, started_at, ended_at, outcome, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id, conv.business_id, conv.customer_id, conv.service_request_id,
        conv.channel || 'PHONE', conv.started_at || now, conv.ended_at, conv.outcome, conv.summary, now
      );
      return sqliteDb.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    }
  },

  async clearDatabase() {
    // Only used for testing
    if (!supabase && sqliteDb) {
      sqliteDb.exec('DELETE FROM request_events; DELETE FROM conversations; DELETE FROM tickets; DELETE FROM service_requests; DELETE FROM customers;');
    }
  }
};
