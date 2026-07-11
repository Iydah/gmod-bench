import { join, resolve, sep } from "node:path";

import { summarizeAttempts } from "../core/summary";
import type { RunArtifact } from "../core/types";
import {
  buildRunMetadata,
  renderAttemptsCsv,
  renderAttemptsJsonl,
  renderLeaderboardCsv,
  renderLeaderboardJson,
  renderPredsJsonl,
} from "./exports";
import { renderMarkdownReport } from "./markdown";
import { rebuildArtifactManifest, rebuildResponseExports } from "./write";

interface ManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface VerificationResult {
  ok: boolean;
  issues: string[];
}

function contained(root: string, relativePath: string): string {
  const resolvedRoot = resolve(root);
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${resolvedRoot}${sep}`))
    throw new Error(`Manifest path escapes run directory: ${relativePath}`);
  return path;
}

export async function verifyRunDirectory(
  directory: string,
): Promise<VerificationResult> {
  const issues: string[] = [];
  const manifestFile = Bun.file(join(directory, "artifact-manifest.json"));
  if (!(await manifestFile.exists()))
    return { ok: false, issues: ["artifact-manifest.json is missing"] };
  const manifest = (await manifestFile.json()) as {
    runId?: string;
    files?: ManifestEntry[];
  };
  if (!Array.isArray(manifest.files))
    return { ok: false, issues: ["artifact-manifest.json has no files array"] };
  for (const entry of manifest.files) {
    try {
      const path = contained(directory, entry.path);
      const file = Bun.file(path);
      if (!(await file.exists())) {
        issues.push(`${entry.path}: missing`);
        continue;
      }
      const bytes = await file.arrayBuffer();
      const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== entry.bytes)
        issues.push(`${entry.path}: byte size mismatch`);
      if (hash !== entry.sha256) issues.push(`${entry.path}: SHA-256 mismatch`);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  try {
    const run = (await Bun.file(
      join(directory, "run.json"),
    ).json()) as RunArtifact;
    const keys = new Set<string>();
    for (const attempt of run.attempts) {
      const key = `${attempt.adapterId}\0${attempt.model ?? ""}\0${attempt.fixtureId}\0${attempt.attemptIndex}`;
      if (keys.has(key)) issues.push(`run.json: duplicate attempt ${key}`);
      keys.add(key);
    }
    if (
      JSON.stringify(summarizeAttempts(run.attempts)) !==
      JSON.stringify(run.summary)
    )
      issues.push("run.json: summary does not match attempts");
  } catch (error) {
    issues.push(
      `run.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { ok: issues.length === 0, issues };
}

export async function rebuildRunExports(directory: string): Promise<void> {
  const run = (await Bun.file(
    join(directory, "run.json"),
  ).json()) as RunArtifact;
  const keepRaw = await Bun.file(join(directory, "raw")).exists();
  const metadata = buildRunMetadata(run, keepRaw);
  await Promise.all([
    Bun.write(join(directory, "report.md"), renderMarkdownReport(run)),
    Bun.write(
      join(directory, "metadata.json"),
      JSON.stringify(metadata, null, 2),
    ),
    Bun.write(join(directory, "leaderboard.json"), renderLeaderboardJson(run)),
    Bun.write(join(directory, "leaderboard.csv"), renderLeaderboardCsv(run)),
    Bun.write(join(directory, "attempts.jsonl"), renderAttemptsJsonl(run)),
    Bun.write(join(directory, "attempts.csv"), renderAttemptsCsv(run)),
    Bun.write(join(directory, "preds.jsonl"), renderPredsJsonl(run)),
  ]);
  await rebuildResponseExports(directory, run);
  await rebuildArtifactManifest(directory, run.runId, run.completedAt);
}
