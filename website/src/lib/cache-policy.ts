export type CachePolicyName =
  | "siteHtml"
  | "leaderboardHtml"
  | "immutableRunHtml"
  | "discoveryText"
  | "notFound";

export interface CachePolicy {
  readonly name: CachePolicyName;
  readonly maxAge: number;
  readonly sharedMaxAge: number;
  readonly staleWhileRevalidate: number;
  readonly tags: readonly string[];
}

const POLICIES = {
  siteHtml: {
    name: "siteHtml",
    maxAge: 0,
    sharedMaxAge: 86_400,
    staleWhileRevalidate: 604_800,
    tags: ["site"],
  },
  leaderboardHtml: {
    name: "leaderboardHtml",
    maxAge: 0,
    sharedMaxAge: 3_600,
    staleWhileRevalidate: 86_400,
    tags: ["site", "leaderboard"],
  },
  immutableRunHtml: {
    name: "immutableRunHtml",
    maxAge: 0,
    sharedMaxAge: 604_800,
    staleWhileRevalidate: 2_592_000,
    tags: ["site", "runs"],
  },
  discoveryText: {
    name: "discoveryText",
    maxAge: 0,
    sharedMaxAge: 86_400,
    staleWhileRevalidate: 604_800,
    tags: ["site", "discovery"],
  },
  notFound: {
    name: "notFound",
    maxAge: 0,
    sharedMaxAge: 0,
    staleWhileRevalidate: 0,
    tags: [],
  },
} as const satisfies Record<CachePolicyName, CachePolicy>;

function routeRule(policy: CachePolicy) {
  return {
    maxAge: policy.sharedMaxAge,
    swr: policy.staleWhileRevalidate,
    tags: [...policy.tags],
  };
}

export const CACHE_ROUTE_RULES = {
  "/": routeRule(POLICIES.siteHtml),
  "/docs": { ...routeRule(POLICIES.siteHtml), tags: ["site", "docs"] },
  "/methodology": {
    ...routeRule(POLICIES.siteHtml),
    tags: ["site", "methodology"],
  },
  "/leaderboard": routeRule(POLICIES.leaderboardHtml),
  "/runs": { ...routeRule(POLICIES.siteHtml), tags: ["site", "runs"] },
  "/runs/[runId]": routeRule(POLICIES.immutableRunHtml),
  "/robots.txt": routeRule(POLICIES.discoveryText),
  "/llms.txt": routeRule(POLICIES.discoveryText),
  "/llms-full.txt": routeRule(POLICIES.discoveryText),
  "/[section]/index.html.md": routeRule(POLICIES.discoveryText),
};

const PUBLIC_HTML_PATHS = new Set(["/", "/docs/", "/methodology/", "/runs/"]);
const DISCOVERY_PATH =
  /^(?:\/robots\.txt|\/llms(?:-full)?\.txt|\/(?:docs|methodology|leaderboard|runs)\/index\.html\.md)$/;
const RUN_DETAIL_PATH = /^\/runs\/[0-9a-f-]{36}\/$/;

export function normalizePathname(pathname: string): string {
  if (pathname === "/" || /\.[a-z0-9]+$/i.test(pathname)) return pathname;
  return `${pathname.replace(/\/+$/, "")}/`;
}

export function cachePolicyFor(pathname: string): CachePolicy {
  const normalized = normalizePathname(pathname);
  if (normalized === "/leaderboard/") return POLICIES.leaderboardHtml;
  if (RUN_DETAIL_PATH.test(normalized)) return POLICIES.immutableRunHtml;
  if (DISCOVERY_PATH.test(normalized)) return POLICIES.discoveryText;
  if (PUBLIC_HTML_PATHS.has(normalized)) return POLICIES.siteHtml;
  return POLICIES.notFound;
}
