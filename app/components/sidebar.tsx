import { Link, useLocation, Form } from "react-router";
import { useState, useCallback, useEffect } from "react";
import {
  IconMap,
  IconFeed,
  IconDiscover,
  IconLayers,
  IconLibrary,
  IconUser,
  IconSignOut,
  IconSun,
  IconMoon,
  IconSettings,
  IconTests,
  IconSword,
} from "./icons";

function NavSection({ label }: { label: string }) {
  return <div className="sb-section-label">{label}</div>;
}

function MobileNav({ pathname }: { pathname: string }) {
  function isActive(to: string) {
    return pathname === to || pathname.startsWith(to + "/");
  }
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      <Link to="/map"      className={`mobile-nav-item${isActive("/map")      ? " active" : ""}`} aria-label="Map"><IconMap size={22} /></Link>
      <Link to="/feed"     className={`mobile-nav-item${isActive("/feed")     ? " active" : ""}`} aria-label="Feed"><IconFeed size={22} /></Link>
      <Link to="/arena"    className={`mobile-nav-item${isActive("/arena")    ? " active" : ""}`} aria-label="Arena"><IconSword size={22} /></Link>
      <Link to="/settings" className={`mobile-nav-item${isActive("/settings") ? " active" : ""}`} aria-label="Settings"><IconSettings size={22} /></Link>
    </nav>
  );
}

interface SidebarProps {
  displayName: string;
  username?: string;
}

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
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

export function Sidebar({ displayName, username }: SidebarProps) {
  const { pathname } = useLocation();
  const { dark, toggle } = useTheme();

  function isActive(to: string) {
    return pathname === to || pathname.startsWith(to + "/");
  }

  const profilePath = "/profile";

  return (
    <>
      <aside className="sidebar">
        <Link to="/map" className="sb-logo">
          Jeelo
        </Link>

        <nav className="sb-nav">
          <NavSection label="Learn" />
          <Link to="/feed"     className={`sb-link${isActive("/feed")     ? " active" : ""}`}><IconFeed />Feed</Link>
          <Link to="/map"      className={`sb-link${isActive("/map")      ? " active" : ""}`}><IconMap />Map</Link>
          <Link to="/discover" className={`sb-link${isActive("/discover") ? " active" : ""}`}><IconDiscover />Discover</Link>

          <NavSection label="Play" />
          <Link to="/people"  className={`sb-link${isActive("/people")  ? " active" : ""}`}><IconUser />People</Link>
          <Link to="/arena"   className={`sb-link${isActive("/arena")   ? " active" : ""}`}><IconSword />Arena</Link>

          <NavSection label="You" />
          <Link to={profilePath} className={`sb-link${isActive(profilePath) ? " active" : ""}`}><IconUser />Profile</Link>
          <Link to="/settings"   className={`sb-link${isActive("/settings")  ? " active" : ""}`}><IconSettings />Settings</Link>
        </nav>

        <hr className="sb-divider" />
        <div className="sb-bottom">
          <div className="sb-user">
            <span className="sb-user-name">{displayName}</span>
            <button type="button" className="sb-btn-icon sb-theme-toggle" onClick={toggle}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
              {dark ? <IconSun size={15} /> : <IconMoon size={15} />}
            </button>
          </div>
          <Form method="post" action="/logout" style={{ display: "contents" }}>
            <button type="submit" className="sb-btn signout">
              <IconSignOut size={16} />Sign out
            </button>
          </Form>
        </div>
      </aside>
      <MobileNav pathname={pathname} />
    </>
  );
}
