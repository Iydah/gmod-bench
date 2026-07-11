import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { RunArtifact } from "../src/core/types";
import {
  rebuildRunExports,
  verifyRunDirectory,
} from "../src/report/maintenance";
import { writeRunArtifacts } from "../src/report/write";
import { summarizeAttempts } from "../src/core/summary";

const root = join(import.meta.dir, ".tmp-maintenance");
afterEach(() => rm(root, { recursive: true, force: true }));

test("detects artifact tampering and rebuilds derived exports", async () => {
  const attempts = [
    {
      fixtureId: "gmod.a.v1",
      adapterId: "openrouter" as const,
      model: "m",
      attemptIndex: 1,
      status: "pass" as const,
      detail: "ok",
      finalResponse: "answer",
      durationMs: 1,
      version: "api",
      fixtureVersion: 1,
      rubricVersion: "1",
      promptHash: "h",
    },
  ];
  const run: RunArtifact = {
    schemaVersion: 3,
    runId: "run-a",
    fixtureIds: ["gmod.a.v1"],
    startedAt: "2026-07-10T00:00:00Z",
    completedAt: "2026-07-10T00:00:01Z",
    repeat: 1,
    concurrency: 1,
    attempts,
    summary: summarizeAttempts(attempts),
  };
  const paths = await writeRunArtifacts(root, run, false);
  expect((await verifyRunDirectory(paths.directory)).ok).toBeTrue();

  await Bun.write(paths.markdownPath, "tampered");
  expect(
    (await verifyRunDirectory(paths.directory)).issues.some((issue) =>
      issue.includes("report.md"),
    ),
  ).toBeTrue();

  await rebuildRunExports(paths.directory);
  expect((await verifyRunDirectory(paths.directory)).ok).toBeTrue();
});
