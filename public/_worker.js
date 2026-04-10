import { createRequestHandler } from "@react-router/cloudflare";
import * as build from "./server/index.js";

const handler = createRequestHandler({ build, mode: "production" });

export default {
  async fetch(request, env, ctx) {
    // Try static assets first (covers /assets/*, *.png, *.ico, etc.)
    // If the file doesn't exist in ASSETS it returns a 404 — fall through to SSR.
    try {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
    } catch {}

    return handler({
      request,
      env,
      waitUntil: ctx.waitUntil.bind(ctx),
      passThroughOnException: ctx.passThroughOnException.bind(ctx),
    });
  },
};
