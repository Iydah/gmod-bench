import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { BenchConfig } from "../cli/config";
import type { BenchPaths } from "../cli/runtime";
import type { RunArtifact } from "../core/types";
import { publishCumulativeWebsiteLeaderboard } from "../report/publish-leaderboard";
import { writeRunArtifacts, type RunArtifactPaths } from "../report/write";
import { publishRunToR2 } from "../storage/r2";
import {
  completedSlotIndexPath,
  rebuildCompletedSlotIndex,
} from "./completed-index";
import type { RunJournal } from "./journal";

export async function finalizeRun(
  artifact: RunArtifact,
  keepRaw: boolean,
  paths: BenchPaths,
  config: BenchConfig,
  journal: RunJournal,
  log: (message: string) => void,
): Promise<RunArtifactPaths> {
  const artifactPaths = await writeRunArtifacts(
    paths.artifactRoot,
    artifact,
    keepRaw,
  );
  try {
    await rebuildCompletedSlotIndex(paths.artifactRoot);
  } catch (error) {
    await rm(completedSlotIndexPath(paths.artifactRoot), { force: true });
    log(
      `[gmod-bench] completed-slot index rebuild failed; removed stale cache so history will scan canonical runs (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  await journal.remove();
  log(`[gmod-bench] wrote ${artifactPaths.directory}/`);
  log(
    "[gmod-bench]   report.md · run.json · metadata.json · artifact-manifest.json · leaderboard.{json,csv} · attempts.{jsonl,csv} · preds.jsonl · responses/ · raw/",
  );
  log(
    `[gmod-bench] summary pass=${artifact.summary.statusCounts.pass} partial=${artifact.summary.statusCounts.partial} incorrect=${artifact.summary.statusCounts.incorrect} protocol_error=${artifact.summary.statusCounts.protocol_error} timeout=${artifact.summary.statusCounts.timeout} mean=${artifact.summary.overallMeanScore?.toFixed(3) ?? "—"}`,
  );

  if (
    resolve(paths.artifactRoot) !==
    resolve(paths.projectRoot, ".gmod-bench", "runs")
  )
    return artifactPaths;
  try {
    const published = await publishCumulativeWebsiteLeaderboard({
      artifactRoot: paths.artifactRoot,
      websiteLeaderboardPath: join(
        paths.projectRoot,
        "website",
        "src",
        "data",
        "leaderboard.json",
      ),
      ...(config.storage?.r2?.enabled && config.storage.r2.publicBaseUrl
        ? { storagePublicBaseUrl: config.storage.r2.publicBaseUrl }
        : {}),
      log,
    });
    if (published.modelRows > 0)
      log(
        `[gmod-bench] website: cumulative board now ${published.modelRows} model-row(s) across ${published.runCount} run(s)`,
      );
  } catch (error) {
    log(
      `[gmod-bench] website leaderboard sync skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const r2 = config.storage?.r2;
  if (r2?.enabled) {
    try {
      if (!r2.bucket || !r2.publicBaseUrl)
        throw new Error("storage.r2 requires bucket and publicBaseUrl");
      const uploaded = await publishRunToR2(artifactPaths.directory, {
        bucket: r2.bucket,
        publicBaseUrl: r2.publicBaseUrl,
        cachePath: join(paths.projectRoot, ".gmod-bench", "r2-uploaded.json"),
        scratchRoot: paths.scratchRoot,
      });
      log(
        `[gmod-bench] R2: ${uploaded.uploadedBlobs} blob(s) uploaded, ${uploaded.skippedBlobs} deduplicated → ${uploaded.manifestUrl}`,
      );
    } catch (error) {
      log(
        `[gmod-bench] R2 publish skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return artifactPaths;
}
