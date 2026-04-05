/**
 * Legacy shim — AdminNav is now AppNav.
 * All legacy /admin/* routes import from here; this re-exports AppNav
 * under the old name so they all work without modification.
 */
export { AppNav as AdminNav } from "~/components/app-nav";
