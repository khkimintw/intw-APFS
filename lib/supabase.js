import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_CONFIGURED } from './public-config';
export { SUPABASE_URL, SUPABASE_KEY, SUPABASE_CONFIGURED } from './public-config';
// Auth only in the UI. Business data must use /api/v1 with the user's bearer JWT.
export const supabase = SUPABASE_CONFIGURED ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
