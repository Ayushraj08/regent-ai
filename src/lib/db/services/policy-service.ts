import { supabase } from '../client';

export interface BusinessPolicy {
  timezone: string;
  afterHoursPolicy: string;
  emergencyPolicy: string;
  afterHoursMessage?: string;
  outOfAreaMessage?: string;
}

export interface BusinessHours {
  dayOfWeek: number;
  openTime: string; // HH:mm:ss
  closeTime: string;
  isClosed: boolean;
}

export interface BusinessServiceArea {
  ruleType: 'ZIP' | 'CITY' | 'STATE';
  ruleValue: string;
}

export interface BusinessService {
  trade: string;
  serviceName: string;
  supported: boolean;
}

export interface BusinessConfig {
  policy: BusinessPolicy;
  hours: BusinessHours[];
  serviceAreas: BusinessServiceArea[];
  services: BusinessService[];
}

// In-memory cache for fast, deterministic lookups (simulating zero-latency local rules)
const policyCache = new Map<string, { config: BusinessConfig, timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

export async function getBusinessConfig(businessId: string): Promise<BusinessConfig | null> {
  try {
    // 1. Check Memory Cache
    const cached = policyCache.get(businessId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.config;
    }

    if (!supabase) {
      console.warn(`[Phase 5 Policy] Supabase is not initialized. Skipping business config for ${businessId}.`);
      return null;
    }

    // 2. Fetch all configuration concurrently
    const [policies, hours, serviceAreas, services] = await Promise.all([
      supabase.from('business_policies').select('*').eq('business_id', businessId).maybeSingle(),
      supabase.from('business_hours').select('*').eq('business_id', businessId),
      supabase.from('business_service_areas').select('*').eq('business_id', businessId),
      supabase.from('business_services').select('*').eq('business_id', businessId)
    ]);

    if (policies.error) {
      console.error("Policy load error", policies.error);
      return null; // POLICY_UNAVAILABLE
    }

    const config: BusinessConfig = {
      policy: policies.data ? {
        timezone: policies.data.timezone,
        afterHoursPolicy: policies.data.after_hours_policy,
        emergencyPolicy: policies.data.emergency_policy,
        afterHoursMessage: policies.data.after_hours_message,
        outOfAreaMessage: policies.data.out_of_area_message
      } : {
        timezone: 'UTC',
        afterHoursPolicy: 'TAKE_MESSAGE',
        emergencyPolicy: 'CALL_911',
        afterHoursMessage: null,
        outOfAreaMessage: null
      },
      hours: (hours.data || []).map(h => ({
        dayOfWeek: h.day_of_week,
        openTime: h.open_time,
        closeTime: h.close_time,
        isClosed: h.is_closed
      })),
      serviceAreas: (serviceAreas.data || []).map(sa => ({
        ruleType: sa.rule_type,
        ruleValue: sa.rule_value
      })),
      services: (services.data || []).map(s => ({
        trade: s.trade,
        serviceName: s.service_name,
        supported: s.supported
      }))
    };

    policyCache.set(businessId, { config, timestamp: Date.now() });
    return config;
  } catch (e) {
    console.error("Failed to load business config", e);
    return null;
  }
}

/**
 * Checks if current time is within business hours based on the configured timezone
 */
export function isBusinessOpen(config: BusinessConfig): boolean {
  if (config.hours.length === 0) return true; // Default to open if no hours specified

  try {
    const tz = config.policy.timezone;
    const nowStr = new Date().toLocaleString("en-US", { timeZone: tz });
    const nowTz = new Date(nowStr);
    
    const day = nowTz.getDay();
    const hours = nowTz.getHours();
    const minutes = nowTz.getMinutes();
    const currentTimeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;

    const todaysHours = config.hours.filter(h => h.dayOfWeek === day);
    if (todaysHours.length === 0) return false; // Not open today

    for (const schedule of todaysHours) {
      if (schedule.isClosed) return false;
      if (currentTimeStr >= schedule.openTime && currentTimeStr <= schedule.closeTime) {
        return true;
      }
    }
    return false;
  } catch (e) {
    // If timezone is invalid, fail safely to false (or true depending on safe fallback)
    console.error("Timezone error", e);
    return false; 
  }
}

/**
 * Evaluate service area: Zip > City > State
 */
export function evaluateServiceArea(config: BusinessConfig, address: string | null): 'SERVICEABLE' | 'NOT_SERVICEABLE' | 'AMBIGUOUS' | 'UNKNOWN' {
  if (config.serviceAreas.length === 0) return 'UNKNOWN';
  if (!address) return 'UNKNOWN';

  const lowerAddress = address.toLowerCase();
  
  // Rule priority: ZIP -> CITY -> STATE (Wait, prompt says give ZIP most preference)
  // If ANY of the rules match the address string, it's serviceable
  const zips = config.serviceAreas.filter(r => r.ruleType === 'ZIP');
  const cities = config.serviceAreas.filter(r => r.ruleType === 'CITY');
  const states = config.serviceAreas.filter(r => r.ruleType === 'STATE');

  // Check zip codes first
  for (const rule of zips) {
    if (lowerAddress.includes(rule.ruleValue.toLowerCase())) {
      return 'SERVICEABLE';
    }
  }

  // Check cities
  for (const rule of cities) {
    if (lowerAddress.includes(rule.ruleValue.toLowerCase())) {
      return 'SERVICEABLE';
    }
  }

  // Check states
  for (const rule of states) {
    if (lowerAddress.includes(rule.ruleValue.toLowerCase())) {
      return 'SERVICEABLE';
    }
  }

  // We could implement a more strict check, but text inclusion works for Phase 5
  // If the user provided an address but no rules matched, they are out of area.
  // If it's a very short string (just "New"), we might say AMBIGUOUS.
  if (address.length < 5) return 'AMBIGUOUS';

  return 'NOT_SERVICEABLE';
}

export function isServiceSupported(config: BusinessConfig, trade: string, serviceName: string): boolean {
  if (config.services.length === 0) return true; // Default true if catalog is empty
  const match = config.services.find(s => s.trade === trade && s.serviceName === serviceName);
  if (match) return match.supported;
  return true; // Unknown services default to allowed for legacy
}
