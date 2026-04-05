import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Root — redirects to /library or /login
  index("routes/_index.tsx"),

  // Auth
  route("login",   "routes/login.tsx"),
  route("signup",  "routes/signup.tsx"),
  route("logout",  "routes/logout.tsx"),

  // Legacy dashboard redirect
  route("dashboard", "routes/dashboard._index.tsx"),

  // ── Library (personal question bank) ─────────────────────
  route("library",             "routes/library._index.tsx"),
  route("library/folders/:id", "routes/library.folders.$id.tsx"),

  // ── Question & Paragraph management ──────────────────────
  route("questions/new",  "routes/questions.new.tsx"),
  route("paragraphs/new", "routes/paragraphs.new.tsx"),

  // ── Legacy admin routes (still functional) ───────────────
  route("admin",                  "routes/admin._index.tsx"),
  route("admin/questions",        "routes/admin.questions._index.tsx"),
  route("admin/questions/new",    "routes/admin.questions.new.tsx"),
  route("admin/questions/:id",    "routes/admin.questions.$id.tsx"),
  route("admin/paragraphs",       "routes/admin.paragraphs._index.tsx"),
  route("admin/paragraphs/new",   "routes/admin.paragraphs.new.tsx"),
] satisfies RouteConfig;
