import { createRequestHandler } from "@react-router/cloudflare";
import * as build from "./server/index.js";

const handler = createRequestHandler({ build, mode: "production" });

export default {
  async fetch(request, env, ctx) {
    return handler({
      request,
      env,
      waitUntil: ctx.waitUntil.bind(ctx),
      passThroughOnException: ctx.passThroughOnException.bind(ctx),
    });
  },
};