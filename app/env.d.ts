import type { AppLoadContext } from "@react-router/cloudflare";

interface CloudflareBindings {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  JEELO_SESSION_SECRET: string;
  ANALYTICS_API_KEY: string;
  ENVIRONMENT: string;
}

declare module "@react-router/cloudflare" {
  interface AppLoadContext {
    cloudflare: {
      env: CloudflareBindings;
      ctx: ExecutionContext;
    };
  }
}
