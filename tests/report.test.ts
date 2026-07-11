import { expect, test } from "bun:test";

import { summarizeAttempts } from "../src/core/summary";
import type { AttemptRecord, RunArtifact } from "../src/core/types";
import { buildModelLeaderboard } from "../src/report/leaderboard";
import { renderMarkdownReport } from "../src/report/markdown";

function rankingAttempt(
  model: string,
  fixtureId: string,
  attemptIndex: number,
  status: AttemptRecord["status"],
): AttemptRecord {
  return {
    fixtureId,
    adapterId: "openrouter",
    model,
    attemptIndex,
    status,
    detail: status,
    finalResponse: status === "protocol_error" ? null : status,
    durationMs: 1,
    version: "test",
  };
}

test("leaderboard weights fixtures equally instead of rewarding repeat volume", () => {
  const attempts: AttemptRecord[] = [];
  for (let attemptIndex = 1; attemptIndex <= 5; attemptIndex += 1) {
    attempts.push(
      rankingAttempt("repeat-volume", "fixture-a", attemptIndex, "pass"),
      rankingAttempt("repeat-volume", "fixture-b", attemptIndex, "incorrect"),
    );
  }
  attempts.push(
    rankingAttempt("stronger", "fixture-a", 1, "pass"),
    rankingAttempt("stronger", "fixture-b", 1, "pass"),
  );

  const rows = buildModelLeaderboard(attempts);

  expect(rows.map((row) => row.model)).toEqual(["stronger", "repeat-volume"]);
  expect(rows[0]?.fixtureScore).toBe(1);
  expect(rows[1]?.fixtureScore).toBe(0.5);
  expect(rows[1]?.pass).toBe(5);
});

test("leaderboard fixture score counts unscorable model failures as zero", () => {
  const rows = buildModelLeaderboard([
    rankingAttempt("format-failure", "fixture-a", 1, "pass"),
    rankingAttempt("format-failure", "fixture-b", 1, "protocol_error"),
    rankingAttempt("partial", "fixture-a", 1, "partial"),
    rankingAttempt("partial", "fixture-b", 1, "partial"),
  ]);

  expect(rows.map((row) => row.model)).toEqual(["format-failure", "partial"]);
  expect(rows[0]?.fixtureScore).toBe(0.5);
  expect(rows[1]?.fixtureScore).toBe(0.5);
  expect(rows[0]?.fixtureSolveRate).toBe(0.5);
  expect(rows[1]?.fixtureSolveRate).toBe(0);
});

test("reports scored attempts, models, details, and pass@k separately from unavailable runners", () => {
  const attempts: AttemptRecord[] = [
    {
      fixtureId: "gmod.player-iterator.v1",
      adapterId: "openrouter",
      model: "openai/gpt-4o-mini",
      attemptIndex: 1,
      status: "pass",
      detail: "Uses the direct cached player iterator.",
      finalResponse: "ok",
      durationMs: 10,
      version: "openrouter-api",
    },
    {
      fixtureId: "gmod.player-iterator.v1",
      adapterId: "openrouter",
      model: "openai/gpt-4o-mini",
      attemptIndex: 2,
      status: "incorrect",
      detail: "wrong",
      finalResponse: "no",
      durationMs: 11,
      version: "openrouter-api",
    },
    {
      fixtureId: "gmod.player-iterator.v1",
      adapterId: "devin",
      model: null,
      attemptIndex: 1,
      status: "unavailable",
      detail: "missing",
      finalResponse: null,
      durationMs: 0,
      version: null,
    },
  ];

  const summary = summarizeAttempts(attempts);
  expect(summary.statusCounts.pass).toBe(1);
  expect(summary.statusCounts.scored).toBe(2);
  expect(summary.statusCounts.unavailable).toBe(1);
  expect(summary.passAtKRate).toBe("1/1");
  const openrouterGroup = summary.groups.find(
    (group) => group.adapterId === "openrouter",
  );
  expect(openrouterGroup?.passAtK).toBeTrue();
  expect(openrouterGroup?.passCount).toBe(1);

  const run: RunArtifact = {
    schemaVersion: 2,
    runId: "r1",
    fixtureIds: ["gmod.player-iterator.v1"],
    startedAt: "t0",
    completedAt: "t1",
    repeat: 2,
    concurrency: 1,
    attempts,
    summary,
  };

  const markdown = renderMarkdownReport(run);
  expect(markdown).toContain("pass@2");
  expect(markdown).toContain("Model leaderboard");
  expect(markdown).toContain("Fixture score");
  expect(markdown).toContain("Coverage");
  expect(markdown).toContain("openai/gpt-4o-mini");
  expect(markdown).toContain("Uses the direct cached player iterator.");
  expect(markdown).toContain("Unavailable: 1");
  expect(markdown).toContain("responses/");
});

