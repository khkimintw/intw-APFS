import { createClient } from '@supabase/supabase-js';

// These are publishable project values. Row-level policies in Supabase provide all data protection.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://crxdsuwutniahwfmmyxf.supabase.co';
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_W1oZKke7PEz1SuirUuAHvA_NOwHyc00';
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
