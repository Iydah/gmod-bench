import type {
  AttemptRecord,
  RunArtifact,
  RunMetadata,
  RunUsageTotals,
} from "../core/types";
import {
  buildModelLeaderboard,
  formatPercent,
  type ModelLeaderboardRow,
} from "./leaderboard";

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvRow(
  cells: readonly (string | number | null | undefined)[],
): string {
  return cells.map(csvEscape).join(",");
}

/** One row per model — spreadsheet-friendly ranking. */
export function renderLeaderboardCsv(run: RunArtifact): string {
  const rows = buildModelLeaderboard(run.attempts);
  const header = csvRow([
    "rank",
    "model",
    "adapter",
    "pass",
    "partial",
    "incorrect",
    "scored",
    "pass_rate",
    "quality",
    "coverage",
    "fixture_score",
    "fixture_solve_rate",
    "pass_at_k_rate",
    "protocol_error",
    "other_errors",
    "fixtures_passed",
    "fixtures_attempted",
    "attempts",
    "avg_ms",
    "min_ms",
    "max_ms",
    "total_ms",
    "prompt_tokens",
    "completion_tokens",
    "reasoning_tokens",
    "total_tokens",
    "cached_tokens",
    "cost",
    "answer_bytes",
  ]);
  const body = rows.map((row) =>
    csvRow([
      row.rank,
      row.model ?? "",
      row.adapterId,
      row.pass,
      row.partial,
      row.incorrect,
      row.scored,
      row.passRate.toFixed(4),
      row.quality.toFixed(4),
      row.coverage.toFixed(4),
      row.fixtureScore.toFixed(4),
      row.fixtureSolveRate.toFixed(4),
      row.passAtKRate.toFixed(4),
      row.protocol_error,
      row.otherErrors,
      row.fixturesPassed,
      row.fixturesAttempted,
      row.attempts,
      row.avgDurationMs,
      row.minDurationMs,
      row.maxDurationMs,
      row.totalDurationMs,
      row.totalPromptTokens,
      row.totalCompletionTokens,
      row.totalReasoningTokens,
      row.totalTokens,
      row.totalCachedTokens,
      row.totalCost,
      row.totalAnswerBytes,
    ]),
  );
  return [header, ...body, ""].join("\n");
}

/** One row per attempt — for pivot tables / filtering. */
export function renderAttemptsCsv(run: RunArtifact): string {
  const header = csvRow([
    "fixture",
    "fixture_version",
    "rubric_version",
    "prompt_hash",
    "adapter",
    "model",
    "attempt",
    "status",
    "duration_ms",
    "started_at",
    "completed_at",
    "prompt_tokens",
    "completion_tokens",
    "reasoning_tokens",
    "total_tokens",
    "cached_tokens",
    "cache_write_tokens",
    "cost",
    "upstream_cost",
    "usage_source",
    "finish_reason",
    "provider_model",
    "generation_id",
    "answer_bytes",
    "answer_chars",
    "http_status",
    "http_attempts",
    "exit_code",
    "detail",
  ]);
  const body = run.attempts.map((attempt) =>
    csvRow([
      attempt.fixtureId,
      attempt.fixtureVersion ?? "",
      attempt.rubricVersion ?? "",
      attempt.promptHash ?? "",
      attempt.adapterId,
      attempt.model ?? "",
      attempt.attemptIndex,
      attempt.status,
      attempt.durationMs,
      attempt.startedAt ?? "",
      attempt.completedAt ?? "",
      attempt.usage?.promptTokens ?? "",
      attempt.usage?.completionTokens ?? "",
      attempt.usage?.reasoningTokens ?? "",
      attempt.usage?.totalTokens ?? "",
      attempt.usage?.cachedTokens ?? "",
      attempt.usage?.cacheWriteTokens ?? "",
      attempt.usage?.cost ?? "",
      attempt.usage?.upstreamInferenceCost ?? "",
      attempt.usage?.source ?? "",
      attempt.usage?.finishReason ?? "",
      attempt.usage?.providerModel ?? "",
      attempt.usage?.generationId ?? "",
      attempt.answerBytes ?? "",
      attempt.answerChars ?? "",
      attempt.httpStatus ?? "",
      attempt.httpAttempts ?? "",
      attempt.exitCode ?? "",
      attempt.detail,
    ]),
  );
  return [header, ...body, ""].join("\n");
}

