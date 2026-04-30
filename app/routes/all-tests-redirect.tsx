import { redirect } from "react-router";
import type { Route } from "./+types/all-tests-redirect";

export async function loader(_: Route.LoaderArgs) {
  throw redirect("/discover");
}

export default function AllTestsRedirect() {
  return null;
}
