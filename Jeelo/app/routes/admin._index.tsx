import { redirect } from "react-router";
import type { Route } from "./+types/admin._index";
import { requireAdmin } from "~/lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireAdmin(request, context.cloudflare.env);
  throw redirect("/admin/questions");
}

export default function AdminIndex() {
  return null;
}
