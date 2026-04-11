import { createRequestHandler } from "@react-router/cloudflare";
import * as build from "./server/index.js";

const handleRequest = createRequestHandler({ build, mode: "production" });

export default {
  async fetch(request, env, ctx) {
    // Serve static assets — mirrors createPagesFunctionHandler internals exactly:
    // fetch(url, clone) → check 200-399 → wrap in new Response to avoid immutable-header issues
    let assetResponse;
    try {
      assetResponse = await env.ASSETS.fetch(request.url, request.clone());
      assetResponse =
        assetResponse.status >= 200 && assetResponse.status < 400
          ? new Response(assetResponse.body, assetResponse)
          : undefined;
    } catch {
      assetResponse = undefined;
    }

    if (assetResponse) return assetResponse;

    // createRequestHandler expects a flat cloudflare context object —
    // it reshapes this internally into context.cloudflare.env / .ctx for your loaders
    return handleRequest({
      request,
      env,
      waitUntil: ctx.waitUntil.bind(ctx),
      passThroughOnException: ctx.passThroughOnException.bind(ctx),
    });
  },
};
