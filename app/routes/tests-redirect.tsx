import { redirect } from "react-router";
import type { Route } from "./+types/tests-redirect";

export async function loader(_: Route.LoaderArgs) {
  throw redirect("/discover?mine=1");
}

export default function TestsRedirect() { return null; }
