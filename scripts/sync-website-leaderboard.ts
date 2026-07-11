/**
 * CLI wrapper for cumulative website leaderboard publish.
 *   bun run scripts/sync-website-leaderboard.ts
 *   bun run website:sync-leaderboard
 */
import { join } from "node:path";

import { publishCumulativeWebsiteLeaderboard } from "../src/report/publish-leaderboard";

const projectRoot = join(import.meta.dir, "..");
const configFile = Bun.file(join(projectRoot, "gmod-bench.config.json"));
const config = (await configFile.exists())
  ? ((await configFile.json()) as {
      storage?: { r2?: { enabled?: boolean; publicBaseUrl?: string } };
    })
  : {};

const result = await publishCumulativeWebsiteLeaderboard({
  artifactRoot: join(projectRoot, ".gmod-bench", "runs"),
  fixturesRoot: join(projectRoot, "fixtures"),
  websiteLeaderboardPath: join(
    projectRoot,
    "website",
    "src",
    "data",
    "leaderboard.json",
  ),
  includeCheckpoints: process.argv.includes("--include-checkpoints"),
  minScored: (() => {
    const i = process.argv.indexOf("--min-scored");
    return i >= 0 ? Number(process.argv[i + 1] ?? 0) : 0;
  })(),
  ...(config.storage?.r2?.enabled && config.storage.r2.publicBaseUrl
    ? { storagePublicBaseUrl: config.storage.r2.publicBaseUrl }
    : {}),
  log: (message) => console.log(message),
});

if (result.modelRows === 0) {
  console.error("[sync] no rows published");
  process.exit(1);
}
