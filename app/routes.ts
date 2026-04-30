import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Root — landing or redirect to /map
  index("routes/_index.tsx"),

  // Auth
  route("login",   "routes/login.tsx"),
  route("signup",  "routes/signup.tsx"),
  route("logout",  "routes/logout.tsx"),

  // Core platform
  route("map",      "routes/map.tsx"),
  route("feed",         "routes/feed.tsx"),
  route("feed-actions", "routes/feed-actions.tsx"),
  route("discover", "routes/discover.tsx"),
  route("arena/questions", "routes/arena.questions.tsx"),

  // Tests
  route("tests/generate",    "routes/tests.generate.tsx"),
  route("tests/:id",         "routes/tests.$id/route.tsx"),
  route("tests/:id/preview", "routes/tests.$id.preview.tsx"),
  route("tests/:id/take",    "routes/tests.$id.take/route.tsx"),
  route("tests/:id/result",  "routes/tests.$id.result/route.tsx"),
  route("tests/:id/result/review", "routes/tests.$id.result.review.tsx"),
  route("tests",             "routes/tests._index.tsx"),

  // Social
  route("u/:username",   "routes/u.$username.tsx"),
  route("q/:id",         "routes/q.$id.tsx"),
  route("chapter/:slug", "routes/chapter.$slug.tsx"),

  // Questions (standalone creation/view only — no library)
  route("questions/new",       "routes/questions.new.tsx"),
  route("questions/:id",       "routes/questions.$id.tsx"),

  // Arena (Duels)
  route("arena",                      "routes/arena._index.tsx"),
  route("arena/:matchId",             "routes/arena.$matchId.tsx"),
  route("arena/:matchId/result",      "routes/arena.$matchId.result.tsx"),
  route("arena/pvp/:matchId",         "routes/arena.pvp.$matchId.tsx"),
  route("arena/pvp/:matchId/result",  "routes/arena.pvp.$matchId.result.tsx"),
  route("arena/queue-status",         "routes/arena.queue-status.tsx"),
  route("people",                      "routes/people.tsx"),

  // Meta
  route("profile",  "routes/profile.tsx"),
  route("settings", "routes/settings.tsx"),
  route("about",    "routes/about.tsx"),

  // Legacy redirects
  route("dashboard", "routes/dashboard._index.tsx"),
  route("all-tests", "routes/all-tests-redirect.tsx"),
  route("tests",     "routes/tests-redirect.tsx"),
] satisfies RouteConfig;
