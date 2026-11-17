// Public connection identifiers only. User JWT + database RLS remain required.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://crxdsuwutniahwfmmyxf.supabase.co';
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_W1oZKke7PEz1SuirUuAHvA_NOwHyc00';

// Refuse cross-project configuration and secret/service credentials.
export const SUPABASE_CONFIGURED = SUPABASE_URL === "https://crxdsuwutniahwfmmyxf.supabase.co" && SUPABASE_KEY.startsWith("sb_publishable_");
