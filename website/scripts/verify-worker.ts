import archive from "../src/data/runs.json";

const HOST = "127.0.0.1";
const PORT = 8791;
const ORIGIN = `http://${HOST}:${PORT}`;
const START_TIMEOUT_MS = 15_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitForServer(
  process: ReturnType<typeof Bun.spawn>,
): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(
        `preview exited before becoming ready (${process.exitCode})`,
      );
    }
    try {
      const response = await fetch(`${ORIGIN}/robots.txt`);
      if (response.ok) return;
    } catch {
      // The listener is not ready yet.
    }
    await Bun.sleep(100);
  }
  throw new Error(`preview did not start within ${START_TIMEOUT_MS}ms`);
}

async function request(path: string, navigate = false): Promise<Response> {
  return fetch(`${ORIGIN}${path}`, {
    redirect: "manual",
    headers: navigate ? { "Sec-Fetch-Mode": "navigate" } : undefined,
  });
}

async function stopPreview(child: ReturnType<typeof Bun.spawn>): Promise<void> {
  if (child.exitCode !== null) return;

  if (process.platform === "win32") {
    const taskkill = Bun.spawn(
      ["taskkill", "/PID", String(child.pid), "/T", "/F"],
      { stdout: "ignore", stderr: "ignore" },
    );
    await taskkill.exited;
  } else {
    child.kill();
  }

  await child.exited;
}

function assertSecurityHeaders(response: Response, path: string): void {
  assert(
    response.headers.get("x-content-type-options") === "nosniff",
    `${path}: missing nosniff`,
  );
  assert(
    response.headers.get("referrer-policy") ===
      "strict-origin-when-cross-origin",
    `${path}: wrong referrer policy`,
  );
  assert(
    response.headers.get("x-frame-options") === "DENY",
    `${path}: missing frame denial`,
  );
}

async function assertHtml(path: string): Promise<string> {
  const response = await request(path, true);
  assert(
    response.status === 200,
    `${path}: expected 200, got ${response.status}`,
  );
  assert(
    response.headers.get("content-type")?.startsWith("text/html"),
    `${path}: expected HTML`,
  );
  assertSecurityHeaders(response, path);
  assert(
    response.headers.has("cloudflare-cdn-cache-control"),
    `${path}: missing Cloudflare cache policy`,
  );
  assert(response.headers.has("cache-tag"), `${path}: missing cache tags`);

  const html = await response.text();
  assert(
    /<link rel="canonical" href="https:\/\/gmodbench\.com\//.test(html),
    `${path}: missing canonical`,
  );
  assert(
    /<meta name="robots" content="index,follow/.test(html),
    `${path}: missing index policy`,
  );
  assert(
    /<meta property="og:image" content="https:\/\/gmodbench\.com\/social-card\.png"/.test(
      html,
    ),
    `${path}: missing social image`,
  );
  assert(
    /<meta name="twitter:card" content="summary_large_image"/.test(html),
    `${path}: missing Twitter card`,
  );

  const jsonLd = [
    ...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs),
  ];
  assert(jsonLd.length > 0, `${path}: missing JSON-LD`);
  for (const [, json] of jsonLd) JSON.parse(json);
  assert(
    [...html.matchAll(/rel="preload"[^>]+as="font"/g)].length <= 5,
    `${path}: more font preloads than configured variants`,
  );
  return html;
}

async function combinedStyles(html: string): Promise<string> {
  const hrefs = [
    ...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g),
  ].map(([, href]) => href);
  const responses = await Promise.all(hrefs.map((href) => request(href)));
  return (await Promise.all(responses.map((response) => response.text()))).join(
    "\n",
  );
}

