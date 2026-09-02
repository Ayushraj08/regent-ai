-- Clean recreate of Relagent tables
DROP TABLE IF EXISTS public.conversation_records CASCADE;
DROP TABLE IF EXISTS public.service_tickets CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;

-- 1. Customers Table
CREATE TABLE public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    service_address TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Service Tickets Table
CREATE TABLE public.service_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number TEXT UNIQUE NOT NULL, -- e.g. TKT-20260902-1001
    customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
    trade TEXT NOT NULL, -- HVAC, Plumbing, Electrical, Clinic
    issue_description TEXT NOT NULL,
    preferred_schedule TEXT, -- Resolved schedule / date preference
    status TEXT NOT NULL DEFAULT 'NEW', -- NEW, SCHEDULED, IN_PROGRESS, RESOLVED, CANCELLED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Conversation Records Table
-- Contains human-readable columns specifically designed for non-technical business owners
CREATE TABLE public.conversation_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID REFERENCES public.service_tickets(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    caller_phone TEXT,
    sentiment_tag TEXT NOT NULL CHECK (sentiment_tag IN ('angry', 'happy', 'neutral')),
    why_customer_is_upset TEXT,
    situation_context_notes TEXT, -- 2-sentence human readable summary
    recommended_next_action TEXT,
    is_emergency BOOLEAN NOT NULL DEFAULT false,
    escalated_to_human BOOLEAN NOT NULL DEFAULT false,
    full_cleaned_transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for performance & quick owner lookups
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone);
CREATE INDEX IF NOT EXISTS idx_tickets_number ON public.service_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON public.service_tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_conversation_records_customer ON public.conversation_records(customer_id);
CREATE INDEX IF NOT EXISTS idx_conversation_records_sentiment ON public.conversation_records(sentiment_tag);
CREATE INDEX IF NOT EXISTS idx_conversation_records_emergency ON public.conversation_records(is_emergency);

-- ====================================================================
-- SEED DATA: 10 Varied Test Rows Across HVAC, Plumbing, Electrical, Clinic
-- ====================================================================

DO $$
DECLARE
    c1 UUID; c2 UUID; c3 UUID; c4 UUID; c5 UUID;
    c6 UUID; c7 UUID; c8 UUID; c9 UUID; c10 UUID;
    t1 UUID; t2 UUID; t3 UUID; t4 UUID; t5 UUID;
    t6 UUID; t7 UUID; t8 UUID; t9 UUID; t10 UUID;