/** Streaming-friendly: one JSON object per attempt (includes answer body). */
export function renderAttemptsJsonl(run: RunArtifact): string {
  return (
    run.attempts
      .map((attempt) =>
        JSON.stringify({
          runId: run.runId,
          instance_id: attempt.fixtureId,
          fixtureId: attempt.fixtureId,
          fixtureVersion: attempt.fixtureVersion ?? null,
          rubricVersion: attempt.rubricVersion ?? null,
          promptHash: attempt.promptHash ?? null,
          adapterId: attempt.adapterId,
          model: attempt.model,
          model_name_or_path: attempt.model ?? attempt.adapterId,
          attemptIndex: attempt.attemptIndex,
          status: attempt.status,
          detail: attempt.detail,
          durationMs: attempt.durationMs,
          startedAt: attempt.startedAt ?? null,
          completedAt: attempt.completedAt ?? null,
          answerBytes: attempt.answerBytes ?? null,
          answerChars: attempt.answerChars ?? null,
          httpStatus: attempt.httpStatus ?? null,
          httpAttempts: attempt.httpAttempts ?? null,
          exitCode: attempt.exitCode ?? null,
          usage: attempt.usage ?? null,
          finalResponse: attempt.finalResponse,
          /** SWE-style field name for the model answer body */
          model_patch: attempt.finalResponse,
        }),
      )
      .join("\n") + (run.attempts.length > 0 ? "\n" : "")
  );
}

/** SWE-bench-style predictions file (one line per attempt). */
export function renderPredsJsonl(run: RunArtifact): string {
  return (
    run.attempts
      .map((attempt) =>
        JSON.stringify({
          instance_id: attempt.fixtureId,
          model_name_or_path: attempt.model
            ? `${attempt.adapterId}/${attempt.model}`
            : attempt.adapterId,
          attempt_index: attempt.attemptIndex,
          status: attempt.status,
          detail: attempt.detail,
          model_patch: attempt.finalResponse ?? "",
          duration_ms: attempt.durationMs,
          started_at: attempt.startedAt ?? null,
          completed_at: attempt.completedAt ?? null,
          answer_bytes: attempt.answerBytes ?? null,
          prompt_tokens: attempt.usage?.promptTokens ?? null,
          completion_tokens: attempt.usage?.completionTokens ?? null,
          reasoning_tokens: attempt.usage?.reasoningTokens ?? null,
          total_tokens: attempt.usage?.totalTokens ?? null,
          cached_tokens: attempt.usage?.cachedTokens ?? null,
          cost: attempt.usage?.cost ?? null,
          usage_source: attempt.usage?.source ?? null,
          finish_reason: attempt.usage?.finishReason ?? null,
          generation_id: attempt.usage?.generationId ?? null,
          http_status: attempt.httpStatus ?? null,
          http_attempts: attempt.httpAttempts ?? null,
          exit_code: attempt.exitCode ?? null,
          prompt_hash: attempt.promptHash ?? null,
          fixture_version: attempt.fixtureVersion ?? null,
          rubric_version: attempt.rubricVersion ?? null,
        }),
      )
      .join("\n") + (run.attempts.length > 0 ? "\n" : "")
  );
}

