import { redirect } from "react-router";
import type { Route } from "./+types/_index";
import { getUser } from "~/lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await getUser(request, context.cloudflare.env);
  if (!user) throw redirect("/login");
  throw redirect("/library");
}

export default function Index() {
  return null;
}
