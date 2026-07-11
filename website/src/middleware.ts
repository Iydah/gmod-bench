import { defineMiddleware } from "astro:middleware";
import { cachePolicyFor } from "./lib/cache-policy";
import { securityHeaders } from "./lib/seo";

const CACHEABLE_METHODS = new Set(["GET", "HEAD"]);

export const onRequest = defineMiddleware(async ({ request, url }, next) => {
  const response = await next();
  const headers = new Headers(response.headers);
  const production =
    url.protocol === "https:" && url.hostname === "gmodbench.com";

  for (const [name, value] of Object.entries(securityHeaders(production))) {
    headers.set(name, value);
  }

  const policy = cachePolicyFor(url.pathname);
  const cacheable =
    CACHEABLE_METHODS.has(request.method) &&
    response.status === 200 &&
    !headers.has("Set-Cookie") &&
    policy.name !== "notFound";

  headers.set(
    "Cache-Control",
    cacheable ? "public, max-age=0, must-revalidate" : "no-store",
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
