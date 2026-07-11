import cloudflare from "@astrojs/cloudflare";
import { cacheCloudflare } from "@astrojs/cloudflare/cache";
import sitemap from "@astrojs/sitemap";
import { defineConfig, fontProviders } from "astro/config";
import archive from "./src/data/runs.json";
import { CACHE_ROUTE_RULES } from "./src/lib/cache-policy";

const runPages = archive.runs.map(
  ({ runId }) => `https://gmodbench.com/runs/${runId}/`,
);

const ASTRO_COMMANDS = ["dev", "build", "check", "preview"] as const;
const astroCommand =
  ASTRO_COMMANDS.find((command) => process.argv.includes(command)) ?? "default";

export default defineConfig({
  site: "https://gmodbench.com",
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  integrations: [sitemap({ customPages: runPages })],
  markdown: { syntaxHighlight: "prism" },
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  vite: {
    cacheDir: `node_modules/.vite/${astroCommand}`,
  },
  cache: {
    provider: cacheCloudflare(),
  },
  routeRules: CACHE_ROUTE_RULES,
  session: {
    driver: {
      entrypoint: new URL(
        "./src/lib/disabled-session-driver.ts",
        import.meta.url,
      ),
    },
  },
  security: {
    csp: {
      // Allow Cloudflare Web Analytics: the beacon script host and its
      // reporting endpoint. Everything else stays same-origin only.
      scriptDirective: {
        resources: ["'self'", "https://static.cloudflareinsights.com"],
      },
      directives: [
        "default-src 'self'",
        "base-uri 'self'",
        "connect-src 'self' https://cloudflareinsights.com",
        "font-src 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "img-src 'self' data:",
        "manifest-src 'self'",
        "object-src 'none'",
      ],
    },
  },
  fonts: [
    {
      provider: fontProviders.local(),
      name: "Geist Sans",
      cssVariable: "--font-sans",
      fallbacks: ["Inter", "Segoe UI", "sans-serif"],
      display: "swap",
      options: {
        variants: [
          { src: ["./src/assets/fonts/geist-sans-400.woff2"], weight: 400 },
          { src: ["./src/assets/fonts/geist-sans-500.woff2"], weight: 500 },
          { src: ["./src/assets/fonts/geist-sans-600.woff2"], weight: 600 },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: "Geist Mono",
      cssVariable: "--font-mono",
      fallbacks: ["Cascadia Code", "Consolas", "monospace"],
      display: "swap",
      options: {
        variants: [
          { src: ["./src/assets/fonts/geist-mono-400.woff2"], weight: 400 },
          { src: ["./src/assets/fonts/geist-mono-500.woff2"], weight: 500 },
        ],
      },
    },
  ],
  build: {
    assets: "_assets",
    inlineStylesheets: "always",
  },
});
