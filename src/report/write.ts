import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { hashPrompt, safePathSegment } from "../core/attempt-meta";
import { collectEnvironmentSecrets, redactText } from "../core/redaction";
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

export interface RunArtifactPaths {
  directory: string;
  jsonPath: string;
  markdownPath: string;
  metadataPath: string;
  manifestPath: string;
  leaderboardJsonPath: string;
  leaderboardCsvPath: string;
  attemptsJsonlPath: string;
  attemptsCsvPath: string;
  predsJsonlPath: string;
  responsesDir: string;
  rawDir: string;
  rawLogPaths: string[];
  responsePaths: string[];
}

interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
  role: "canonical" | "provenance" | "derived" | "answer" | "diagnostic";
}

async function manifestFile(
  root: string,
  path: string,
  role: ManifestFile["role"],
): Promise<ManifestFile> {
  const file = Bun.file(path);
  const bytes = await file.arrayBuffer();
  return {
    path: relative(root, path).replaceAll("\\", "/"),
    bytes: bytes.byteLength,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    role,
  };
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function manifestRole(root: string, path: string): ManifestFile["role"] {
  const name = relative(root, path).replaceAll("\\", "/");
  if (name === "run.json") return "canonical";
  if (name === "metadata.json") return "provenance";
  if (name.startsWith("responses/")) return "answer";
  if (name.startsWith("raw/")) return "diagnostic";
  return "derived";
}

export async function rebuildArtifactManifest(
  directory: string,
  runId: string,
  completedAt: string,
): Promise<string> {
  const manifestPath = join(directory, "artifact-manifest.json");
  const paths = (await listFiles(directory))
    .filter((path) => resolve(path) !== resolve(manifestPath))
    .sort();
  const files: ManifestFile[] = [];
  for (const path of paths)
    files.push(
      await manifestFile(directory, path, manifestRole(directory, path)),
    );
  await Bun.write(
    manifestPath,
    `${JSON.stringify({ schemaVersion: 1, runId, generatedAt: completedAt, files }, null, 2)}\n`,
  );
  return manifestPath;
}

async function renameDirectoryWithRetry(
  source: string,
  destination: string,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const retryable =
        error instanceof Error &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EBUSY");
      if (!retryable || attempt >= 4) throw error;
      await new Promise<void>((resolveDelay) =>
        setTimeout(resolveDelay, 20 * (attempt + 1)),
      );
    }
  }
}

function safeRunId(runId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }

  return runId;
}

function uniquePathSegment(value: string): string {
  return `${safePathSegment(value, 16)}-${hashPrompt(value).slice(0, 8)}`;
}