export function renderLeaderboardJson(run: RunArtifact): string {
  const rows: ModelLeaderboardRow[] = buildModelLeaderboard(run.attempts);
  return JSON.stringify(
    {
      runId: run.runId,
      generatedAt: run.completedAt,
      models: rows.map((row) => ({
        ...row,
        passRateLabel: formatPercent(row.passRate),
        qualityLabel: row.quality.toFixed(3),
        coverageLabel: formatPercent(row.coverage),
        fixtureScoreLabel: formatPercent(row.fixtureScore),
        fixtureSolveRateLabel: formatPercent(row.fixtureSolveRate),
        passAtKLabel: formatPercent(row.passAtKRate),
      })),
    },
    null,
    2,
  );
}

export function aggregateUsageTotals(
  attempts: readonly AttemptRecord[],
): RunUsageTotals {
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  let totalTokens = 0;
  let cachedTokens = 0;
  let cacheWriteTokens = 0;
  let cost = 0;
  let upstreamInferenceCost = 0;
  let attemptsWithUsage = 0;
  let providerUsageAttempts = 0;
  let estimatedUsageAttempts = 0;
  let totalDurationMs = 0;
  let minDurationMs = Number.POSITIVE_INFINITY;
  let maxDurationMs = 0;
  let totalAnswerBytes = 0;

  for (const attempt of attempts) {
    totalDurationMs += attempt.durationMs;
    minDurationMs = Math.min(minDurationMs, attempt.durationMs);
    maxDurationMs = Math.max(maxDurationMs, attempt.durationMs);
    totalAnswerBytes += attempt.answerBytes ?? 0;

    const usage = attempt.usage;
    if (!usage) continue;

    const hasCounts =
      usage.promptTokens !== undefined ||
      usage.completionTokens !== undefined ||
      usage.totalTokens !== undefined;
    if (hasCounts) {
      attemptsWithUsage += 1;
      if (usage.source === "estimated") {
        estimatedUsageAttempts += 1;
      } else {
        providerUsageAttempts += 1;
      }
    }

    promptTokens += usage.promptTokens ?? 0;
    completionTokens += usage.completionTokens ?? 0;
    reasoningTokens += usage.reasoningTokens ?? 0;
    totalTokens +=
      usage.totalTokens ??
      (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
    cachedTokens += usage.cachedTokens ?? 0;
    cacheWriteTokens += usage.cacheWriteTokens ?? 0;
    cost += usage.cost ?? 0;
    upstreamInferenceCost += usage.upstreamInferenceCost ?? 0;
  }

  const n = attempts.length;
  return {
    promptTokens,
    completionTokens,
    reasoningTokens,
    totalTokens,
    cachedTokens,
    cacheWriteTokens,
    cost,
    upstreamInferenceCost,
    attemptsWithUsage,
    providerUsageAttempts,
    estimatedUsageAttempts,
    avgDurationMs: n > 0 ? Math.round(totalDurationMs / n) : 0,
    minDurationMs: n > 0 && Number.isFinite(minDurationMs) ? minDurationMs : 0,
    maxDurationMs,
    totalDurationMs,
    totalAnswerBytes,
  };
}

export function buildRunMetadata(
  run: RunArtifact,
  keepRaw: boolean,
): RunMetadata {
  const models = [
    ...new Set(
      run.attempts.map((a) =>
        a.model ? `${a.adapterId}/${a.model}` : a.adapterId,
      ),
    ),
  ].sort();
  const adapters = [...new Set(run.attempts.map((a) => a.adapterId))].sort();
  const started = Date.parse(run.startedAt);
  const completed = Date.parse(run.completedAt);
  const durationSeconds =
    Number.isFinite(started) && Number.isFinite(completed)
      ? Math.max(0, Math.round((completed - started) / 1000))
      : 0;

  return {
    schemaVersion: 3,
    runId: run.runId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    repeat: run.repeat,
    concurrency: run.concurrency,
    fixtureIds: run.fixtureIds,
    fixtureCount: run.fixtureIds.length,
    attemptCount: run.attempts.length,
    adapters,
    models,
    keepRaw,
    durationSeconds,
    usageTotals: aggregateUsageTotals(run.attempts),
    ...(run.execution ? { execution: run.execution } : {}),
  };
}
