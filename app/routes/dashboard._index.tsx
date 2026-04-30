import { redirect } from "react-router";
import type { Route } from "./+types/dashboard._index";

export async function loader({ request }: Route.LoaderArgs) {
  throw redirect("/map");
}

export default function DashboardRedirect() {
  return null;
}

