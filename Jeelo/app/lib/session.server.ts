import { createCookieSessionStorage } from "react-router";

type SessionEnv = { JEELO_SESSION_SECRET: string };

/**
 * Creates a CookieSessionStorage scoped to the request-time Cloudflare env.
 *
 * IMPORTANT: Do NOT call createCookieSessionStorage() at module scope on
 * Cloudflare Workers. Worker secrets are only available on the per-request
 * `env` object — not on `process.env` — so a module-level call would always
 * use the fallback dev secret in production, making sessions forgeable.
 *
 * Call this once per loader/action and destructure what you need:
 *   const { getSession, commitSession } = getSessionStorage(env);
 */
export function getSessionStorage(env: SessionEnv) {
  return createCookieSessionStorage({
    cookie: {
      name: "__jeelo_session",
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
      sameSite: "lax",
      secrets: [env.JEELO_SESSION_SECRET],
      secure: true,
    },
  });
}
