import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflareDevProxy } from "@react-router/dev/vite/cloudflare";

export default defineConfig({
  plugins: [
    cloudflareDevProxy(),
    reactRouter(),
  ],
});
