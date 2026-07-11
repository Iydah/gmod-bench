import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { summarizeAttempts } from "../src/core/summary";
import type { RunArtifact } from "../src/core/types";
import { writeRunArtifacts } from "../src/report/write";

test("writes sanitized reports and only emits redacted raw logs when requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "gmod-bench-artifacts-"));
  const attempts = [
    {
      fixtureId: "gmod.player-iterator.v1",
      adapterId: "claude" as const,
      model: "sonnet",
      attemptIndex: 1,
      status: "pass" as const,
      detail: "ok",
      finalResponse: "answer",
      durationMs: 1,
      version: "1",
      rawOutput: { stdout: "token=secret-value", stderr: "Bearer sk-live-abc" },
    },
  ];
  const run: RunArtifact = {
    schemaVersion: 3,
    runId: "run-abc",
    fixtureIds: ["gmod.player-iterator.v1"],
    startedAt: "t0",
    completedAt: "t1",
    repeat: 1,
    concurrency: 1,
    attempts,
    summary: summarizeAttempts(attempts),
  };

  try {
    const paths = await writeRunArtifacts(root, run, true);
    const json = JSON.parse(
      await Bun.file(paths.jsonPath).text(),
    ) as RunArtifact;
    expect(json.attempts[0]?.rawOutput).toBeUndefined();
    expect(json.summary.statusCounts.pass).toBe(1);

    expect(await Bun.file(paths.markdownPath).exists()).toBeTrue();
    expect(await Bun.file(paths.metadataPath).exists()).toBeTrue();
    expect(await Bun.file(paths.leaderboardCsvPath).exists()).toBeTrue();
    expect(await Bun.file(paths.leaderboardJsonPath).exists()).toBeTrue();
    expect(await Bun.file(paths.manifestPath).exists()).toBeTrue();
    const manifest = (await Bun.file(paths.manifestPath).json()) as {
      files: Array<{
        path: string;
        sha256: string;
        bytes: number;
        role: string;
      }>;
    };
    expect(
      manifest.files.some(
        (file) =>
          file.path === "run.json" &&
          file.role === "canonical" &&
          file.sha256.length === 64,
      ),
    ).toBeTrue();
    expect(manifest.files.every((file) => file.bytes >= 0)).toBeTrue();
    expect(await Bun.file(paths.attemptsJsonlPath).exists()).toBeTrue();
    expect(await Bun.file(paths.attemptsCsvPath).exists()).toBeTrue();
    expect(await Bun.file(paths.predsJsonlPath).exists()).toBeTrue();
    expect(paths.responsePaths.length).toBeGreaterThan(0);
    expect(await Bun.file(paths.responsePaths[0]!).exists()).toBeTrue();

    const leaderboardCsv = await Bun.file(paths.leaderboardCsvPath).text();
    expect(leaderboardCsv).toContain("rank,model");
    expect(leaderboardCsv).toContain("sonnet");
    expect(leaderboardCsv).toContain("coverage");

    const preds = await Bun.file(paths.predsJsonlPath).text();
    expect(preds).toContain("instance_id");
    expect(preds).toContain("model_patch");

    const meta = JSON.parse(await Bun.file(paths.metadataPath).text()) as {
      schemaVersion: number;
      keepRaw: boolean;
    };
    expect(meta.schemaVersion).toBe(3);
    expect(meta.keepRaw).toBeTrue();

    const raw = await Bun.file(paths.rawLogPaths[0] ?? "").text();
    expect(raw).toContain("[REDACTED]");
    expect(raw).not.toContain("sk-live-abc");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("response artifact paths cannot collide or escape their run directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "gmod-bench-artifacts-"));
  const base = {
    fixtureId: "gmod.player-iterator.v1",
    adapterId: "openrouter" as const,
    attemptIndex: 1,
    status: "pass" as const,
    detail: "ok",
    finalResponse: "answer",
    durationMs: 1,
    version: "1",
  };
  const attempts = [
    { ...base, model: "provider/model" },
    { ...base, model: "provider_model" },
    {
      ...base,
      adapterId: "../../outside" as never,
      model: ".",
      attemptIndex: 2,
    },
  ];
  const run: RunArtifact = {
    schemaVersion: 3,
    runId: "run-paths",
    fixtureIds: [base.fixtureId],
    startedAt: "t0",
    completedAt: "t1",
    repeat: 1,
    concurrency: 1,
    attempts,
    summary: summarizeAttempts(attempts),
  };

  try {
    const paths = await writeRunArtifacts(root, run, false);
    expect(new Set(paths.responsePaths).size).toBe(paths.responsePaths.length);
    expect(
      paths.responsePaths.every((path) => path.startsWith(paths.responsesDir)),
    ).toBeTrue();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("response artifact paths stay below the Windows legacy path limit", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "gmod-bench-artifacts-"));
  const root = join(tempRoot, "nested-artifact-root".repeat(4));
  await mkdir(root);
  const attempts = [
    {
      fixtureId: `gmod.perf.${"long-fixture-name-".repeat(5)}.v1`,
      adapterId: "openrouter" as const,
      model: `provider/${"long-reasoning-model-".repeat(5)}@medium`,
      attemptIndex: 1,
      status: "pass" as const,
      detail: "ok",
      finalResponse: "answer",
      durationMs: 1,
      version: "1",
    },
  ];
  const run: RunArtifact = {
    schemaVersion: 3,
    runId: "59029ed6-30eb-4d96-ad76-21deda2a06fa",
    fixtureIds: [attempts[0]!.fixtureId],
    startedAt: "t0",
    completedAt: "t1",
    repeat: 1,
    concurrency: 1,
    attempts,
    summary: summarizeAttempts(attempts),
  };

  try {
    const paths = await writeRunArtifacts(root, run, false);
    expect(
      Math.max(...paths.responsePaths.map((path) => path.length)),
    ).toBeLessThan(260);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
