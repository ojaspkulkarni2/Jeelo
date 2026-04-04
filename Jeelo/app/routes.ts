import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("logout", "routes/logout.tsx"),
  route("admin", "routes/admin._index.tsx"),
  route("dashboard", "routes/dashboard._index.tsx"),
] satisfies RouteConfig;
