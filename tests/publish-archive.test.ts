import { afterEach, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { summarizeAttempts } from "../src/core/summary";
import type { AttemptRecord } from "../src/core/types";
import { buildModelLeaderboard } from "../src/report/leaderboard";
import { publishCumulativeWebsiteLeaderboard } from "../src/report/publish-leaderboard";

const root = join(import.meta.dir, ".tmp-publish-archive");
afterEach(() => rm(root, { recursive: true, force: true }));

async function writeFinishedRun(
  runId: string,
  fixtureId: string,
): Promise<void> {
  const dir = join(root, "runs", runId);
  await mkdir(dir, { recursive: true });
  await Bun.write(
    join(dir, "metadata.json"),
    JSON.stringify({ repeat: 1, completedAt: "2026-07-10T12:00:00Z" }),
  );
  await Bun.write(
    join(dir, "leaderboard.json"),
    JSON.stringify({
      models: [
        {
          adapterId: "openrouter",
          model: "model/a",
          attempts: 1,
          scored: 1,
          pass: 1,
          partial: 0,
          incorrect: 0,
          protocol_error: 0,
          passRate: 1,
          quality: 1,
          coverage: 1,
          avgDurationMs: 1,
        },
      ],
    }),
  );
  await Bun.write(
    join(dir, "run.json"),
    JSON.stringify({
      schemaVersion: 3,
      runId,
      fixtureIds: [fixtureId],
      startedAt: "start",
      completedAt: "done",
      repeat: 1,
      concurrency: 1,
      attempts: [
        {
          fixtureId,
          adapterId: "openrouter",
          model: "model/a",
          attemptIndex: 1,
          status: "pass",
          detail: "ok",
          finalResponse: "answer",
          durationMs: 1,
          version: "api",
          rawOutput: { stdout: "secret", stderr: "secret" },
        },
      ],
      summary: {},
    }),
  );
  await Bun.write(join(dir, "report.md"), `# ${runId}`);
  await Bun.write(join(dir, "attempts.jsonl"), "{}\n");
  await Bun.write(join(dir, "attempts.csv"), "fixture\n");
  await Bun.write(join(dir, "raw.log"), "must not publish");
}

async function writeRankingRun(options: {
  runId: string;
  fixtureIds: string[];
  repeat: number;
  completedAt: string;
  models: Array<{
    id: string;
    statuses: AttemptRecord["status"][];
    finalResponses?: Array<string | null>;
  }>;
}): Promise<void> {
  const dir = join(root, "runs", options.runId);
  await mkdir(dir, { recursive: true });
  const attempts: AttemptRecord[] = options.models.flatMap((model) =>
    model.statuses.map((status, index) => ({
      fixtureId: options.fixtureIds[index % options.fixtureIds.length]!,
      adapterId: "openrouter" as const,
      model: model.id,
      attemptIndex: Math.floor(index / options.fixtureIds.length) + 1,
      status,
      detail: status,
      finalResponse: model.finalResponses
        ? (model.finalResponses[index] ?? null)
        : status,
      durationMs: 1,
      version: "test",
    })),
  );
  const artifact = {
    schemaVersion: 3 as const,
    runId: options.runId,
    fixtureIds: options.fixtureIds,
    startedAt: "start",
    completedAt: options.completedAt,
    repeat: options.repeat,
    concurrency: 1,
    attempts,
    summary: summarizeAttempts(attempts),
  };
  await Bun.write(
    join(dir, "metadata.json"),
    JSON.stringify({
      repeat: options.repeat,
      completedAt: options.completedAt,
    }),
  );
  await Bun.write(
    join(dir, "leaderboard.json"),
    JSON.stringify({ models: buildModelLeaderboard(attempts) }),
  );
  await Bun.write(join(dir, "run.json"), JSON.stringify(artifact));
  await Bun.write(join(dir, "report.md"), `# ${options.runId}`);
  await Bun.write(join(dir, "attempts.jsonl"), "{}\n");
  await Bun.write(join(dir, "attempts.csv"), "fixture\n");
}

test("publishes one comparable primary cohort ranked by fixture score", async () => {
  await writeRankingRun({
    runId: "smoke",
    fixtureIds: ["a"],
    repeat: 1,
    completedAt: "2026-07-11T01:00:00Z",
    models: [{ id: "smoke-perfect", statuses: ["pass"] }],
  });
  await writeRankingRun({
    runId: "broad",
    fixtureIds: ["a", "b", "c", "d"],
    repeat: 1,
    completedAt: "2026-07-10T01:00:00Z",
    models: [
      { id: "strong", statuses: ["pass", "pass", "pass", "pass"] },
      {
        id: "weak",
        statuses: ["pass", "incorrect", "pass", "incorrect"],
      },
      {
        id: "partial-evidence",
        statuses: [
          "pass",
          "protocol_error",
          "protocol_error",
          "protocol_error",
        ],
      },
      {
        id: "runner-failure",
        statuses: [
          "protocol_error",
          "protocol_error",
          "protocol_error",
          "protocol_error",
        ],
        finalResponses: [null, null, null, null],
      },
    ],
  });
  await writeRankingRun({
    runId: "repeat",
    fixtureIds: ["a", "b"],
    repeat: 2,
    completedAt: "2026-07-11T02:00:00Z",
    models: [
      {
        id: "repeat-volume",
        statuses: ["pass", "incorrect", "pass", "incorrect"],
      },
    ],
  });
  await writeRankingRun({
    runId: "newer-large-suite",
    fixtureIds: ["a", "b", "c"],
    repeat: 1,
    completedAt: "2026-07-11T03:00:00Z",
    models: [{ id: "newer-only", statuses: ["pass", "pass", "pass"] }],
  });

  const dataRoot = join(root, "website", "src", "data");
  await mkdir(dataRoot, { recursive: true });
  const leaderboardPath = join(dataRoot, "leaderboard.json");
  const publishResult = await publishCumulativeWebsiteLeaderboard({
    artifactRoot: join(root, "runs"),
    websiteLeaderboardPath: leaderboardPath,
    websiteRunsIndexPath: join(dataRoot, "runs.json"),
    websitePublicRoot: join(root, "website", "public"),
  });

  const board = (await Bun.file(leaderboardPath).json()) as {
    meta: {
      fixtureCount: number;
      cohortRepeat: number;
      excludedModelRowCount: number;
      excludedNonCohortRowCount: number;
      supersededCohortRowCount: number;
      unrankedZeroEvidenceRowCount: number;
      unrankedInsufficientEvidenceRowCount: number;
      minimumRankedCoverage: number;
    };
    models: Array<{
      rank: number | null;
      model: string;
      fixtureScore: number;
      rankingStatus?: string;
    }>;
  };
  expect(board.models.map((row) => row.model)).toEqual([
    "strong",
    "weak",
    "partial-evidence",
  ]);
  expect(board.models.map((row) => row.rank)).toEqual([1, 2, 3]);
  expect(board.models.map((row) => row.fixtureScore)).toEqual([1, 0.5, 0.25]);
  expect(board.models[2]?.rankingStatus).toBeUndefined();
  expect(publishResult.modelRows).toBe(3);
  expect(board.meta.fixtureCount).toBe(4);
  expect(board.meta.cohortRepeat).toBe(1);
  expect(board.meta.excludedModelRowCount).toBe(4);
  expect(board.meta.excludedNonCohortRowCount).toBe(3);
  expect(board.meta.supersededCohortRowCount).toBe(0);
  expect(board.meta.unrankedZeroEvidenceRowCount).toBe(1);
  expect(board.meta.unrankedInsufficientEvidenceRowCount).toBe(0);
  expect(board.meta.minimumRankedCoverage).toBe(0.5);
});

test("aggregates compatible verified runs and separates harness from model format failures", async () => {
  await writeRankingRun({
    runId: "older",
    fixtureIds: ["a", "b"],
    repeat: 1,
    completedAt: "2026-07-10T01:00:00Z",
    models: [
      { id: "cumulative", statuses: ["pass", "incorrect"] },
      {
        id: "harness",
        statuses: ["pass", "protocol_error"],
        finalResponses: ["pass", null],
      },
      { id: "format", statuses: ["pass", "protocol_error"] },
    ],
  });
  await writeRankingRun({
    runId: "newer",
    fixtureIds: ["a", "b"],
    repeat: 1,
    completedAt: "2026-07-11T01:00:00Z",
    models: [
      { id: "cumulative", statuses: ["pass", "pass"] },
      {
        id: "harness",
        statuses: ["pass", "protocol_error"],
        finalResponses: ["pass", null],
      },
      { id: "format", statuses: ["pass", "protocol_error"] },
    ],
  });

  const dataRoot = join(root, "website", "src", "data");
  await mkdir(dataRoot, { recursive: true });
  const leaderboardPath = join(dataRoot, "leaderboard.json");
  await publishCumulativeWebsiteLeaderboard({
    artifactRoot: join(root, "runs"),
    websiteLeaderboardPath: leaderboardPath,
    websiteRunsIndexPath: join(dataRoot, "runs.json"),
    websitePublicRoot: join(root, "website", "public"),
  });

  const board = (await Bun.file(leaderboardPath).json()) as {
    models: Array<Record<string, unknown> & { model: string }>;
  };
  const cumulative = board.models.find((row) => row.model === "cumulative");
  const harness = board.models.find((row) => row.model === "harness");
  const format = board.models.find((row) => row.model === "format");
  expect(cumulative).toMatchObject({
    fixtureScore: 0.75,
    verifiedRunCount: 2,
    evidenceAttempts: 4,
    scheduledAttempts: 4,
  });
  expect(harness).toMatchObject({
    fixtureScore: 1,
    harnessFailures: 2,
    modelFormatFailures: 0,
  });
  expect(format).toMatchObject({
    fixtureScore: 0.5,
    harnessFailures: 0,
    modelFormatFailures: 2,
  });
});

test("publishes an additive sanitized run archive and union fixture count", async () => {
  await writeFinishedRun("run-a", "gmod.a.v1");
  await writeFinishedRun("run-b", "gmod.b.v1");
  const leaderboardPath = join(
    root,
    "website",
    "src",
    "data",
    "leaderboard.json",
  );
  const runsIndexPath = join(root, "website", "src", "data", "runs.json");
  const publicRoot = join(root, "website", "public");
  await mkdir(join(root, "website", "src", "data"), { recursive: true });

  const result = await publishCumulativeWebsiteLeaderboard({
    artifactRoot: join(root, "runs"),
    websiteLeaderboardPath: leaderboardPath,
    websiteRunsIndexPath: runsIndexPath,
    websitePublicRoot: publicRoot,
  });
  expect(result.runCount).toBe(2);
  const board = (await Bun.file(leaderboardPath).json()) as {
    meta: { fixtureCount: number; publishedFixtureCount: number };
  };
  expect(board.meta.fixtureCount).toBe(1);
  expect(board.meta.publishedFixtureCount).toBe(2);
  const archived = await Bun.file(
    join(publicRoot, "runs", "run-a", "run.json"),
  ).text();
  expect(archived).not.toContain("rawOutput");
  expect(archived).not.toContain("secret");
  expect(
    await Bun.file(join(publicRoot, "runs", "run-a", "report.md")).exists(),
  ).toBeTrue();
  expect(
    await Bun.file(join(publicRoot, "runs", "run-a", "raw.log")).exists(),
  ).toBeFalse();

  await rm(join(root, "runs", "run-a"), { recursive: true });
  await publishCumulativeWebsiteLeaderboard({
    artifactRoot: join(root, "runs"),
    websiteLeaderboardPath: leaderboardPath,
    websiteRunsIndexPath: runsIndexPath,
    websitePublicRoot: publicRoot,
  });
  const index = (await Bun.file(runsIndexPath).json()) as {
    runs: Array<{ runId: string }>;
  };
  expect(index.runs.map((run) => run.runId).sort()).toEqual(["run-a", "run-b"]);
  expect(
    await Bun.file(join(publicRoot, "runs", "run-a", "run.json")).exists(),
  ).toBeTrue();
});
