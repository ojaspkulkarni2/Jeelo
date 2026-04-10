import { redirect } from "react-router";
import { getSessionStorage } from "./session.server";
import { createSessionClient, createServerClient, createAnonClient } from "./supabase.server";
import type { Database } from "./database.types";

type UserRow = Database["public"]["Tables"]["users"]["Row"];

type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  JEELO_SESSION_SECRET: string;
  ENVIRONMENT: string;
};

/**
 * Returns the logged-in user profile, or null if not authenticated.
 * Use in loaders where auth is optional.
 *
 * When the access token has expired but a valid refresh token exists, this
 * function silently refreshes the session and throws a transparent redirect
 * back to the same URL with the updated Set-Cookie header, so the next
 * request proceeds normally. The 7-day refresh window means users are never
 * kicked to /login just because the 1-hour access token expired mid-session.
 *
 * NOTE: callers must not swallow Response throws — the catch block re-throws
 * them so the redirect is always propagated to the runtime.
 */
export async function getUser(
  request: Request,
  env: Env
): Promise<UserRow | null> {
  const { getSession, commitSession } = getSessionStorage(env);
  const session = await getSession(request.headers.get("Cookie"));
  const accessToken  = session.get("access_token")  as string | undefined;
  const refreshToken = session.get("refresh_token") as string | undefined;
  if (!accessToken) return null;

  try {
    const supabase = createSessionClient(env, accessToken);
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      // Access token is expired or invalid. Attempt a silent refresh using the
      // refresh token stored in the session cookie (valid for 7 days).
      if (!refreshToken) return null;

      const anonClient = createAnonClient(env);
      const { data: refreshed, error: refreshError } =
        await anonClient.auth.setSession({
          access_token:  accessToken,
          refresh_token: refreshToken,
        });

      if (refreshError || !refreshed.session) return null;

      // Persist the new token pair and replay the current request transparently.
      // The browser follows the redirect immediately, now carrying a fresh cookie.
      session.set("access_token",  refreshed.session.access_token);
      session.set("refresh_token", refreshed.session.refresh_token);
      throw redirect(request.url, {
        headers: { "Set-Cookie": await commitSession(session) },
      });
    }

    // Use service client to fetch profile — avoids RLS issues on the users table
    const serviceClient = createServerClient(env);
    const { data: profile } = await serviceClient
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single();

    return profile ?? null;
  } catch (e) {
    // Re-throw redirects (including the token-refresh redirect above) so they
    // are never accidentally swallowed by this catch block.
    if (e instanceof Response) throw e;
    return null;
  }
}

/**
 * Requires a logged-in user. Redirects to /login if not authenticated.
 * There is only one user type — everyone has full access to their own content.
 */
export async function requireUser(
  request: Request,
  env: Env
): Promise<UserRow> {
  const user = await getUser(request, env);
  if (!user) throw redirect("/login");
  return user;
}

/**
 * Sign in with email + password.
 * Returns tokens on success, error string on failure.
 */
export async function signIn(
  email: string,
  password: string,
  env: Env
): Promise<
  | { error: string }
  | { access_token: string; refresh_token: string }
> {
  const supabase = createAnonClient(env);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) return { error: error.message };
  if (!data.session) return { error: "No session returned" };

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  };
}

/**
 * Sign up with email + password + display name.
 * All users get full access — there are no roles.
 */
export async function signUp(
  email: string,
  password: string,
  displayName: string,
  env: Env
): Promise<
  | { error: string }
  | { requiresConfirmation: true }
  | { access_token: string; refresh_token: string }
> {
  const supabase = createAnonClient(env);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
    },
  });

  if (error) return { error: error.message };
  if (!data.session) return { requiresConfirmation: true };

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  };
}
