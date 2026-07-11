import { formatModelLabel } from "../core/summary";
import type { AttemptRecord, AttemptStatus, RunArtifact } from "../core/types";
import { SCORED_STATUSES } from "../core/types";

export interface ModelLeaderboardRow {
  rank: number;
  adapterId: string;
  model: string | null;
  label: string;
  attempts: number;
  scored: number;
  pass: number;
  partial: number;
  incorrect: number;
  protocol_error: number;
  otherErrors: number;
  /** pass / scored, or 0 when unscored */
  passRate: number;
  /** Weighted quality: pass=1, partial=0.5, incorrect=0 (over scored only) */
  quality: number;
  /** Scorable attempts / total attempts. */
  coverage: number;
  /** Mean per-fixture score, including unscorable attempts as zero. */
  fixtureScore: number;
  /** Attempted fixtures with at least one pass / all attempted fixtures. */
  fixtureSolveRate: number;
  /** Groups (fixture×model) with pass@k / groups with any scored attempt */
  passAtKRate: number;
  fixturesPassed: number;
  fixturesAttempted: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  totalDurationMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalReasoningTokens: number;
  totalTokens: number;
  totalCachedTokens: number;
  totalCost: number;
  totalAnswerBytes: number;
}

function modelKey(attempt: AttemptRecord): string {
  return `${attempt.adapterId}\u0000${attempt.model ?? ""}`;
}

function groupKey(attempt: AttemptRecord): string {
  return `${attempt.fixtureId}\u0000${attempt.adapterId}\u0000${attempt.model ?? ""}`;
}

function isScored(status: AttemptStatus): boolean {
  return (SCORED_STATUSES as readonly string[]).includes(status);
}

/**
 * Aggregate attempts by (adapter, model) for a readable leaderboard.
 * Rank: fixture-normalized score, solve rate, coverage, pass rate, then fewer protocol errors.
 */
