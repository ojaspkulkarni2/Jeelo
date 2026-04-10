import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useState, useEffect, useCallback } from "react";
import "./styles/global.css";
import "./styles/global-additions.css";
import { useRouteError } from "react-router";

export function ErrorBoundary() {
  const error = useRouteError() as any;
  return (
    <html><body style={{fontFamily:"monospace",padding:40}}>
      <h1>ERROR</h1>
      <pre>{error?.status} {error?.statusText}</pre>
      <pre>{error?.data}</pre>
      <pre>{JSON.stringify(error, null, 2)}</pre>
    </body></html>
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
