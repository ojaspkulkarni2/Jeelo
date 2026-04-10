import { createRequestHandler } from "@react-router/cloudflare";
import * as build from "./server/index.js";

const handler = createRequestHandler({ build, mode: "production" });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve static assets directly
    if (url.pathname.startsWith("/assets/") || url.pathname === "/favicon.ico") {
      return env.ASSETS.fetch(request);
    }

    return handler({
      request,
      env,
      waitUntil: ctx.waitUntil.bind(ctx),
      passThroughOnException: ctx.passThroughOnException.bind(ctx),
    });
  },
};