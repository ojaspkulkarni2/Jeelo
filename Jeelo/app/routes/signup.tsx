import { data, redirect } from "react-router";
import type { Route } from "./+types/signup";
import { getSession, commitSession } from "~/lib/session.server";
import { signUp, getUser } from "~/lib/auth.server";
import { useState } from "react";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await getUser(request, env);
  if (user) {
    throw redirect(user.role === "admin" ? "/admin" : "/dashboard");
  }
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "");
  const role = formData.get("role") === "admin" ? "admin" : "student";

  if (!email || !password || !displayName) {
    return data({ error: "All fields are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return data({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const result = await signUp(email, password, displayName, role, env);

  if ("error" in result) {
    return data({ error: result.error }, { status: 400 });
  }
  if ("requiresConfirmation" in result) {
    return data({ confirmation: true });
  }

  const session = await getSession(request.headers.get("Cookie"));
  session.set("access_token", result.access_token);
  session.set("refresh_token", result.refresh_token);

  const destination = result.role === "admin" ? "/admin" : "/dashboard";
  return redirect(destination, {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function Signup({ actionData }: Route.ComponentProps) {
  const [showPassword, setShowPassword] = useState(false);
  const error = actionData && "error" in actionData ? actionData.error : null;
  const confirmation = actionData && "confirmation" in actionData ? actionData.confirmation : false;

  if (confirmation) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={{ ...styles.logo, textAlign: "center", marginBottom: "20px" }}>Jeelo</h1>
          <p style={{ fontSize: "18px", fontWeight: "600", color: "#1a3a6b", textAlign: "center", margin: "0 0 10px" }}>
            Check your email
          </p>
          <p style={{ fontSize: "14px", color: "#6b7280", textAlign: "center", lineHeight: "1.6", margin: "0 0 24px" }}>
            We sent a confirmation link. Click it to activate your account, then sign in.
          </p>
          <a href="/login" style={{ ...styles.submitBtn, display: "block", textAlign: "center", textDecoration: "none" }}>
            Go to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.logo}>Jeelo</h1>
          <p style={styles.subtitle}>Create your account</p>
        </div>

        <form method="post" style={styles.form}>
          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.field}>
            <label style={styles.label} htmlFor="display_name">Full name</label>
            <input
              id="display_name"
              name="display_name"
              type="text"
              required
              style={styles.input}
              placeholder="Ojas Kulkarni"
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label} htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              style={styles.input}
              placeholder="you@example.com"
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label} htmlFor="password">
              Password <span style={{ fontWeight: 400, color: "#9ca3af" }}>(min. 8 characters)</span>
            </label>
            <div style={styles.passwordWrapper}>
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                style={{ ...styles.input, paddingRight: "44px" }}
                placeholder="••••••••"
              />
              <button
                type="button"
                style={styles.showBtn}
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>I am a</label>
            <div style={styles.roleRow}>
              <label style={styles.roleOption}>
                <input type="radio" name="role" value="student" defaultChecked />
                <span>Student</span>
              </label>
              <label style={styles.roleOption}>
                <input type="radio" name="role" value="admin" />
                <span>Test creator (Admin)</span>
              </label>
            </div>
          </div>

          <button type="submit" style={styles.submitBtn}>
            Create account
          </button>
        </form>

        <p style={styles.footer}>
          Already have an account?{" "}
          <a href="/login" style={styles.link}>Sign in</a>
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f4f6f9",
    fontFamily: "Arial, sans-serif",
  },
  card: {
    background: "#fff",
    borderRadius: "8px",
    border: "1px solid #dde1e7",
    padding: "40px",
    width: "100%",
    maxWidth: "400px",
  },
  header: { textAlign: "center", marginBottom: "28px" },
  logo: { fontSize: "28px", fontWeight: "700", color: "#1a3a6b", margin: "0 0 6px" },
  subtitle: { fontSize: "14px", color: "#6b7280", margin: 0 },
  form: { display: "flex", flexDirection: "column", gap: "18px" },
  error: {
    background: "#fde8e4",
    border: "1px solid #e08070",
    borderRadius: "6px",
    padding: "10px 14px",
    fontSize: "13px",
    color: "#a83220",
  },
  field: { display: "flex", flexDirection: "column", gap: "6px" },
  label: { fontSize: "13px", fontWeight: "500", color: "#374151" },
  input: {
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    fontSize: "14px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  passwordWrapper: { position: "relative" },
  showBtn: {
    position: "absolute",
    right: "10px",
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    fontSize: "12px",
    color: "#6b7280",
    cursor: "pointer",
    padding: "0",
  },
  roleRow: { display: "flex", gap: "20px" },
  roleOption: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "13px",
    color: "#374151",
    cursor: "pointer",
  },
  submitBtn: {
    background: "#1a3a6b",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "11px",
    fontSize: "14px",
    fontWeight: "500",
    cursor: "pointer",
    marginTop: "4px",
  },
  footer: {
    textAlign: "center",
    fontSize: "13px",
    color: "#6b7280",
    marginTop: "24px",
    marginBottom: 0,
  },
  link: { color: "#1a3a6b", fontWeight: "500" },
};
