import { createClient } from "@supabase/supabase-js";

// Service-role client — only ever import from server-side files
// (route handlers, server actions). Bypasses RLS.
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
