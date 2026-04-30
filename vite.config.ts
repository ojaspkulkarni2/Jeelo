import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflareDevProxy } from "@react-router/dev/vite/cloudflare";
import path from "path";

export default defineConfig({
  plugins: [
    cloudflareDevProxy({
      getLoadContext({ context }) {
        return { cloudflare: context.cloudflare };
      },
    }),
    reactRouter(),
  ],
  resolve: {
    // dedupe forces Vite to always use one copy of React — the correct fix
    // for "useContext null" / "module is not defined" caused by duplicate instances.
    // Do NOT use path aliases pointing at node_modules/react — that resolves to
    // the CJS index.js and breaks ESM bundling.
    dedupe: ["react", "react-dom", "react-router"],
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
});