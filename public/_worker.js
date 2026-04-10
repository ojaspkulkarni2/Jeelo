import { createRequestHandler } from "@react-router/cloudflare";
import * as build from "./server/index.js";

const handler = createRequestHandler(build, "production");

export default {
  async fetch(request, env, ctx) {
    return handler(request, {
      cloudflare: {
        env,
        ctx,
        cf: request.cf ?? {},
      },
    });
  },
};