BEGIN
    -- Customer 1: HVAC routine AC repair (Neutral)
    INSERT INTO public.customers (full_name, phone, service_address, notes)
    VALUES ('Ayush Raj', '4155550199', '1200 Market St, Dallas TX 75201', 'Prefers afternoon calls')
    RETURNING id INTO c1;

    INSERT INTO public.service_tickets (ticket_number, customer_id, trade, issue_description, preferred_schedule, status)
    VALUES ('TKT-20260902-1001', c1, 'HVAC', 'AC stopped cooling; water pooling on floor', '2026-09-03 14:00:00', 'SCHEDULED')
    RETURNING id INTO t1;

    INSERT INTO public.conversation_records (
        ticket_id, customer_id, caller_phone, sentiment_tag, why_customer_is_upset, 
        situation_context_notes, recommended_next_action, is_emergency, escalated_to_human, full_cleaned_transcript
    ) VALUES (
        t1, c1, '4155550199', 'neutral', NULL,
        'Customer reported AC failure and water pooling in Dallas home. Routine diagnostic scheduled for tomorrow afternoon.',
        'Dispatch HVAC technician on 2026-09-03 at 2 PM with drain line and refrigerant kit.',
        false, false,
        '[{"role":"assistant","content":"Thank you for calling Apex Services. This is Regent. How may I help you today?"},{"role":"user","content":"My AC stopped cooling and is leaking."},{"role":"assistant","content":"I can certainly help with that! Just so you know, this call is recorded for quality. May I have your full name?"}]'::jsonb
    );

    -- Customer 2: Plumbing angry repeat failure (Angry)
    INSERT INTO public.customers (full_name, phone, service_address, notes)
    VALUES ('Sarah Jenkins', '5125550144', '458 Willow Creek Rd, Austin TX 78701', 'Upset about recurring pipe leak')
    RETURNING id INTO c2;

    INSERT INTO public.service_tickets (ticket_number, customer_id, trade, issue_description, preferred_schedule, status)
    VALUES ('TKT-20260902-1002', c2, 'Plumbing', 'Kitchen sink pipe repaired last week is leaking again under cabinet', '2026-09-03 09:00:00', 'NEW')
    RETURNING id INTO t2;

    INSERT INTO public.conversation_records (
        ticket_id, customer_id, caller_phone, sentiment_tag, why_customer_is_upset, 
        situation_context_notes, recommended_next_action, is_emergency, escalated_to_human, full_cleaned_transcript
    ) VALUES (
        t2, c2, '5125550144', 'angry', 'Previous plumbing repair performed 5 days ago failed again, causing cabinet wood swelling.',
        'Caller was frustrated about a recurring leak under kitchen sink. Reassured by Regent with priority warranty dispatch.',
        'Prioritize technician warranty callback at 9 AM with zero diagnostic fee.',
        false, false,
        '[{"role":"user","content":"Your guy was here 5 days ago and the pipe is leaking again! This is ridiculous."},{"role":"assistant","content":"I completely understand your frustration, Sarah. Let me pull up your previous record right away and get this resolved."}]'::jsonb
    );

    -- Customer 3: Electrical Sparking Panel (Emergency)
    INSERT INTO public.customers (full_name, phone, service_address, notes)
    VALUES ('Marcus Vance', '2145550188', '892 Oak Lawn Ave, Dallas TX 75207', 'EMERGENCY: Breaker sparking')
    RETURNING id INTO c3;

    INSERT INTO public.service_tickets (ticket_number, customer_id, trade, issue_description, preferred_schedule, status)
    VALUES ('TKT-20260902-1003', c3, 'Electrical', 'Breaker panel buzzing, smelling of ozone, visible sparks', 'ASAP', 'IN_PROGRESS')
    RETURNING id INTO t3;

    INSERT INTO public.conversation_records (
        ticket_id, customer_id, caller_phone, sentiment_tag, why_customer_is_upset, 
        situation_context_notes, recommended_next_action, is_emergency, escalated_to_human, full_cleaned_transcript
    ) VALUES (
        t3, c3, '2145550188', 'angry', 'Visible sparks and ozone odor from breaker panel causing fire panic.',
        'Customer reported electrical sparks and burning smell from main breaker panel. Emergency safety instructions provided immediately.',
        'Emergency master electrician dispatched; customer instructed to stay clear of the panel and call 911 if flame occurs.',
        true, true,
        '[{"role":"user","content":"Help, my breaker panel is sparking and smoking!"},{"role":"assistant","content":"Please step away from the panel immediately and make sure everyone is safe. If there is active fire, please dial 911 right away while I dispatch our emergency electrician."}]'::jsonb
    );

    -- Customer 4: Clinic appointment booking (Happy)
    INSERT INTO public.customers (full_name, phone, service_address, notes)
    VALUES ('Elena Rostova', '3055550122', '140 Biscayne Blvd, Miami FL 33132', 'New patient dental cleaning')
    RETURNING id INTO c4;

    INSERT INTO public.service_tickets (ticket_number, customer_id, trade, issue_description, preferred_schedule, status)
    VALUES ('TKT-20260902-1004', c4, 'Clinic', 'Routine 6-month dental exam and prophylaxis cleaning', '2026-09-04 11:30:00', 'SCHEDULED')
    RETURNING id INTO t4;

    INSERT INTO public.conversation_records (
        ticket_id, customer_id, caller_phone, sentiment_tag, why_customer_is_upset, 
        situation_context_notes, recommended_next_action, is_emergency, escalated_to_human, full_cleaned_transcript
    ) VALUES (
        t4, c4, '3055550122', 'happy', NULL,
        'Caller booked routine cleaning for Friday morning. Very satisfied with seamless automated booking.',
        'Send SMS confirmation with digital intake packet link.',
        false, false,
        '[{"role":"user","content":"I need to book a dental cleaning for this Friday."},{"role":"assistant","content":"I would be happy to get you scheduled for Friday at 11:30 AM!"}]'::jsonb
    );

    -- Customer 5: Demanded human receptionist (Neutral / Escalated)
    INSERT INTO public.customers (full_name, phone, service_address, notes)
    VALUES ('David Sterling', '7135550166', '770 Westheimer Rd, Houston TX 77006', 'Wanted to speak with store manager')
    RETURNING id INTO c5;

    INSERT INTO public.service_tickets (ticket_number, customer_id, trade, issue_description, preferred_schedule, status)
    VALUES ('TKT-20260902-1005', c5, 'HVAC', 'Commercial chiller quote inquiry - requested human executive', 'Immediate', 'NEW')
    RETURNING id INTO t5;

    INSERT INTO public.conversation_records (
        ticket_id, customer_id, caller_phone, sentiment_tag, why_customer_is_upset, 
        situation_context_notes, recommended_next_action, is_emergency, escalated_to_human, full_cleaned_transcript
    ) VALUES (
        t5, c5, '7135550166', 'neutral', NULL,
        'Caller requested warm transfer to human receptionist for commercial quotation. Transferred immediately with full context.',
        'Warm transfer to Commercial Desk (Ext 104).',
        false, true,
        '[{"role":"user","content":"Transfer me to a real person right now."},{"role":"assistant","content":"I will transfer you right now to our commercial service team."}]'::jsonb
    );

    -- Customer 6: Plumbing water heater pilot light out (Neutral)
    INSERT INTO public.customers (full_name, phone, service_address, notes)
    VALUES ('Chloe Bennett', '6025550193', '310 Camelback Rd, Phoenix AZ 85012', 'Tank water heater 50 gal')
    RETURNING id INTO c6;

    INSERT INTO public.service_tickets (ticket_number, customer_id, trade, issue_description, preferred_schedule, status)
    VALUES ('TKT-20260902-1006', c6, 'Plumbing', 'Gas water heater pilot light goes out continuously; no hot water', '2026-09-03 16:00:00', 'SCHEDULED')
    RETURNING id INTO t6;

    INSERT INTO public.conversation_records (
        ticket_id, customer_id, caller_phone, sentiment_tag, why_customer_is_upset, 
        situation_context_notes, recommended_next_action, is_emergency, escalated_to_human, full_cleaned_transcript
    ) VALUES (
        t6, c6, '6025550193', 'neutral', NULL,
        'Caller has had no hot water since morning due to unlit pilot thermocouple issue. Scheduled afternoon technician visit.',
        'Assign plumbing tech with universal thermocouple and gas valve parts.',
        false, false,
        '[{"role":"user","content":"My water heater has no hot water and the pilot won''t stay lit."},{"role":"assistant","content":"I understand how inconvenient that is. Let us get a plumber out tomorrow afternoon to inspect the thermocouple."}]'::jsonb
    );

    -- Customer 7: Electrical EV Charger installation (Happy)
    INSERT INTO public.customers (full_name, phone, service_address, notes)
    VALUES ('Robert Chen', '4085550155', '540 Santana Row, San Jose CA 95128', 'Tesla Level 2 Wall Connector')
    RETURNING id INTO c7;

    INSERT INTO public.service_tickets (ticket_number, customer_id, trade, issue_description, preferred_schedule, status)
    VALUES ('TKT-20260902-1007', c7, 'Electrical', 'Install 240V 50A dedicated NEMA 14-50 breaker and conduit in garage', '2026-09-05 10:00:00', 'SCHEDULED')
    RETURNING id INTO t7;

    INSERT INTO public.conversation_records (
        ticket_id, customer_id, caller_phone, sentiment_tag, why_customer_is_upset, 
        situation_context_notes, recommended_next_action, is_emergency, escalated_to_human, full_cleaned_transcript
    ) VALUES (
        t7, c7, '4085550155', 'happy', NULL,
        'Customer purchased new electric vehicle and requires garage EV charger installation. Estimation booked smoothly.',
        'Send licensed electrician for load calculation and on-site permit estimate.',
        false, false,
        '[{"role":"user","content":"I just got a Tesla and need an EV wall charger installed."},{"role":"assistant","content":"Congratulations on the new car! We can certainly get a licensed electrician out to install that for you."}]'::jsonb
    );

    -- Customer 8: HVAC compressor loud grinding noise (Angry)
    INSERT INTO public.customers (full_name, phone, service_address, notes)
    VALUES ('Patricia Gomez', '2105550177', '180 Broadway, San Antonio TX 78205', 'Heat pump outside unit')
    RETURNING id INTO c8;

    INSERT INTO public.service_tickets (ticket_number, customer_id, trade, issue_description, preferred_schedule, status)
    VALUES ('TKT-20260902-1008', c8, 'HVAC', 'Outdoor heat pump fan squealing loudly and vibrating exterior wall', '2026-09-03 08:30:00', 'SCHEDULED')
    RETURNING id INTO t8;

    INSERT INTO public.conversation_records (
        ticket_id, customer_id, caller_phone, sentiment_tag, why_customer_is_upset, 
        situation_context_notes, recommended_next_action, is_emergency, escalated_to_human, full_cleaned_transcript
    ) VALUES (
        t8, c8, '2105550177', 'angry', 'Severe metallic screeching keeping family awake all night.',
        'Customer was irritated by intolerable vibration noise from outdoor condenser unit. First morning slot allocated.',
        'First-call morning dispatch with replacement condenser fan motor and capacitor.',
        false, false,
        '[{"role":"user","content":"The noise is unbearable, it was grinding all night long!"},{"role":"assistant","content":"I am so sorry you had to deal with that noise all night, Patricia. Let us get someone there first thing in the morning."}]'::jsonb
    );

    -- Customer 9: Clinic Dermatology Consult (Neutral)
    INSERT INTO public.customers (full_name, phone, service_address, notes)
    VALUES ('Siddharth Patel', '3125550131', '600 Michigan Ave, Chicago IL 60611', 'Skin rash consultation')
    RETURNING id INTO c9;

    INSERT INTO public.service_tickets (ticket_number, customer_id, trade, issue_description, preferred_schedule, status)
    VALUES ('TKT-20260902-1009', c9, 'Clinic', 'Evaluation for contact dermatitis rash on forearm', '2026-09-04 15:00:00', 'SCHEDULED')
    RETURNING id INTO t9;

    INSERT INTO public.conversation_records (
        ticket_id, customer_id, caller_phone, sentiment_tag, why_customer_is_upset, 
        situation_context_notes, recommended_next_action, is_emergency, escalated_to_human, full_cleaned_transcript
    ) VALUES (
        t9, c9, '3125550131', 'neutral', NULL,
        'Patient requested consultation for spreading arm rash. Scheduled with Dr. Henderson.',
        'Issue reminder SMS with instructions not to apply topical creams before examination.',
        false, false,
        '[{"role":"user","content":"I have a rash on my arm that started after gardening."},{"role":"assistant","content":"We can have Dr. Henderson look at that Friday afternoon at 3 PM."}]'::jsonb
    );

    -- Customer 10: Electrical power outage on single circuit (Neutral)
    INSERT INTO public.customers (full_name, phone, service_address, notes)
    VALUES ('Jessica Wright', '2065550119', '1420 5th Ave, Seattle WA 98101', 'GFCI outlet reset failure')
    RETURNING id INTO c10;

    INSERT INTO public.service_tickets (ticket_number, customer_id, trade, issue_description, preferred_schedule, status)
    VALUES ('TKT-20260902-1010', c10, 'Electrical', 'Kitchen counter GFCI outlets dead; breaker did not trip', '2026-09-04 09:30:00', 'SCHEDULED')
    RETURNING id INTO t10;

    INSERT INTO public.conversation_records (
        ticket_id, customer_id, caller_phone, sentiment_tag, why_customer_is_upset, 
        situation_context_notes, recommended_next_action, is_emergency, escalated_to_human, full_cleaned_transcript
    ) VALUES (
        t10, c10, '2065550119', 'neutral', NULL,
        'All kitchen countertop appliances without power due to tripped or burned GFCI receptacle. Friday morning diagnostic scheduled.',
        'Dispatch residential electrician with 20A GFCI receptacles and circuit tracer.',
        false, false,
        '[{"role":"user","content":"None of my kitchen counter plugs work and pressing the reset button does nothing."},{"role":"assistant","content":"That often indicates a worn GFCI receptacle. We will send an electrician Friday morning at 9:30 AM to test the circuit."}]'::jsonb
    );

END $$;
