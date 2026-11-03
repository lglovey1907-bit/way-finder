// Server-side Supabase client (uses the secret/service key; never sent to browsers).
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
export const supabase = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
export const PHOTO_BUCKET = process.env.SUPABASE_PHOTO_BUCKET || 'photos';