function containedPath(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root);
  const path = resolve(resolvedRoot, ...segments);
  if (!path.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Artifact path escapes its configured root: ${path}`);
  }
  return path;
}

function withoutRawOutput(run: RunArtifact): RunArtifact {
  return {
    ...run,
    attempts: run.attempts.map(
      ({ rawOutput: _rawOutput, ...attempt }) => attempt,
    ),
  };
}

function redactRawLog(
  rawOutput: NonNullable<RunArtifact["attempts"][number]["rawOutput"]>,
  secrets: readonly string[],
) {
  return {
    stdout: redactText(rawOutput.stdout, secrets),
    stderr: redactText(rawOutput.stderr, secrets),
  };
}

export async function rebuildResponseExports(
  directory: string,
  run: RunArtifact,
): Promise<string[]> {
  const responsesDir = join(directory, "responses");
  const responsePaths: string[] = [];
  const createdDirectories = new Set<string>();
  for (const attempt of run.attempts) {
    if (
      !attempt.finalResponse ||
      attempt.finalResponse.includes("(from log; body not captured)")
    )
      continue;
    const adapterSeg = safePathSegment(attempt.adapterId);
    const modelSeg = uniquePathSegment(attempt.model ?? attempt.adapterId);
    const dir = containedPath(responsesDir, adapterSeg, modelSeg);
    if (!createdDirectories.has(dir)) {
      await mkdir(dir, { recursive: true });
      createdDirectories.add(dir);
    }
    const file = containedPath(
      dir,
      `${uniquePathSegment(attempt.fixtureId)}--k${attempt.attemptIndex}.txt`,
    );
    const header = [
      `fixture: ${attempt.fixtureId}`,
      `adapter: ${attempt.adapterId}`,
      `model: ${attempt.model ?? ""}`,
      `attempt: ${attempt.attemptIndex}`,
      `status: ${attempt.status}`,
      `detail: ${attempt.detail}`,
      `durationMs: ${attempt.durationMs}`,
      `fixtureVersion: ${attempt.fixtureVersion ?? ""}`,
      `rubricVersion: ${attempt.rubricVersion ?? ""}`,
      `promptHash: ${attempt.promptHash ?? ""}`,
      "---",
      "",
    ].join("\n");
    await Bun.write(
      file,
      header +
        attempt.finalResponse +
        (attempt.finalResponse.endsWith("\n") ? "" : "\n"),
    );
    responsePaths.push(file);
  }
  return responsePaths;
}

/**
 * Persist a full run for audit (SWE/DeepSWE-inspired):
 * - run.json + metadata.json
 * - leaderboard + attempts (csv/jsonl)
 * - preds.jsonl (prediction-style)
 * - responses/<model>/<fixture>--kN.txt (always, when body exists)
 * - raw/<…>.log (when keepRaw and rawOutput present)
 */
export async function writeRunArtifacts(
  root: string,
  run: RunArtifact,
  keepRaw: boolean,
): Promise<RunArtifactPaths> {
  const resolvedRoot = resolve(root);
  const directory = resolve(resolvedRoot, safeRunId(run.runId));
  if (!directory.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error("Run artifact directory escapes the configured root.");
  }

  await mkdir(resolvedRoot, { recursive: true });
  try {
    await stat(directory);
    throw new Error(`Run artifact directory already exists: ${directory}`);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
  }

  const stagingDirectory = containedPath(
    resolvedRoot,
    `.partial-${hashPrompt(safeRunId(run.runId)).slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`,
  );
  await mkdir(stagingDirectory);

  try {
    const metadata = buildRunMetadata(run, keepRaw);
    const artifact: RunArtifact = {
      ...withoutRawOutput(run),
      schemaVersion: 3,
      metadata,
      summary: run.summary,
    };

    const jsonPath = join(stagingDirectory, "run.json");
    const markdownPath = join(stagingDirectory, "report.md");
    const metadataPath = join(stagingDirectory, "metadata.json");
    const manifestPath = join(stagingDirectory, "artifact-manifest.json");
    const leaderboardJsonPath = join(stagingDirectory, "leaderboard.json");
    const leaderboardCsvPath = join(stagingDirectory, "leaderboard.csv");
    const attemptsJsonlPath = join(stagingDirectory, "attempts.jsonl");
    const attemptsCsvPath = join(stagingDirectory, "attempts.csv");
    const predsJsonlPath = join(stagingDirectory, "preds.jsonl");
    const responsesDir = join(stagingDirectory, "responses");
    const rawDir = join(stagingDirectory, "raw");

    await Promise.all([
      Bun.write(jsonPath, JSON.stringify(artifact, null, 2)),
      Bun.write(markdownPath, renderMarkdownReport(artifact)),
      Bun.write(metadataPath, JSON.stringify(metadata, null, 2)),
      Bun.write(leaderboardJsonPath, renderLeaderboardJson(artifact)),
      Bun.write(leaderboardCsvPath, renderLeaderboardCsv(artifact)),
      Bun.write(attemptsJsonlPath, renderAttemptsJsonl(artifact)),
      Bun.write(attemptsCsvPath, renderAttemptsCsv(artifact)),
      Bun.write(predsJsonlPath, renderPredsJsonl(artifact)),
    ]);

    const responsePaths = await rebuildResponseExports(stagingDirectory, run);

    const rawLogPaths: string[] = [];
    if (keepRaw) {
      const secrets = collectEnvironmentSecrets(process.env);
      await mkdir(rawDir, { recursive: true });
      for (const [index, attempt] of run.attempts.entries()) {
        if (!attempt.rawOutput) {
          continue;
        }
        const adapterPart = safePathSegment(attempt.adapterId);
        const modelPart = attempt.model
          ? `-${uniquePathSegment(attempt.model)}`
          : "";
        const path = containedPath(
          rawDir,
          `attempt-${index + 1}-${adapterPart}${modelPart}.log`,
        );
        const rawOutput = redactRawLog(attempt.rawOutput, secrets);
        await Bun.write(
          path,
          `[stdout]\n${rawOutput.stdout}\n\n[stderr]\n${rawOutput.stderr}\n`,
        );
        rawLogPaths.push(path);
      }
    }

    await rebuildArtifactManifest(
      stagingDirectory,
      run.runId,
      metadata.completedAt,
    );

    await renameDirectoryWithRetry(stagingDirectory, directory);

    const published = (path: string) =>
      join(directory, path.slice(stagingDirectory.length + 1));
    return {
      directory,
      jsonPath: published(jsonPath),
      markdownPath: published(markdownPath),
      metadataPath: published(metadataPath),
      manifestPath: published(manifestPath),
      leaderboardJsonPath: published(leaderboardJsonPath),
      leaderboardCsvPath: published(leaderboardCsvPath),
      attemptsJsonlPath: published(attemptsJsonlPath),
      attemptsCsvPath: published(attemptsCsvPath),
      predsJsonlPath: published(predsJsonlPath),
      responsesDir: published(responsesDir),
      rawDir: published(rawDir),
      rawLogPaths: rawLogPaths.map(published),
      responsePaths: responsePaths.map(published),
    };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}