test("export formats include leaderboard csv, usage totals, and attempts jsonl", async () => {
  const {
    aggregateUsageTotals,
    buildRunMetadata,
    renderAttemptsCsv,
    renderAttemptsJsonl,
    renderLeaderboardCsv,
  } = await import("../src/report/exports");
  const attempts: AttemptRecord[] = [
    {
      fixtureId: "gmod.a.v1",
      adapterId: "openrouter",
      model: "a/model:free",
      attemptIndex: 1,
      status: "pass",
      detail: "ok",
      finalResponse: "x",
      durationMs: 10,
      startedAt: "t0",
      completedAt: "t0b",
      answerBytes: 1,
      answerChars: 1,
      httpStatus: 200,
      httpAttempts: 1,
      usage: {
        source: "provider",
        promptTokens: 100,
        completionTokens: 20,
        reasoningTokens: 5,
        totalTokens: 125,
        cachedTokens: 10,
        cost: 0.01,
      },
      version: "openrouter-api",
    },
    {
      fixtureId: "gmod.b.v1",
      adapterId: "openrouter",
      model: "b/model:free",
      attemptIndex: 1,
      status: "incorrect",
      detail: "no",
      finalResponse: "y",
      durationMs: 20,
      answerBytes: 1,
      usage: {
        source: "estimated",
        promptTokens: 50,
        completionTokens: 10,
        totalTokens: 60,
      },
      version: "openrouter-api",
    },
  ];
  const run: RunArtifact = {
    schemaVersion: 2,
    runId: "r2",
    fixtureIds: ["gmod.a.v1", "gmod.b.v1"],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    repeat: 1,
    concurrency: 1,
    attempts,
    summary: summarizeAttempts(attempts),
  };

  const csv = renderLeaderboardCsv(run);
  expect(csv).toContain("rank,model,adapter");
  expect(csv).toContain("coverage");
  expect(csv).toContain("fixture_score");
  expect(csv).toContain("fixture_solve_rate");
  expect(csv).toContain("reasoning_tokens");
  expect(csv).toContain("a/model:free");
  // Equal coverage: pass count breaks the tie ahead of an incorrect-only model.
  expect(csv.indexOf("a/model:free")).toBeLessThan(csv.indexOf("b/model:free"));

  const attemptsCsv = renderAttemptsCsv(run);
  expect(attemptsCsv).toContain("usage_source");
  expect(attemptsCsv).toContain("provider");
  expect(attemptsCsv).toContain("estimated");
  expect(attemptsCsv).toContain("answer_bytes");

  const jsonl = renderAttemptsJsonl(run).trim().split("\n");
  expect(jsonl).toHaveLength(2);
  const first = JSON.parse(jsonl[0]!);
  expect(first.fixtureId).toBe("gmod.a.v1");
  expect(first.usage.promptTokens).toBe(100);
  expect(first.answerBytes).toBe(1);

  const totals = aggregateUsageTotals(attempts);
  expect(totals.promptTokens).toBe(150);
  expect(totals.completionTokens).toBe(30);
  expect(totals.reasoningTokens).toBe(5);
  expect(totals.cost).toBe(0.01);
  expect(totals.providerUsageAttempts).toBe(1);
  expect(totals.estimatedUsageAttempts).toBe(1);
  expect(totals.avgDurationMs).toBe(15);
  expect(totals.minDurationMs).toBe(10);
  expect(totals.maxDurationMs).toBe(20);

  const meta = buildRunMetadata(run, true);
  expect(meta.durationSeconds).toBe(60);
  expect(meta.usageTotals?.totalTokens).toBe(185);
});

test("compare renders status diffs between two models", async () => {
  const { renderModelCompare } = await import("../src/report/compare");
  const attempts: AttemptRecord[] = [
    {
      fixtureId: "gmod.a.v1",
      adapterId: "agy",
      model: "Gemini 3.1 Pro (Low)",
      attemptIndex: 1,
      status: "pass",
      detail: "ok",
      finalResponse:
        "```lua\nlocal ply = LocalPlayer()\n```\nReason: cache entity.",
      durationMs: 10,
      version: "1.1.1",
    },
    {
      fixtureId: "gmod.a.v1",
      adapterId: "agy",
      model: "Gemini 3.1 Pro (High)",
      attemptIndex: 1,
      status: "incorrect",
      detail: "wrong",
      finalResponse:
        "```lua\nlocal LocalPlayer = LocalPlayer\n```\nReason: cache function.",
      durationMs: 12,
      version: "1.1.1",
    },
  ];
  const run: RunArtifact = {
    schemaVersion: 3,
    runId: "cmp",
    fixtureIds: ["gmod.a.v1"],
    startedAt: "t0",
    completedAt: "t1",
    repeat: 1,
    concurrency: 1,
    attempts,
    summary: summarizeAttempts(attempts),
  };
  const md = renderModelCompare(run, "Pro (Low)", "Pro (High)");
  expect(md).toContain("Status diffs: **1**");
  expect(md).toContain("local ply = LocalPlayer()");
  expect(md).toContain("local LocalPlayer = LocalPlayer");
  expect(md).toContain("````");
});

test("compare rejects an ambiguous model filter", async () => {
  const { renderModelCompare } = await import("../src/report/compare");
  const attempts: AttemptRecord[] = [
    "vendor/model-small",
    "vendor/model-large",
  ].map((model) => ({
    fixtureId: "gmod.a.v1",
    adapterId: "openrouter",
    model,
    attemptIndex: 1,
    status: "pass",
    detail: "ok",
    finalResponse: "ok",
    durationMs: 1,
    version: "api",
  }));
  const run: RunArtifact = {
    schemaVersion: 3,
    runId: "ambiguous",
    fixtureIds: ["gmod.a.v1"],
    startedAt: "t0",
    completedAt: "t1",
    repeat: 1,
    concurrency: 1,
    attempts,
    summary: summarizeAttempts(attempts),
  };

  expect(() =>
    renderModelCompare(run, "vendor/model", "vendor/model-large"),
  ).toThrow("ambiguous");
});
