import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { getSessionStorage } from "~/lib/session.server";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { getSession, destroySession } = getSessionStorage(env);
  const session = await getSession(request.headers.get("Cookie"));
  return redirect("/login", {
    headers: { "Set-Cookie": await destroySession(session) },
  });
}

// GET requests to /logout also work (e.g. direct navigation)
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { getSession, destroySession } = getSessionStorage(env);
  const session = await getSession(request.headers.get("Cookie"));
  return redirect("/login", {
    headers: { "Set-Cookie": await destroySession(session) },
  });
}

