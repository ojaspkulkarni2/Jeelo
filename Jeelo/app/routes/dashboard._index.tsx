import type { Route } from "./+types/dashboard._index";
import { requireStudent } from "~/lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireStudent(request, context.cloudflare.env);
  return { user };
}

export default function StudentDashboard({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  return (
    <div style={{ fontFamily: "Arial, sans-serif", padding: "40px", maxWidth: "900px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
        <div>
          <h1 style={{ color: "#1a3a6b", margin: "0 0 4px" }}>Jeelo</h1>
          <p style={{ color: "#6b7280", margin: 0, fontSize: "14px" }}>Welcome, {user.display_name}</p>
        </div>
        <form method="post" action="/logout">
          <button type="submit" style={{ background: "none", border: "1px solid #d1d5db", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "13px", color: "#374151" }}>
            Sign out
          </button>
        </form>
      </div>
      <p style={{ color: "#9ca3af", fontSize: "14px" }}>Your tests will appear here.</p>
    </div>
  );
}
