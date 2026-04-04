import { data, redirect } from "react-router";
import type { Route } from "./+types/login";
import { getSession, commitSession } from "~/lib/session.server";
import { signIn, getUser } from "~/lib/auth.server";
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

  if (!email || !password) {
    return data({ error: "Email and password are required" }, { status: 400 });
  }

  const result = await signIn(email, password, env);

  if ("error" in result) {
    return data({ error: result.error }, { status: 401 });
  }

  const session = await getSession(request.headers.get("Cookie"));
  session.set("access_token", result.access_token);
  session.set("refresh_token", result.refresh_token);

  const destination = result.role === "admin" ? "/admin" : "/dashboard";

  return redirect(destination, {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function Login({ actionData }: Route.ComponentProps) {
  const [showPassword, setShowPassword] = useState(false);
  // actionData is typed from the action return — could be null (no submission) or { error }
  const error = actionData && "error" in actionData ? actionData.error : null;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.logo}>Jeelo</h1>
          <p style={styles.subtitle}>Sign in to your account</p>
        </div>

        <form method="post" style={styles.form}>
          {error && <div style={styles.error}>{error}</div>}

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
            <label style={styles.label} htmlFor="password">Password</label>
            <div style={styles.passwordWrapper}>
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
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

          <button type="submit" style={styles.submitBtn}>
            Sign in
          </button>
        </form>

        <p style={styles.footer}>
          Don't have an account?{" "}
          <a href="/signup" style={styles.link}>Sign up</a>
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
