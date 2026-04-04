import { createCookieSessionStorage } from "react-router";

// Session secret — must be set as JEELO_SESSION_SECRET in Cloudflare env vars
// and in .dev.vars for local development. Falls back to a dev-only default.
const SESSION_SECRET =
  (typeof process !== "undefined" && process.env?.JEELO_SESSION_SECRET) ||
  "dev-only-secret-change-in-production";

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__jeelo_session",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
    sameSite: "lax",
    secrets: [SESSION_SECRET],
    // Cloudflare Workers doesn't expose NODE_ENV — default to secure:true
    // and override in .dev.vars if needed
    secure: true,
  },
});

export const { getSession, commitSession, destroySession } = sessionStorage;
