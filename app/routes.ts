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
  route("questions/:id",  "routes/questions.$id.tsx"),
  route("paragraphs/new", "routes/paragraphs.new.tsx"),

  route("settings",          "routes/settings.tsx"),
  // ── Tests ─────────────────────────────────────────────────
  route("tests",             "routes/tests._index.tsx"),
  route("tests/generate",    "routes/tests.generate.tsx"),
  route("tests/:id",         "routes/tests.$id.tsx"),
  route("tests/:id/preview", "routes/tests.$id.preview.tsx"),
  route("tests/:id/take",    "routes/tests.$id.take.tsx"),
  route("tests/:id/result",  "routes/tests.$id.result.tsx"),
  route("tests/:id/result/review", "routes/tests.$id.result.review.tsx"),
  route("all-tests",         "routes/all-tests.tsx"),
] satisfies RouteConfig;
