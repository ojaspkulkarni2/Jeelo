import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useState, useEffect, useCallback } from "react";
import "./styles/global.css";
import "./styles/global-additions.css";
import { useRouteError } from "react-router";

export function ErrorBoundary() {
  const error = useRouteError() as any;
  return (
    <html>
      <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Something went wrong · Jeelo</title></head>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fdf8f5", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ textAlign: "center", padding: "40px 24px", maxWidth: 460 }}>
          <img src="/jeelo-reading.png" alt="" draggable={false}
            style={{ width: 140, height: "auto", marginBottom: 24, opacity: 0.9, transform: "translateX(12px)" }} />
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1a", margin: "0 0 10px" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#666", margin: "0 0 28px", lineHeight: 1.6 }}>
            {error?.status === 404
              ? "We couldn't find that page."
              : "An unexpected error occurred. Try refreshing — if it keeps happening, let us know."}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <a href="/" style={{ background: "#c0623a", color: "#fff", borderRadius: 8, padding: "10px 22px", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
              Go home
            </a>
            <button onClick={() => window.location.reload()}
              style={{ background: "transparent", border: "1.5px solid #ddd", borderRadius: 8, padding: "10px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer", color: "#444" }}>
              Retry
            </button>
          </div>
          {error?.status && (
            <p style={{ marginTop: 32, fontSize: 11, color: "#bbb", fontFamily: "monospace" }}>
              {error.status} {error.statusText}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}

// ── Splash Screen ──────────────────────────────────────────────

function SplashScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    // CSS animation exits at 1.85s + 500ms = 2.35s
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="splash" aria-hidden="true">
      <img
        src="/jeelo-logo.png"
        alt="Jeelo"
        className="splash-mascot-logo"
        draggable={false}
      />
    </div>
  );
}

// ── Layout ─────────────────────────────────────────────────────

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Jeelo</title>
        <Meta />
        <Links />
        {/* Anti-FOUC: apply dark class before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('jeelo-theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;if(s==='dark'||(s===null&&d))document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// ── App ─────────────────────────────────────────────────────────

export default function App() {
  // Only show splash on the very first page load of the session,
  // NOT on every client-side navigation.
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === "undefined") return false; // SSR — never block
    const already = sessionStorage.getItem("jeelo-splash-shown");
    if (already) return false;
    sessionStorage.setItem("jeelo-splash-shown", "1");
    return true;
  });

  const dismiss = useCallback(() => setShowSplash(false), []);

  return (
    <>
      {showSplash && <SplashScreen onDone={dismiss} />}
      <Outlet />
    </>
  );
}
