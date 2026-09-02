import { config } from 'dotenv';
config({ path: '.env.local' });
import WebSocket from 'ws';
(global as any).WebSocket = WebSocket;
import { evaluatePolicy } from '../src/lib/demo-engine/controller/policy-engine';
import { supabase } from '../src/lib/db/client';
import { makeEmptySession, NLUResponse } from '../src/lib/demo-engine/types';

async function seedTestData() {
  const businessId = "DEMO-BUSINESS"; // Assuming we can use this string directly for our mock, or we'd fetch a UUID

  try {
    // Attempt to insert DEMO-BUSINESS if not exists
    const bus = await supabase!.from('businesses').upsert({ id: '00000000-0000-0000-0000-000000000001', name: 'Demo HVAC', trade: 'HVAC' }).select().single();
    const bid = bus.data!.id;

    await supabase!.from('business_policies').upsert({
      business_id: bid,
      timezone: 'America/New_York',
      after_hours_policy: 'CAPTURE_LEAD',
      emergency_policy: 'ESCALATE'
    });

    // Clear old hours
    await supabase!.from('business_hours').delete().eq('business_id', bid);
    
    // Add open hours 10 AM to 6 PM Mon-Fri
    for (let i = 1; i <= 5; i++) {
      await supabase!.from('business_hours').insert({
        business_id: bid,
        day_of_week: i,
        open_time: '10:00:00',
        close_time: '18:00:00',
        is_closed: false
      });
    }

    await supabase!.from('business_service_areas').delete().eq('business_id', bid);
    await supabase!.from('business_service_areas').insert([
      { business_id: bid, rule_type: 'CITY', rule_value: 'New York' },
      { business_id: bid, rule_type: 'ZIP', rule_value: '10001' }
    ]);

    await supabase!.from('business_services').delete().eq('business_id', bid);
    await supabase!.from('business_services').insert([
      { business_id: bid, trade: 'HVAC', service_name: 'AC_REPAIR', supported: true },
      { business_id: bid, trade: 'HVAC', service_name: 'COMMERCIAL_CHILLER', supported: false }
    ]);

    return bid;
  } catch(e) {
    console.error(e);
  }
}

async function runTests() {
  const bid = await seedTestData();
  console.log("=== PHASE 5: BUSINESS POLICY ENGINE TEST ===");

  // Helper to run policy evaluation
  async function testEval(label: string, address: string, service: string, safety: string) {
    const session = makeEmptySession();
    session.trade = 'HVAC';
    session.primaryService = service;
    session.lead.address.value = address;
    session.lead.address.status = address ? 'CAPTURED' : 'MISSING';

    const nlu: NLUResponse = {
      intent: 'PROVIDE_INFORMATION',
      behavior: 'COOPERATIVE',
      confidence: 1.0,
      extracted: {},
      safety: { status: safety as any, category: null, confidence: 1.0 }
    };

    const res = await evaluatePolicy(session, nlu, 'I need help');
    console.log(`[${label}] -> Action: ${res.session.currentAction}, Status: ${res.session.state}, Reason: ${res.session.diagnosticReason}`);
    if (res.session.policyDecision) {
      console.log(`  Policy: Area=${res.session.policyDecision.serviceAreaStatus}, Business=${res.session.policyDecision.businessStatus}, Safety=${res.session.policyDecision.safetyStatus}`);
    }
  }
  
  await testEval('In-Area (Zip)', '10001', 'AC_REPAIR', 'NORMAL');
  await testEval('In-Area (City)', 'New York', 'AC_REPAIR', 'NORMAL');
  await testEval('Out-of-Area', 'Boston', 'AC_REPAIR', 'NORMAL');
  await testEval('Unsupported Service', '10001', 'COMMERCIAL_CHILLER', 'NORMAL');
  await testEval('Safety Critical', '10001', 'AC_REPAIR', 'CRITICAL');
}

runTests();
