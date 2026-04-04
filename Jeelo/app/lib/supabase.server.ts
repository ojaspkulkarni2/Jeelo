import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Server-side Supabase client.
 * Uses the SERVICE ROLE KEY — bypasses RLS.
 * Only ever called from loaders/actions (server). Never import in client components.
 * Use this for: scoring, admin writes, reading any user's data server-side.
 */
export function createServerClient(env: {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}) {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Server-side Supabase client scoped to a specific user session.
 * Uses ANON KEY + user's JWT — RLS is fully enforced.
 * Use this for: any read/write that should respect row-level security.
 */
export function createSessionClient(env: {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}, accessToken: string) {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Anon Supabase client — for unauthenticated operations (signIn, signUp).
 * Uses the anon key. RLS is enforced. No user JWT.
 */
export function createAnonClient(env: {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}) {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
