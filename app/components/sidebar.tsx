import { Link, useLocation, Form } from "react-router";
import { useState, useCallback, useEffect } from "react";
import {
  IconLibrary,
  IconLayers,
  IconDiscover,
  IconUser,
  IconSignOut,
  IconSun,
  IconMoon,
  IconSettings,
} from "./icons";

interface SidebarProps {
  displayName: string;
}

function useTheme() {
  // Always start as false (SSR-safe). If we start as true on the server but
  // the HTML class isn't set yet, React will mismatch on hydration and the
  // icon will flicker. The anti-FOUC script in root.tsx handles the actual
  // theme application before first paint; we just need to catch up after mount.
  const [dark, setDark] = useState(false);

  useEffect(() => {
    // Sync once after hydration — read what the anti-FOUC script already set.
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = useCallback(() => {
    const html = document.documentElement;
    const next = !html.classList.contains("dark");
    html.classList.toggle("dark", next);
    try { localStorage.setItem("jeelo-theme", next ? "dark" : "light"); } catch {}
    setDark(next);
  }, []);

  return { dark, toggle };
}

export function Sidebar({ displayName }: SidebarProps) {
  const { pathname } = useLocation();
  const { dark, toggle } = useTheme();

  function isActive(to: string) {
    return pathname === to || pathname.startsWith(to + "/");
  }

  return (
    <aside className="sidebar">
      <Link to="/library" className="sb-logo">
        <img src="/jeelo-pointing.png" alt="" className="sb-mascot" aria-hidden="true" draggable={false} />
        Jeelo
      </Link>

      <nav className="sb-nav">
        <Link to="/library" className={`sb-link${isActive("/library") ? " active" : ""}`}>
          <IconLibrary />
          Library
        </Link>

        <Link to="/all-tests" className={`sb-link${isActive("/all-tests") ? " active" : ""}`}>
          <IconDiscover />
          Discover
        </Link>

        <Link to="/tests" className={`sb-link${isActive("/tests") ? " active" : ""}`}>
          <IconLayers />
          My Tests
        </Link>

        <Link to="/settings" className={`sb-link${isActive("/settings") ? " active" : ""}`}>
          <IconSettings />
          Settings
        </Link>
      </nav>

      <hr className="sb-divider" />
      <div className="sb-bottom">
        <div className="sb-user">
          <IconUser size={15} />
          <span className="sb-user-name">{displayName}</span>
          <button type="button" className="sb-btn-icon sb-theme-toggle" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
            {dark ? <IconSun size={15} /> : <IconMoon size={15} />}
          </button>
        </div>

        <Form method="post" action="/logout" style={{ display: "contents" }}>
          <button type="submit" className="sb-btn signout">
            <IconSignOut size={16} />
            Sign out
          </button>
        </Form>
      </div>
    </aside>
  );
}
