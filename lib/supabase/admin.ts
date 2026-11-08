import { createClient } from '@supabase/supabase-js'

/**
 * Service-role client. Every ledger table has RLS enabled with no policies and
 * the RPCs are revoked from anon/authenticated, so this is the only path that
 * can read or write proxy data. Never import this from a client component.
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
