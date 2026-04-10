import { data, redirect, Link } from "react-router";
import type { Route } from "./+types/signup";
import { getSessionStorage } from "~/lib/session.server";
import { signUp, getUser } from "~/lib/auth.server";
import { useState } from "react";
import { IconEye, IconEyeOff, IconCheck, IconLayers } from "~/components/icons";

// ── Loader / Action (unchanged) ────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await getUser(request, env);
  if (user) throw redirect("/library");
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "");

  if (!email || !password || !displayName) {
    return data({ error: "All fields are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return data({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const result = await signUp(email, password, displayName, env);

  if ("error" in result) {
    return data({ error: result.error }, { status: 400 });
  }
  if ("requiresConfirmation" in result) {
    return data({ confirmation: true });
  }

  const { getSession, commitSession } = getSessionStorage(env);
  const session = await getSession(request.headers.get("Cookie"));
  session.set("access_token", result.access_token);
  session.set("refresh_token", result.refresh_token);

  return redirect("/library", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

// ── Component ──────────────────────────────────────────────────

export default function Signup({ actionData }: Route.ComponentProps) {
  const [showPassword, setShowPassword] = useState(false);
  const error = actionData && "error" in actionData ? actionData.error : null;
  const confirmation = actionData && "confirmation" in actionData ? actionData.confirmation : false;

  // ── Confirmation screen ──────────────────────────────────────
  if (confirmation) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--c-bg)",
          padding: 24,
        }}
      >
        <div
          className="anim-up"
          style={{
            textAlign: "center",
            maxWidth: 420,
            padding: "52px 40px",
            background: "var(--c-surface)",
            borderRadius: "var(--r-xl)",
            border: "1px solid var(--c-border)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {/* Icon */}
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: "50%",
              background: "var(--c-brand-100)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 24px",
              color: "var(--c-brand-500)",
            }}
          >
            <IconCheck size={28} strokeWidth={2} />
          </div>

          <Link to="/" style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--c-brand-500)", letterSpacing: "-0.03em", display: "block", marginBottom: 16 }}>
            Jeelo
          </Link>

          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 400, color: "var(--c-text)", marginBottom: 10, letterSpacing: "-0.02em" }}>
            Check your email
          </h2>
          <p style={{ fontSize: 14, color: "var(--c-text-2)", lineHeight: 1.65, marginBottom: 32 }}>
            We sent a confirmation link to your inbox. Click it to activate your account, then sign in.
          </p>

          <Link to="/login" className="btn btn-primary w-full" style={{ justifyContent: "center" }}>
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  // ── Sign up form ─────────────────────────────────────────────
  return (
    <div className="auth-shell">
      {/* Left — visual panel */}
      <div className="auth-visual">
        <div className="auth-visual-bg" />
        <Link to="/" className="auth-visual-logo" aria-label="Jeelo home">
          <img src="/jeelo-logo.png" alt="Jeelo" className="auth-visual-logo-img" draggable={false} />
        </Link>

        <div className="auth-visual-body">
          <h2 className="auth-visual-headline">
            Your question bank.<br />
            Your tests.<br />
            Your rank.
          </h2>
          <p className="auth-visual-body-text">
            Build a personal JEE prep system that learns from your mistakes and never lets you forget a concept.
          </p>
        </div>

        <p className="auth-visual-footer">No credit card · No limits · No ads</p>
      </div>

      {/* Right — form */}
      <div className="auth-form-side">
        <div className="auth-form-inner anim-up">
          <h1 className="auth-heading">Create your account</h1>
          <p className="auth-subheading">Free forever. Start building your question bank today.</p>

          <form method="post" className="auth-form">
            {error && <div className="alert-error">{error}</div>}

            <div className="field">
              <label className="label" htmlFor="display_name">Your name</label>
              <input
                id="display_name"
                name="display_name"
                type="text"
                required
                className="input"
                placeholder="Arjun Mehta"
                autoComplete="name"
              />
            </div>

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
              <label className="label" htmlFor="password">
                Password
                <span style={{ fontWeight: 400, color: "var(--c-text-3)", marginLeft: 6 }}>
                  (min. 8 characters)
                </span>
              </label>
              <div className="pw-wrap">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  className="input"
                  style={{ paddingRight: 42 }}
                  placeholder="••••••••"
                  autoComplete="new-password"
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
              Create account
            </button>
          </form>

          <p className="auth-footer-text">
            Already have an account?{" "}
            <Link to="/login" className="auth-footer-link">Sign in →</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