async function verify(): Promise<void> {
  const preview = Bun.spawn(
    ["bun", "run", "preview", "--", "--host", HOST, "--port", String(PORT)],
    {
      cwd: import.meta.dir.replace(/[\\/]scripts$/, ""),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  try {
    await waitForServer(preview);
    const homeHtml = await assertHtml("/");
    assert(
      homeHtml.includes(
        "Find the best AI models for Garry&#39;s Mod development.",
      ),
      "home page must lead with the model-selection benefit",
    );
    assert(
      homeHtml.includes(
        "gmod-bench tests how well AI models write real Garry&#39;s Mod Lua, so you can choose the right model for your next addon.",
      ),
      "home page must explain the practical GMod developer benefit",
    );
    assert(
      (homeHtml.match(/ data-model=/g) ?? []).length <= 12,
      "home page must keep the leaderboard preview bounded",
    );
    assert(
      homeHtml.includes("font-display:swap"),
      "font faces must use the metric-compatible swap policy",
    );
    assert(
      (homeHtml.match(/rel="preload"[^>]+as="font"/g) ?? []).length === 5,
      "all configured font weights must be preloaded",
    );
    assert(
      !homeHtml.includes('<link rel="stylesheet"'),
      "small critical stylesheets should be inlined",
    );
    assert(
      !homeHtml.includes('aria-label="Filter by'),
      "filter accessible names must include their visible text",
    );
    assert(
      !/\sstyle="/.test(homeHtml),
      "inline style attributes violate the strict CSP",
    );
    await assertHtml("/leaderboard/");
    const docsHtml = await assertHtml("/docs/");
    await assertHtml("/methodology/");
    await assertHtml("/runs/");
    const representativeRun = archive.runs[0];
    assert(representativeRun, "published run archive is empty");
    const runHtml = await assertHtml(`/runs/${representativeRun.runId}/`);
    for (const artifact of [
      "run.json",
      "report.md",
      "leaderboard.json",
      "attempts.jsonl",
      "attempts.csv",
    ]) {
      assert(
        runHtml.includes(`/runs/${representativeRun.runId}/${artifact}`),
        `run page is missing ${artifact}`,
      );
    }
    assert(
      !(await combinedStyles(docsHtml)).includes(".table-toolbar"),
      "/docs/: leaderboard CSS leaked into a content route",
    );

    const missing = await request("/missing-contract-route", true);
    assert(missing.status === 404, `missing route returned ${missing.status}`);
    assertSecurityHeaders(missing, "/missing-contract-route");
    const missingHtml = await missing.text();
    assert(
      /<meta name="robots" content="noindex,follow"/.test(missingHtml),
      "404 page must be noindex",
    );

    const manifest = await request("/site.webmanifest");
    assert(manifest.status === 200, "manifest is missing");
    JSON.parse(await manifest.text());

    const social = await request("/social-card.png");
    assert(social.status === 200, "social card is missing");
    const signature = new Uint8Array((await social.arrayBuffer()).slice(0, 8));
    assert(
      signature.join(",") === "137,80,78,71,13,10,26,10",
      "social card is not a PNG",
    );

    for (const path of ["/.well-known/security.txt", "/humans.txt"]) {
      const response = await request(path);
      assert(response.status === 200, `${path} is missing`);
    }

    for (const [path, contentType] of [
      ["/robots.txt", "text/plain"],
      ["/llms.txt", "text/plain"],
      ["/llms-full.txt", "text/plain"],
      ["/docs/index.html.md", "text/markdown"],
      ["/methodology/index.html.md", "text/markdown"],
      ["/leaderboard/index.html.md", "text/markdown"],
      ["/runs/index.html.md", "text/markdown"],
    ] as const) {
      const response = await request(path);
      assert(response.status === 200, `${path}: expected 200`);
      assert(
        response.headers.get("content-type")?.startsWith(contentType),
        `${path}: wrong content type`,
      );
      assertSecurityHeaders(response, path);
    }

    const sitemapIndex = await request("/sitemap-index.xml");
    assert(sitemapIndex.status === 200, "sitemap index is missing");
    const sitemapIndexText = await sitemapIndex.text();
    assert(
      sitemapIndexText.includes("https://gmodbench.com/sitemap-0.xml"),
      "sitemap index does not reference the generated sitemap",
    );
    const sitemap = await request("/sitemap-0.xml");
    const sitemapText = await sitemap.text();
    for (const run of archive.runs) {
      assert(
        sitemapText.includes(`https://gmodbench.com/runs/${run.runId}/`),
        `sitemap is missing run ${run.runId}`,
      );
    }
    assert(
      !sitemapText.includes("index.html.md") &&
        !sitemapText.includes("llms.txt"),
      "utility discovery routes leaked into the sitemap",
    );

    const generatedConfig = await Bun.file(
      new URL("../dist/server/wrangler.json", import.meta.url),
    ).json();
    assert(
      generatedConfig.cache?.enabled === true,
      "Workers Cache is disabled",
    );
    assert(
      generatedConfig.cache?.cross_version_cache === false,
      "Worker cache must remain version-isolated",
    );
    assert(
      generatedConfig.kv_namespaces?.length === 0,
      "unused KV bindings were provisioned",
    );
    assert(
      generatedConfig.assets?.not_found_handling === undefined,
      "assets.not_found_handling intercepts browser navigations before Astro",
    );

    console.log(
      "Worker route, metadata, cache, and security contracts passed.",
    );
  } finally {
    await stopPreview(preview);
  }
}

await verify();
