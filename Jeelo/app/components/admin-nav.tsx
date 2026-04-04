import { Link, useLocation } from "react-router";

export function AdminNav({ displayName }: { displayName: string }) {
  const { pathname } = useLocation();

  const tabs = [
    { to: "/admin/questions", label: "Questions" },
    { to: "/admin/paragraphs", label: "Paragraphs" },
  ];

  return (
    <nav
      style={{
        background: "#fff",
        borderBottom: "1px solid #e5e7eb",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "0 24px",
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: 24,
        }}
      >
        <Link
          to="/admin/questions"
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "#1a3a6b",
            textDecoration: "none",
            flexShrink: 0,
            letterSpacing: "-0.02em",
          }}
        >
          Jeelo Admin
        </Link>

        <div style={{ display: "flex", gap: 2, flex: 1 }}>
          {tabs.map((t) => {
            const active = pathname.startsWith(t.to);
            return (
              <Link
                key={t.to}
                to={t.to}
                style={{
                  fontSize: 13,
                  textDecoration: "none",
                  padding: "5px 12px",
                  borderRadius: 6,
                  color: active ? "#1a3a6b" : "#6b7280",
                  background: active ? "#eef2ff" : "transparent",
                  fontWeight: active ? 500 : 400,
                  transition: "background 0.1s",
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        <span style={{ fontSize: 13, color: "#9ca3af", flexShrink: 0 }}>
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
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
