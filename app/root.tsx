import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useState, useEffect, useCallback } from "react";
import "./styles/global.css";
import "./styles/global-additions.css";
import { useRouteError } from "react-router";

export function ErrorBoundary() {
  const error = useRouteError() as any;
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Something went wrong · Jeelo</title>
        {/* Detect system/stored theme before first paint — same logic as Layout */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var s=localStorage.getItem('jeelo-theme');var d=window.matchMedia('(prefers-color-scheme:dark)').matches;if(s==='dark'||(s===null&&d))document.documentElement.classList.add('dark')}catch(e){}})()` }} />
        <style dangerouslySetInnerHTML={{ __html: `
          *{box-sizing:border-box}
          body{margin:0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fdf8f5;transition:background .25s}
          html.dark body{background:#262624}
          .err-wrap{text-align:center;padding:40px 24px;max-width:460px}
          .err-title{font-size:22px;font-weight:700;color:#1a1a1a;margin:0 0 10px}
          html.dark .err-title{color:#f0e8dc}
          .err-body{font-size:14px;color:#666;margin:0 0 28px;line-height:1.6}
          html.dark .err-body{color:#b8a898}
          .err-btns{display:flex;gap:10px;justify-content:center}
          .err-home{background:#c0623a;color:#fff;border-radius:8px;padding:10px 22px;font-size:14px;font-weight:600;text-decoration:none;font-family:inherit;cursor:pointer;border:none}
          .err-retry{background:transparent;border:1.5px solid #ddd;border-radius:8px;padding:10px 22px;font-size:14px;font-weight:600;cursor:pointer;color:#444;font-family:inherit}
          html.dark .err-retry{border-color:#3e3c37;color:#b8a898;background:#2e2c29}
          .err-code{margin-top:32px;font-size:11px;color:#bbb;font-family:monospace}
          html.dark .err-code{color:#524f48}
        `}} />
      </head>
      <body>
        <div className="err-wrap">
          <img src="/jeelo-reading.png" alt="" draggable={false}
            style={{ width: 140, height: "auto", marginBottom: 24, opacity: 0.9, transform: "translateX(40px)" }} />
          <h1 className="err-title">Something went wrong</h1>
          <p className="err-body">
            {error?.status === 404
              ? "We couldn't find that page."
              : "An unexpected error occurred. Try refreshing — if it keeps happening, let us know."}
          </p>
          <div className="err-btns">
            <a href="/" className="err-home">Go home</a>
            <button onClick={() => window.location.reload()} className="err-retry">Retry</button>
          </div>
          {error?.status && (
            <p className="err-code">{error.status} {error.statusText}</p>
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
