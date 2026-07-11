import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type {
  AttemptRecord,
  AttemptStatus,
  RunArtifact,
} from "../src/core/types";
import { buildModelLeaderboard } from "../src/report/leaderboard";

const KNOWN_STATUSES = new Set<AttemptStatus>([
  "pass",
  "partial",
  "incorrect",
  "protocol_error",
  "policy_violation",
  "timeout",
  "unavailable",
  "unsupported",
  "trace_error",
]);

type RawPublishedRow = {
  rank?: number;
  adapterId: string;
  model: string | null;
  attempts: number;
  scored: number;
  pass: number;
  partial: number;
  incorrect: number;
  protocol_error: number;
  otherErrors?: number;
  passRate: number;
  quality: number;
  coverage?: number;
};

const root = join(import.meta.dir, "..", ".gmod-bench", "runs");
const runNames = (await readdir(root))
  .filter((name) => !name.startsWith(".") && !/checkpoint/i.test(name))
  .sort();

let runCount = 0;
let attemptCount = 0;
let modelCount = 0;
let invalidStatusCount = 0;
let fixtureMismatchCount = 0;
let duplicateAttemptCount = 0;
let metricMismatchCount = 0;
const candidates: Array<{
  runId: string;
  model: string;
  oldRank: number | null;
  newRank: number;
  rankDelta: number | null;
  fixtureScore: number;
  reasons: string[];
}> = [];

function identity(adapterId: string, model: string | null): string {
  return `${adapterId}\u0000${model ?? ""}`;
}

function approxEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.000_15;
}

for (const name of runNames) {
  const directory = join(root, name);
  const runFile = Bun.file(join(directory, "run.json"));
  const boardFile = Bun.file(join(directory, "leaderboard.json"));
  if (!(await runFile.exists()) || !(await boardFile.exists())) continue;

  const run = (await runFile.json()) as RunArtifact;
  const published = (await boardFile.json()) as { models?: RawPublishedRow[] };
  if (!Array.isArray(run.attempts) || !Array.isArray(published.models))
    continue;

  runCount += 1;
  attemptCount += run.attempts.length;
  const fixtureIds = new Set(run.fixtureIds);
  const attemptIdentities = new Set<string>();
  for (const attempt of run.attempts as AttemptRecord[]) {
    if (!KNOWN_STATUSES.has(attempt.status)) invalidStatusCount += 1;
    if (!fixtureIds.has(attempt.fixtureId)) fixtureMismatchCount += 1;
    const key = `${attempt.fixtureId}\u0000${identity(attempt.adapterId, attempt.model)}\u0000${attempt.attemptIndex}`;
    if (attemptIdentities.has(key)) duplicateAttemptCount += 1;
    attemptIdentities.add(key);
  }

  const recomputed = buildModelLeaderboard(run.attempts);
  modelCount += recomputed.length;
  const oldByModel = new Map(
    published.models.map((row) => [identity(row.adapterId, row.model), row]),
  );

  for (const row of recomputed) {
    const old = oldByModel.get(identity(row.adapterId, row.model));
    if (!old) {
      metricMismatchCount += 1;
      continue;
    }
    const expectedOther =
      old.attempts -
      old.pass -
      old.partial -
      old.incorrect -
      old.protocol_error;
    const metricsAgree =
      old.attempts === row.attempts &&
      old.scored === row.scored &&
      old.pass === row.pass &&
      old.partial === row.partial &&
      old.incorrect === row.incorrect &&
      old.protocol_error === row.protocol_error &&
      (old.otherErrors ?? expectedOther) === row.otherErrors &&
      approxEqual(old.passRate, row.passRate) &&
      approxEqual(old.quality, row.quality) &&
      approxEqual(old.coverage ?? old.scored / old.attempts, row.coverage);
    if (!metricsAgree) metricMismatchCount += 1;

    const reasons: string[] = [];
    const rankDelta = old.rank == null ? null : old.rank - row.rank;
    if (rankDelta != null && Math.abs(rankDelta) >= 5) {
      reasons.push(`rank changed by ${rankDelta > 0 ? "+" : ""}${rankDelta}`);
    }
    if (row.partial > 0) reasons.push(`${row.partial} partial outcomes`);
    if (row.protocol_error / row.attempts >= 0.2) {
      reasons.push(`${row.protocol_error}/${row.attempts} protocol errors`);
    }
    if (row.otherErrors / row.attempts >= 0.2) {
      reasons.push(`${row.otherErrors}/${row.attempts} other failures`);
    }
    if (reasons.length > 0) {
      candidates.push({
        runId: run.runId,
        model: row.label,
        oldRank: old.rank ?? null,
        newRank: row.rank,
        rankDelta,
        fixtureScore: Number(row.fixtureScore.toFixed(4)),
        reasons,
      });
    }
  }
}

candidates.sort(
  (a, b) =>
    Math.abs(b.rankDelta ?? 0) - Math.abs(a.rankDelta ?? 0) ||
    a.runId.localeCompare(b.runId) ||
    a.newRank - b.newRank,
);

console.log(
  JSON.stringify(
    {
      summary: {
        runCount,
        attemptCount,
        modelCount,
        invalidStatusCount,
        fixtureMismatchCount,
        duplicateAttemptCount,
        metricMismatchCount,
        reviewCandidateCount: candidates.length,
      },
      candidates,
    },
    null,
    2,
  ),
);

if (
  invalidStatusCount > 0 ||
  fixtureMismatchCount > 0 ||
  duplicateAttemptCount > 0 ||
  metricMismatchCount > 0
) {
  process.exitCode = 1;
}
