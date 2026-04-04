import { redirect } from "react-router";
import { getSession } from "./session.server";
import { createSessionClient, createServerClient, createAnonClient } from "./supabase.server";
import type { Database } from "./database.types";

type UserRow = Database["public"]["Tables"]["users"]["Row"];

/**
 * Returns the logged-in user profile, or null if not authenticated.
 * Use in loaders where auth is optional.
 */
export async function getUser(
  request: Request,
  env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY: string }
): Promise<UserRow | null> {
  const session = await getSession(request.headers.get("Cookie"));
  const accessToken = session.get("access_token");
  if (!accessToken) return null;

  try {
    const supabase = createSessionClient(env, accessToken);
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;

    // Use service client to fetch profile — avoids RLS issues on the users table
    const serviceClient = createServerClient(env);
    const { data: profile } = await serviceClient
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single();

    return profile ?? null;
  } catch {
    return null;
  }
}

/**
 * Requires any logged-in user. Redirects to /login if not authenticated.
 */
export async function requireUser(
  request: Request,
  env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY: string }
): Promise<UserRow> {
  const user = await getUser(request, env);
  if (!user) throw redirect("/login");
  return user;
}

/**
 * Requires an admin user.
 * Redirects to /login if not authenticated, /dashboard if wrong role.
 */
export async function requireAdmin(
  request: Request,
  env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY: string }
): Promise<UserRow> {
  const user = await requireUser(request, env);
  if (user.role !== "admin") throw redirect("/dashboard");
  return user;
}

/**
 * Requires a student user.
 * Redirects to /login if not authenticated, /admin if wrong role.
 */
export async function requireStudent(
  request: Request,
  env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY: string }
): Promise<UserRow> {
  const user = await requireUser(request, env);
  if (user.role !== "student") throw redirect("/admin");
  return user;
}

/**
 * Sign in with email + password.
 * Returns tokens + role on success, error string on failure.
 */
export async function signIn(
  email: string,
  password: string,
  env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY: string }
): Promise<
  | { error: string }
  | { access_token: string; refresh_token: string; role: string }
> {
  // Use anon client for unauthenticated sign-in call
  const supabase = createAnonClient(env);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) return { error: error.message };
  if (!data.session) return { error: "No session returned" };

  // Fetch role from public.users using service client (bypasses RLS)
  const serviceClient = createServerClient(env);
  const { data: profile } = await serviceClient
    .from("users")
    .select("*")
    .eq("id", data.user.id)
    .single();

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    role: profile?.role ?? "student",
  };
}

/**
 * Sign up with email + password + display name + role.
 */
export async function signUp(
  email: string,
  password: string,
  displayName: string,
  role: "admin" | "student",
  env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY: string }
): Promise<
  | { error: string }
  | { requiresConfirmation: true }
  | { access_token: string; refresh_token: string; role: string }
> {
  const supabase = createAnonClient(env);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName, role },
    },
  });

  if (error) return { error: error.message };
  if (!data.session) return { requiresConfirmation: true };

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    role,
  };
}
