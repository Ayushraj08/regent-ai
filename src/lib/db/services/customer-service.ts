import { supabase } from '../client';

export interface Customer {
  id: string;
  business_id: string;
  name: string | null;
  phone: string | null;
  normalized_phone: string | null;
  email: string | null;
  preferred_contact_method: string | null;
  created_at: string;
  updated_at: string;
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.replace(/\D/g, ''); // Basic normalization to digits only
}

export async function findCustomerByPhone(phone: string, businessId: string): Promise<Customer | null> {
  if (!supabase) throw new Error("Database not configured");
  
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('business_id', businessId)
    .eq('normalized_phone', normalized)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
    console.error("Error finding customer by phone:", error);
    return null;
  }
  return data;
}

export async function createCustomer(customer: Partial<Customer>): Promise<Customer> {
  if (!supabase) throw new Error("Database not configured");

  if (customer.phone) {
    customer.normalized_phone = normalizePhone(customer.phone);
  }

  const { data, error } = await supabase
    .from('customers')
    .insert(customer)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create customer: ${error.message}`);
  }
  return data;
}
