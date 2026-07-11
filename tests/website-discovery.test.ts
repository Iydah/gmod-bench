import { describe, expect, test } from "bun:test";
import {
  PAGE_METADATA,
  canonicalUrl,
} from "../website/src/content/site-content";
import { cachePolicyFor } from "../website/src/lib/cache-policy";
import { getPublishedRun } from "../website/src/lib/published-runs";
import leaderboard from "../website/src/data/leaderboard.json";
import archive from "../website/src/data/runs.json";
import {
  renderDocsMarkdown,
  renderLeaderboardMarkdown,
  renderLlmsFull,
  renderLlmsIndex,
  renderMethodologyMarkdown,
  renderRobots,
  renderRunsMarkdown,
} from "../website/src/lib/discovery";
import {
  buildStructuredData,
  securityHeaders,
  serializeCloudflareCacheControl,
} from "../website/src/lib/seo";
import createDisabledSessionDriver from "../website/src/lib/disabled-session-driver";

describe("website public contracts", () => {
  test("canonical URLs use the production origin and normalized path", () => {
    expect(
      canonicalUrl(
        new URL("https://preview.example/docs?utm_source=test#section"),
      ),
    ).toBe("https://gmodbench.com/docs/");
    expect(canonicalUrl(new URL("https://preview.example/llms.txt"))).toBe(
      "https://gmodbench.com/llms.txt",
    );
  });

  test("cache policies are bounded by route family", () => {
    expect(cachePolicyFor("/leaderboard/").name).toBe("leaderboardHtml");
    expect(cachePolicyFor("/llms.txt").name).toBe("discoveryText");
    expect(
      cachePolicyFor("/runs/824cda9a-438d-49bb-a9fa-b581e95e2b65/").name,
    ).toBe("immutableRunHtml");
    expect(cachePolicyFor("/not-a-route").name).toBe("notFound");
  });

  test("canonical pages have unique titles and descriptions", () => {
    const pages = Object.values(PAGE_METADATA).filter(
      ({ robots }) => !robots.startsWith("noindex"),
    );
    expect(new Set(pages.map(({ title }) => title)).size).toBe(pages.length);
    expect(new Set(pages.map(({ description }) => description)).size).toBe(
      pages.length,
    );
  });

  test("published run lookup fails closed for unknown identifiers", () => {
    expect(getPublishedRun("824cda9a-438d-49bb-a9fa-b581e95e2b65")?.runId).toBe(
      "824cda9a-438d-49bb-a9fa-b581e95e2b65",
    );
    expect(getPublishedRun("../leaderboard")).toBeUndefined();
    expect(getPublishedRun("missing")).toBeUndefined();
  });

  test("structured data uses route-specific public schema types", () => {
    expect(
      buildStructuredData("home", { canonical: "https://gmodbench.com/" }).map(
        (node) => node["@type"],
      ),
    ).toEqual(["WebSite", "SoftwareApplication"]);
    expect(
      buildStructuredData("leaderboard", {
        canonical: "https://gmodbench.com/leaderboard/",
      }).map((node) => node["@type"]),
    ).toEqual(["Dataset", "BreadcrumbList"]);
    expect(
      buildStructuredData("runs", {
        canonical: "https://gmodbench.com/runs/",
      }).map((node) => node["@type"]),
    ).toEqual(["CollectionPage", "BreadcrumbList"]);
  });

  test("cache and security headers fail closed", () => {
    expect(
      serializeCloudflareCacheControl(cachePolicyFor("/leaderboard/")),
    ).toBe("public, max-age=3600, stale-while-revalidate=86400");

    const production = securityHeaders(true);
    expect(production["X-Content-Type-Options"]).toBe("nosniff");
    expect(production["Referrer-Policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(production["Strict-Transport-Security"]).toContain(
      "max-age=31536000",
    );
    expect(securityHeaders(false)["Strict-Transport-Security"]).toBeUndefined();
  });

  test("robots and llms indexes expose canonical discovery routes", () => {
    expect(renderRobots()).toContain(
      "Sitemap: https://gmodbench.com/sitemap-index.xml",
    );
    const index = renderLlmsIndex();
    expect(index.startsWith("# gmod-bench\n\n> ")).toBe(true);
    expect(index).toContain("## Documentation");
    expect(index).toContain("https://gmodbench.com/docs/index.html.md");
    expect(renderLlmsFull()).toContain("## Benchmark contract");
  });

  test("Markdown alternatives are bounded and identify canonical HTML", () => {
    expect(renderDocsMarkdown()).toContain(
      "Canonical HTML: https://gmodbench.com/docs/",
    );
    expect(renderMethodologyMarkdown()).toContain(
      "Canonical HTML: https://gmodbench.com/methodology/",
    );

    const leaderboardText = renderLeaderboardMarkdown(leaderboard);
    expect(leaderboardText.length).toBeLessThan(100_000);
    expect(leaderboardText).toContain(
      "Canonical HTML: https://gmodbench.com/leaderboard/",
    );

    const runsText = renderRunsMarkdown(archive);
    expect(runsText.length).toBeLessThan(100_000);
    for (const run of archive.runs) {
      expect(runsText.match(new RegExp(run.runId, "g"))?.length).toBe(4);
    }
  });

  test("unused Astro sessions fail closed without provisioning storage", async () => {
    const session = createDisabledSessionDriver();
    await expect(session.getItem("key")).rejects.toThrow(
      "Sessions are disabled for this public website",
    );
    await expect(session.setItem("key", "value")).rejects.toThrow(
      "Sessions are disabled for this public website",
    );
  });
});
