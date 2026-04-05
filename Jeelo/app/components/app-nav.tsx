import { Link, useLocation } from "react-router";

interface AppNavProps {
  displayName: string;
}

export function AppNav({ displayName }: AppNavProps) {
  const { pathname } = useLocation();

  const tabs = [
    { to: "/library",     label: "Library" },
    { to: "/bank",        label: "Shared Bank",  soon: true },
    { to: "/tests",       label: "Tests",        soon: true },
  ];

  return (
    <nav
      style={{
        background: "#fff",
        borderBottom: "1px solid #e5e7eb",
        position: "sticky",
        top: 0,
        zIndex: 20,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 28px",
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {/* Logo */}
        <Link
          to="/library"
          style={{
            fontSize: 17,
            fontWeight: 800,
            color: "#1a3a6b",
            textDecoration: "none",
            letterSpacing: "-0.03em",
            marginRight: 16,
            flexShrink: 0,
          }}
        >
          Jeelo
        </Link>

        {/* Nav tabs */}
        <div style={{ display: "flex", gap: 2, flex: 1 }}>
          {tabs.map((t) => {
            const active = pathname === t.to || pathname.startsWith(t.to + "/");

            if (t.soon) {
              return (
                <span
                  key={t.to}
                  style={{
                    fontSize: 13,
                    padding: "5px 11px",
                    borderRadius: 6,
                    color: "#d1d5db",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    userSelect: "none",
                  }}
                >
                  {t.label}
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      background: "#f3f4f6",
                      color: "#9ca3af",
                      padding: "1px 5px",
                      borderRadius: 3,
                      textTransform: "uppercase",
                    }}
                  >
                    soon
                  </span>
                </span>
              );
            }

            return (
              <Link
                key={t.to}
                to={t.to}
                style={{
                  fontSize: 13,
                  textDecoration: "none",
                  padding: "5px 11px",
                  borderRadius: 6,
                  color: active ? "#1a3a6b" : "#6b7280",
                  background: active ? "#eef2ff" : "transparent",
                  fontWeight: active ? 500 : 400,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        {/* User + sign out */}
        <span
          style={{
            fontSize: 13,
            color: "#6b7280",
            flexShrink: 0,
            maxWidth: 160,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayName}
        </span>

        <form method="post" action="/logout">
          <button
            type="submit"
            style={{
              background: "none",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              padding: "5px 12px",
              cursor: "pointer",
              fontSize: 12,
              color: "#374151",
              flexShrink: 0,
              marginLeft: 8,
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
