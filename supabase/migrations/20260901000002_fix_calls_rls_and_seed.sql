-- 1. Fix RLS on calls
-- The API route uses the anon key, so we need to permit inserts into the 'calls' table
-- (and 'conversations' table in case they are both in use during the transition)

ALTER TABLE IF EXISTS public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.conversations ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts for the public demo, restricted to the demo business
CREATE POLICY "Allow public demo insert to calls" 
ON public.calls FOR INSERT 
WITH CHECK (business_id = '00000000-0000-0000-0000-000000000001');

CREATE POLICY "Allow public demo insert to conversations" 
ON public.conversations FOR INSERT 
WITH CHECK (business_id = '00000000-0000-0000-0000-000000000001');

-- 2. Seed default business policy to prevent null dereferences
INSERT INTO public.business_policies (business_id, timezone, after_hours_policy, emergency_policy, after_hours_message, out_of_area_message)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'UTC',
  'TAKE_MESSAGE',
  'CALL_911',
  'We are currently closed. Please leave a message.',
  'We do not service your area.'
)
ON CONFLICT (business_id) DO NOTHING;
