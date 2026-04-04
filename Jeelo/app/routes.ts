import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("logout", "routes/logout.tsx"),
  route("dashboard", "routes/dashboard._index.tsx"),
  route("admin", "routes/admin._index.tsx"),
  route("admin/questions", "routes/admin.questions._index.tsx"),
  route("admin/questions/new", "routes/admin.questions.new.tsx"),
  route("admin/questions/:id", "routes/admin.questions.$id.tsx"),
  route("admin/paragraphs", "routes/admin.paragraphs._index.tsx"),
  route("admin/paragraphs/new", "routes/admin.paragraphs.new.tsx"),
] satisfies RouteConfig;