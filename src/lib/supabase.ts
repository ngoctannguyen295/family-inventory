import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(
  typeof supabaseUrl === 'string' &&
  supabaseUrl.trim() !== '' &&
  supabaseUrl.startsWith('http') &&
  typeof supabasePublishableKey === 'string' &&
  supabasePublishableKey.trim() !== ''
);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null;
