import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { publishRunToR2 } from "../src/storage/r2";

const projectRoot = join(import.meta.dir, "..");
const artifactRoot = join(projectRoot, ".gmod-bench", "runs");
const config = (await Bun.file(
  join(projectRoot, "gmod-bench.config.json"),
).json()) as {
  storage?: {
    r2?: { enabled?: boolean; bucket?: string; publicBaseUrl?: string };
  };
};
const r2 = config.storage?.r2;
if (!r2?.enabled || !r2.bucket || !r2.publicBaseUrl)
  throw new Error("Enable storage.r2 with bucket and publicBaseUrl first.");

const runFlag = process.argv.indexOf("--run");
const selected = runFlag >= 0 ? process.argv[runFlag + 1] : "all";
if (!selected) throw new Error("--run requires a run id or all.");
const runIds =
  selected === "all"
    ? (await readdir(artifactRoot)).filter(
        (name) => !name.startsWith(".") && !/checkpoint/i.test(name),
      )
    : [selected];

for (const runId of runIds.sort()) {
  const directory = join(artifactRoot, runId);
  if (!(await Bun.file(join(directory, "artifact-manifest.json")).exists()))
    continue;
  try {
    const result = await publishRunToR2(directory, {
      bucket: r2.bucket,
      publicBaseUrl: r2.publicBaseUrl,
      cachePath: join(projectRoot, ".gmod-bench", "r2-uploaded.json"),
      scratchRoot: join(projectRoot, ".gmod-bench", "scratch"),
    });
    console.log(
      `${runId}: uploaded ${result.uploadedBlobs}, deduplicated ${result.skippedBlobs} → ${result.manifestUrl}`,
    );
  } catch (error) {
    console.error(
      `${runId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
