import { createClient } from '@supabase/supabase-js';

const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : undefined;
const supabaseUrl =
  metaEnv?.VITE_SUPABASE_URL ?? (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_URL : undefined);
const supabasePublishableKey =
  metaEnv?.VITE_SUPABASE_PUBLISHABLE_KEY ?? (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_PUBLISHABLE_KEY : undefined);

export const isSupabaseConfigured = Boolean(
  typeof supabaseUrl === 'string' &&
  supabaseUrl.trim() !== '' &&
  supabaseUrl.startsWith('http') &&
  typeof supabasePublishableKey === 'string' &&
  supabasePublishableKey.trim() !== ''
);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabasePublishableKey as string)
  : null;
