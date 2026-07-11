import site from "../data/site.json";

export const SITE = site;
export const SITE_ORIGIN = new URL(site.url);
export const SOCIAL_IMAGE_PATH = "/social-card.png";

export type PageId =
  "home" | "leaderboard" | "methodology" | "docs" | "runs" | "run" | "notFound";

export type RobotsPolicy =
  "index,follow,max-image-preview:large" | "noindex,follow";

export interface PageMetadata {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly robots: RobotsPolicy;
  readonly ogType: "website" | "article";
}

export const PAGE_METADATA = {
  home: {
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    path: "/",
    robots: "index,follow,max-image-preview:large",
    ogType: "website",
  },
  leaderboard: {
    title: `Best AI models for Garry's Mod · ${site.name}`,
    description:
      "Compare AI models for Garry's Mod coding using public GMod Lua challenges, scores, and inspectable results.",
    path: "/leaderboard/",
    robots: "index,follow,max-image-preview:large",
    ogType: "website",
  },
  methodology: {
    title: `Methodology · ${site.name}`,
    description:
      "See how gmod-bench tests and ranks AI models on Garry's Mod Lua knowledge, correctness, safety, and performance.",
    path: "/methodology/",
    robots: "index,follow,max-image-preview:large",
    ogType: "article",
  },
  docs: {
    title: `Documentation · ${site.name}`,
    description:
      "Run gmod-bench yourself to compare AI models on Garry's Mod coding challenges and inspect every result.",
    path: "/docs/",
    robots: "index,follow,max-image-preview:large",
    ogType: "article",
  },
  runs: {
    title: `Published run archive · ${site.name}`,
    description:
      "Browse the published runs behind the Garry's Mod AI model leaderboard and inspect their results.",
    path: "/runs/",
    robots: "index,follow,max-image-preview:large",
    ogType: "website",
  },
  run: {
    title: `Published benchmark run · ${site.name}`,
    description:
      "Inspect one published Garry's Mod coding benchmark run, including its models, scores, and answers.",
    path: "/runs/",
    robots: "index,follow,max-image-preview:large",
    ogType: "website",
  },
  notFound: {
    title: `Page not found · ${site.name}`,
    description: "The requested gmod-bench page does not exist.",
    path: "/404.html",
    robots: "noindex,follow",
    ogType: "website",
  },
} as const satisfies Record<PageId, PageMetadata>;

const FILE_PATH = /\/[^/]+\.[a-z0-9]+$/i;

export function canonicalUrl(url: URL, pathOverride?: string): string {
  const canonical = new URL(pathOverride ?? url.pathname, SITE_ORIGIN);
  canonical.search = "";
  canonical.hash = "";

  if (canonical.pathname !== "/" && !FILE_PATH.test(canonical.pathname)) {
    canonical.pathname = `${canonical.pathname.replace(/\/+$/, "")}/`;
  }

  return canonical.toString();
}
