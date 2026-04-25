import { data, redirect, Link } from "react-router";
import type { Route } from "./+types/login";
import { getSessionStorage } from "~/lib/session.server";
import { signIn, getUser } from "~/lib/auth.server";
import { useState } from "react";
import { IconEye, IconEyeOff, IconLayers, IconCheck } from "~/components/icons";

// ── Loader / Action (unchanged) ────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await getUser(request, env);
  if (user) throw redirect("/all-tests");
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return data({ error: "Email and password are required" }, { status: 400 });
  }

  const result = await signIn(email, password, env);

  if ("error" in result) {
    return data({ error: result.error }, { status: 401 });
  }

  const { getSession, commitSession } = getSessionStorage(env);
  const session = await getSession(request.headers.get("Cookie"));
  session.set("access_token", result.access_token);
  session.set("refresh_token", result.refresh_token);

  return redirect("/all-tests", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

// ── Component ──────────────────────────────────────────────────

export default function Login({ actionData }: Route.ComponentProps) {
  const [showPassword, setShowPassword] = useState(false);
  const error = actionData && "error" in actionData ? actionData.error : null;

  return (
    <div className="auth-shell">
      {/* Left — visual panel */}
      <div className="auth-visual">
        <div className="auth-visual-bg" />
        <Link to="/" className="auth-visual-logo">Jeelo</Link>

        <div className="auth-visual-body">
          <h2 className="auth-visual-headline">
            Layer your tests.<br />
            Fix your gaps.<br />
            Climb the ranks.
          </h2>
          <p className="auth-visual-body-text">
            Every wrong answer becomes the next test. Keep layering until nothing is left unsolved.
          </p>

          {/* Mini feature list */}
          <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              "NTA-style test interface",
              "Layered tests from your mistakes",
              "JEE Advanced rank estimator",
            ].map((feat) => (
              <div key={feat} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "rgba(212,98,42,0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    color: "var(--c-brand-400)",
                  }}
                >
                  <IconCheck size={10} strokeWidth={2.5} />
                </div>
                <span style={{ fontSize: 13, color: "var(--c-sb-muted)" }}>{feat}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="auth-visual-footer">Built for JEE aspirants · Free to use</p>
      </div>

      {/* Right — form */}
      <div className="auth-form-side">
        <div className="auth-form-inner anim-up">
          <h1 className="auth-heading">Welcome back</h1>
          <p className="auth-subheading">Sign in to continue your preparation.</p>

          <form method="post" className="auth-form">
            {error && <div className="alert-error">{error}</div>}

            <div className="field">
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="input"
                placeholder="you@example.com"
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="password">Password</label>
              <div className="pw-wrap">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  className="input"
                  style={{ paddingRight: 42 }}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-full" style={{ marginTop: 4, justifyContent: "center" }}>
              Sign in
            </button>
          </form>

          <p className="auth-footer-text">
            No account?{" "}
            <Link to="/signup" className="auth-footer-link">Create one free →</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
