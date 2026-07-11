import type { AttemptStatus } from "../core/types";

export interface VerifiedAttempt {
  runId: string;
  fixtureId: string;
  adapterId: string;
  model: string;
  status: AttemptStatus;
  finalResponse: string | null;
  durationMs?: number;
}

export interface VerifiedRankingRow {
  adapterId: string;
  model: string;
  label: string;
  fixtureScore: number;
  fixtureCoverage: number;
  evidenceAttempts: number;
  scheduledAttempts: number;
  verifiedRunCount: number;
  scoreIntervalLow: number;
  scoreIntervalHigh: number;
  harnessFailures: number;
  modelFormatFailures: number;
  pass: number;
  partial: number;
  incorrect: number;
  scored: number;
  passRate: number;
  quality: number;
  fixtureSolveRate: number;
  fixturesPassed: number;
  fixturesAttempted: number;
  avgDurationMs: number;
}

function modelKey(
  attempt: Pick<VerifiedAttempt, "adapterId" | "model">,
): string {
  return `${attempt.adapterId}\0${attempt.model}`;
}

function evidenceScore(attempt: VerifiedAttempt): number | null {
  if (attempt.status === "pass") return 1;
  if (attempt.status === "partial") return 0.5;
  if (attempt.status === "incorrect") return 0;
  if (
    attempt.status === "protocol_error" &&
    attempt.finalResponse?.trim() &&
    attempt.finalResponse.trim() !== "(from log; body not captured)"
  ) {
    return 0;
  }
  return null;
}

function wilsonInterval(score: number, sampleSize: number): [number, number] {
  if (sampleSize <= 0) return [0, 0];
  const z = 1.96;
  const z2 = z * z;
  const denominator = 1 + z2 / sampleSize;
  const center = (score + z2 / (2 * sampleSize)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((score * (1 - score)) / sampleSize + z2 / (4 * sampleSize ** 2));
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

type ComparableVerifiedRow = Pick<
  VerifiedRankingRow,
  | "fixtureScore"
  | "fixtureCoverage"
  | "scoreIntervalLow"
  | "scoreIntervalHigh"
  | "verifiedRunCount"
  | "passRate"
  | "modelFormatFailures"
  | "label"
>;

export function compareVerifiedRows(
  a: ComparableVerifiedRow,
  b: ComparableVerifiedRow,
): number {
  if (b.fixtureScore !== a.fixtureScore) return b.fixtureScore - a.fixtureScore;
  if (b.fixtureCoverage !== a.fixtureCoverage)
    return b.fixtureCoverage - a.fixtureCoverage;
  const aWidth = a.scoreIntervalHigh - a.scoreIntervalLow;
  const bWidth = b.scoreIntervalHigh - b.scoreIntervalLow;
  if (aWidth !== bWidth) return aWidth - bWidth;
  if (b.verifiedRunCount !== a.verifiedRunCount)
    return b.verifiedRunCount - a.verifiedRunCount;
  if (b.passRate !== a.passRate) return b.passRate - a.passRate;
  if (a.modelFormatFailures !== b.modelFormatFailures)
    return a.modelFormatFailures - b.modelFormatFailures;
  return a.label.localeCompare(b.label);
}

export function buildVerifiedRanking(
  attempts: readonly VerifiedAttempt[],
  expectedFixturesByModel: ReadonlyMap<string, ReadonlySet<string>>,
): VerifiedRankingRow[] {
  type Accumulator = {
    adapterId: string;
    model: string;
    runs: Set<string>;
    fixtureScores: Map<string, number[]>;
    scheduledAttempts: number;
    harnessFailures: number;
    modelFormatFailures: number;
    pass: number;
    partial: number;
    incorrect: number;
    passedFixtures: Set<string>;
    durationSum: number;
  };
  const byModel = new Map<string, Accumulator>();

  for (const attempt of attempts) {
    const key = modelKey(attempt);
    const row = byModel.get(key) ?? {
      adapterId: attempt.adapterId,
      model: attempt.model,
      runs: new Set<string>(),
      fixtureScores: new Map<string, number[]>(),
      scheduledAttempts: 0,
      harnessFailures: 0,
      modelFormatFailures: 0,
      pass: 0,
      partial: 0,
      incorrect: 0,
      passedFixtures: new Set<string>(),
      durationSum: 0,
    };
    row.runs.add(attempt.runId);
    row.scheduledAttempts += 1;
    row.durationSum += attempt.durationMs ?? 0;
    const score = evidenceScore(attempt);
    if (score == null) {
      row.harnessFailures += 1;
    } else {
      const fixtureScores = row.fixtureScores.get(attempt.fixtureId) ?? [];
      fixtureScores.push(score);
      row.fixtureScores.set(attempt.fixtureId, fixtureScores);
      if (attempt.status === "pass") {
        row.pass += 1;
        row.passedFixtures.add(attempt.fixtureId);
      } else if (attempt.status === "partial") row.partial += 1;
      else if (attempt.status === "incorrect") row.incorrect += 1;
      else row.modelFormatFailures += 1;
    }
    byModel.set(key, row);
  }

  const rows: VerifiedRankingRow[] = [];
  for (const [key, row] of byModel) {
    const fixtureMeans = [...row.fixtureScores.values()].map(
      (scores) => scores.reduce((sum, score) => sum + score, 0) / scores.length,
    );
    const fixtureScore =
      fixtureMeans.length > 0
        ? fixtureMeans.reduce((sum, score) => sum + score, 0) /
          fixtureMeans.length
        : 0;
    const expectedFixtures = expectedFixturesByModel.get(key)?.size ?? 0;
    const fixtureCoverage =
      expectedFixtures > 0 ? fixtureMeans.length / expectedFixtures : 0;
    const evidenceAttempts = row.scheduledAttempts - row.harnessFailures;
    const scored = row.pass + row.partial + row.incorrect;
    const [scoreIntervalLow, scoreIntervalHigh] = wilsonInterval(
      fixtureScore,
      fixtureMeans.length,
    );
    rows.push({
      adapterId: row.adapterId,
      model: row.model,
      label: `${row.adapterId}/${row.model}`,
      fixtureScore,
      fixtureCoverage,
      evidenceAttempts,
      scheduledAttempts: row.scheduledAttempts,
      verifiedRunCount: row.runs.size,
      scoreIntervalLow,
      scoreIntervalHigh,
      harnessFailures: row.harnessFailures,
      modelFormatFailures: row.modelFormatFailures,
      pass: row.pass,
      partial: row.partial,
      incorrect: row.incorrect,
      scored,
      passRate: scored > 0 ? row.pass / scored : 0,
      quality: scored > 0 ? (row.pass + row.partial * 0.5) / scored : 0,
      fixtureSolveRate:
        fixtureMeans.length > 0
          ? row.passedFixtures.size / fixtureMeans.length
          : 0,
      fixturesPassed: row.passedFixtures.size,
      fixturesAttempted: fixtureMeans.length,
      avgDurationMs:
        row.scheduledAttempts > 0
          ? Math.round(row.durationSum / row.scheduledAttempts)
          : 0,
    });
  }

  return rows.sort(compareVerifiedRows);
}