export function buildModelLeaderboard(
  attempts: readonly AttemptRecord[],
): ModelLeaderboardRow[] {
  type Acc = {
    adapterId: string;
    model: string | null;
    attempts: number;
    scored: number;
    pass: number;
    partial: number;
    incorrect: number;
    protocol_error: number;
    otherErrors: number;
    durationSum: number;
    minDurationMs: number;
    maxDurationMs: number;
    fixtures: Set<string>;
    fixturesPassed: Set<string>;
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    cachedTokens: number;
    cost: number;
    answerBytes: number;
    /** fixture → normalized attempt evidence */
    groups: Map<
      string,
      { attempts: number; scoreSum: number; passAtK: boolean; scored: boolean }
    >;
  };

  const map = new Map<string, Acc>();

  for (const attempt of attempts) {
    const key = modelKey(attempt);
    let row = map.get(key);
    if (!row) {
      row = {
        adapterId: attempt.adapterId,
        model: attempt.model,
        attempts: 0,
        scored: 0,
        pass: 0,
        partial: 0,
        incorrect: 0,
        protocol_error: 0,
        otherErrors: 0,
        durationSum: 0,
        minDurationMs: Number.POSITIVE_INFINITY,
        maxDurationMs: 0,
        fixtures: new Set(),
        fixturesPassed: new Set(),
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        cost: 0,
        answerBytes: 0,
        groups: new Map(),
      };
      map.set(key, row);
    }

    row.attempts += 1;
    row.durationSum += attempt.durationMs;
    row.minDurationMs = Math.min(row.minDurationMs, attempt.durationMs);
    row.maxDurationMs = Math.max(row.maxDurationMs, attempt.durationMs);
    row.fixtures.add(attempt.fixtureId);
    row.promptTokens += attempt.usage?.promptTokens ?? 0;
    row.completionTokens += attempt.usage?.completionTokens ?? 0;
    row.reasoningTokens += attempt.usage?.reasoningTokens ?? 0;
    row.totalTokens +=
      attempt.usage?.totalTokens ??
      (attempt.usage?.promptTokens ?? 0) +
        (attempt.usage?.completionTokens ?? 0);
    row.cachedTokens += attempt.usage?.cachedTokens ?? 0;
    row.cost += attempt.usage?.cost ?? 0;
    row.answerBytes += attempt.answerBytes ?? 0;

    const gk = groupKey(attempt);
    const g = row.groups.get(gk) ?? {
      attempts: 0,
      scoreSum: 0,
      passAtK: false,
      scored: false,
    };
    g.attempts += 1;
    if (isScored(attempt.status)) {
      g.scored = true;
      row.scored += 1;
      if (attempt.status === "pass") {
        g.scoreSum += 1;
        row.pass += 1;
        row.fixturesPassed.add(attempt.fixtureId);
        g.passAtK = true;
      } else if (attempt.status === "partial") {
        g.scoreSum += 0.5;
        row.partial += 1;
      } else {
        row.incorrect += 1;
      }
    } else if (attempt.status === "protocol_error") {
      row.protocol_error += 1;
    } else {
      row.otherErrors += 1;
    }
    row.groups.set(gk, g);
  }

  const rows: Omit<ModelLeaderboardRow, "rank">[] = [...map.values()].map(
    (row) => {
      const passRate = row.scored > 0 ? row.pass / row.scored : 0;
      const quality =
        row.scored > 0 ? (row.pass + row.partial * 0.5) / row.scored : 0;
      const fixturesAttempted = row.fixtures.size;
      const coverage = row.attempts > 0 ? row.scored / row.attempts : 0;
      const fixtureGroups = [...row.groups.values()];
      const fixtureScore =
        fixtureGroups.length > 0
          ? fixtureGroups.reduce(
              (sum, group) => sum + group.scoreSum / group.attempts,
              0,
            ) / fixtureGroups.length
          : 0;
      const fixtureSolveRate =
        fixtureGroups.length > 0
          ? fixtureGroups.filter((group) => group.passAtK).length /
            fixtureGroups.length
          : 0;
      const scoredGroups = [...row.groups.values()].filter((g) => g.scored);
      const passAtKRate =
        scoredGroups.length > 0
          ? scoredGroups.filter((g) => g.passAtK).length / scoredGroups.length
          : 0;
      return {
        adapterId: row.adapterId,
        model: row.model,
        label: formatModelLabel(row.adapterId as never, row.model),
        attempts: row.attempts,
        scored: row.scored,
        pass: row.pass,
        partial: row.partial,
        incorrect: row.incorrect,
        protocol_error: row.protocol_error,
        otherErrors: row.otherErrors,
        passRate,
        quality,
        coverage,
        fixtureScore,
        fixtureSolveRate,
        passAtKRate,
        fixturesPassed: row.fixturesPassed.size,
        fixturesAttempted,
        avgDurationMs:
          row.attempts > 0 ? Math.round(row.durationSum / row.attempts) : 0,
        minDurationMs:
          row.attempts > 0 && Number.isFinite(row.minDurationMs)
            ? row.minDurationMs
            : 0,
        maxDurationMs: row.maxDurationMs,
        totalDurationMs: row.durationSum,
        totalPromptTokens: row.promptTokens,
        totalCompletionTokens: row.completionTokens,
        totalReasoningTokens: row.reasoningTokens,
        totalTokens: row.totalTokens,
        totalCachedTokens: row.cachedTokens,
        totalCost: row.cost,
        totalAnswerBytes: row.answerBytes,
      };
    },
  );

  rows.sort(compareModelLeaderboardRows);

  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function compareModelLeaderboardRows(
  a: Omit<ModelLeaderboardRow, "rank">,
  b: Omit<ModelLeaderboardRow, "rank">,
): number {
  if (b.fixtureScore !== a.fixtureScore) return b.fixtureScore - a.fixtureScore;
  if (b.fixtureSolveRate !== a.fixtureSolveRate)
    return b.fixtureSolveRate - a.fixtureSolveRate;
  if (b.coverage !== a.coverage) return b.coverage - a.coverage;
  if (b.passRate !== a.passRate) return b.passRate - a.passRate;
  if (a.protocol_error !== b.protocol_error)
    return a.protocol_error - b.protocol_error;
  return a.label.localeCompare(b.label);
}

export function leaderboardFromRun(run: RunArtifact): ModelLeaderboardRow[] {
  return buildModelLeaderboard(run.attempts);
}

export function formatPercent(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}
