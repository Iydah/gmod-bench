import {
  PAGE_METADATA,
  SITE,
  SOCIAL_IMAGE_PATH,
} from "../content/site-content";
import leaderboard from "../data/leaderboard.json";
import archive from "../data/runs.json";
import type { CachePolicy } from "./cache-policy";
import type { PublishedRun } from "./published-runs";

export type JsonLdNode = Record<string, unknown> & {
  readonly "@context": "https://schema.org";
  readonly "@type": string;
};

export interface StructuredDataContext {
  readonly canonical: string;
  readonly run?: PublishedRun;
}

const ORGANIZATION = {
  "@type": "Organization",
  name: SITE.name,
  url: SITE.url,
};

function breadcrumb(name: string, canonical: string): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: SITE.url,
      },
      { "@type": "ListItem", position: 2, name, item: canonical },
    ],
  };
}

function datasetDistribution(url: string, encodingFormat: string) {
  return {
    "@type": "DataDownload",
    contentUrl: url,
    encodingFormat,
  };
}

export function buildStructuredData(
  pageId: keyof typeof PAGE_METADATA,
  context: StructuredDataContext,
): JsonLdNode[] {
  const { canonical, run } = context;

  switch (pageId) {
    case "home":
      return [
        {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SITE.name,
          url: SITE.url,
          description: SITE.description,
          inLanguage: "en",
        },
        {
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: SITE.name,
          url: SITE.url,
          description: SITE.description,
          applicationCategory: "DeveloperApplication",
          operatingSystem: "Windows, macOS, Linux",
          codeRepository: SITE.github,
          license: `${SITE.github}/blob/main/LICENSE`,
          image: new URL(SOCIAL_IMAGE_PATH, SITE.url).toString(),
        },
      ];
    case "leaderboard":
      return [
        {
          "@context": "https://schema.org",
          "@type": "Dataset",
          name: `gmod-bench model leaderboard`,
          description: PAGE_METADATA.leaderboard.description,
          url: canonical,
          creator: ORGANIZATION,
          dateModified: leaderboard.meta.date,
          license: `${SITE.github}/blob/main/LICENSE`,
          variableMeasured: [
            "fixture score",
            "pass rate",
            "coverage",
            "pass@k",
          ],
          distribution: [
            datasetDistribution(`${SITE.url}/runs/`, "text/html"),
            datasetDistribution(
              `${SITE.url}/runs/${leaderboard.meta.primaryRunId}/leaderboard.json`,
              "application/json",
            ),
          ],
        },
        breadcrumb("Leaderboard", canonical),
      ];
    case "docs":
    case "methodology":
      return [
        {
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: PAGE_METADATA[pageId].title,
          description: PAGE_METADATA[pageId].description,
          url: canonical,
          author: ORGANIZATION,
          inLanguage: "en",
        },
        breadcrumb(
          pageId === "docs" ? "Documentation" : "Methodology",
          canonical,
        ),
      ];
    case "runs":
      return [
        {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Published gmod-bench runs",
          description: PAGE_METADATA.runs.description,
          url: canonical,
          dateModified: archive.generatedAt,
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: archive.runs.length,
          },
        },
        breadcrumb("Runs", canonical),
      ];
    case "run": {
      if (!run) return [breadcrumb("Run", canonical)];
      const base = `${SITE.url}/runs/${run.runId}`;
      return [
        {
          "@context": "https://schema.org",
          "@type": "Dataset",
          name: `gmod-bench run ${run.runId}`,
          description: `Published benchmark run with ${run.fixtureCount} fixtures and ${run.attemptCount} attempts.`,
          url: canonical,
          creator: ORGANIZATION,
          dateCreated: run.completedAt,
          license: `${SITE.github}/blob/main/LICENSE`,
          distribution: [
            datasetDistribution(`${base}/run.json`, "application/json"),
            datasetDistribution(
              `${base}/attempts.jsonl`,
              "application/x-ndjson",
            ),
            datasetDistribution(`${base}/attempts.csv`, "text/csv"),
            datasetDistribution(`${base}/report.md`, "text/markdown"),
          ],
        },
        breadcrumb(`Run ${run.runId.slice(0, 8)}`, canonical),
      ];
    }
    case "notFound":
      return [];
  }
}

export function serializeCloudflareCacheControl(policy: CachePolicy): string {
  if (policy.sharedMaxAge === 0) return "no-store";
  return `public, max-age=${policy.sharedMaxAge}, stale-while-revalidate=${policy.staleWhileRevalidate}`;
}

export function securityHeaders(
  production: boolean,
): Readonly<Record<string, string>> {
  return {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy":
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...(production
      ? {
          "Strict-Transport-Security":
            "max-age=31536000; includeSubDomains; preload",
        }
      : {}),
  };
}
