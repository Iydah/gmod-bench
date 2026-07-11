/**
 * Cumulative website leaderboard publisher.
 * Scans every finished run under artifactRoot and rebuilds website/src/data/leaderboard.json.
 * Rows are keyed by (runId, adapterId, model) — never drop older suites when a new run lands.
 */

import { mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import { format as formatWithPrettier } from "prettier";
import type { AttemptRecord, RunArtifact } from "../core/types";
import { loadFixtures } from "../fixtures/load";
import { scoreFixtureAnswer } from "../scoring";
import { buildModelLeaderboard } from "./leaderboard";
import {
  buildVerifiedRanking,
  compareVerifiedRows,
  type VerifiedAttempt,
} from "./verified-ranking";

export interface PublishLeaderboardOptions {
  /** Root that contains per-run dirs (e.g. .gmod-bench/runs). */
  artifactRoot: string;
  /** Path to website leaderboard.json output. */
  websiteLeaderboardPath: string;
  websiteRunsIndexPath?: string;
  websitePublicRoot?: string;
  storagePublicBaseUrl?: string;
  /** Regrade captured answers with current fixture rubrics for the derived website board. */
  fixturesRoot?: string;
  /** Include *checkpoint* run dirs (default false). */
  includeCheckpoints?: boolean;
  /** Drop rows with scored < N (default 0 keeps all attempted models). */
  minScored?: number;
  log?: (message: string) => void;
}

interface RawModel {
  adapterId: string;
  model: string | null;
  label?: string;
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
  fixtureScore?: number;
  fixtureSolveRate?: number;
  passAtKRate?: number | null;
  fixturesPassed?: number;
  fixturesAttempted?: number;
  avgDurationMs: number;
  passRateLabel?: string;
  qualityLabel?: string;
  coverageLabel?: string;
  fixtureScoreLabel?: string;
  fixtureSolveRateLabel?: string;
  passAtKLabel?: string;
  repeat?: number;
}

export interface PublishedRunSummary {
  runId: string;
  models: number;
  adapters: string[];
  completedAt?: string;
  startedAt?: string;
  fixtureIds: string[];
  fixtureCount: number;
  attemptCount: number;
  modelIds: string[];
  repeat: number;
  r2ManifestUrl?: string;
}

export interface PublishedModelRow {
  rank: number | null;
  rankingStatus?: "insufficient-coverage";
  adapterId: string;
  model: string;
  label: string;
  suite: string;
  runId: string;
  attempts: number;
  scored: number;
  pass: number;
  partial: number;
  incorrect: number;
  protocol_error: number;
  otherErrors: number;
  passRate: number;
  quality: number;
  coverage: number;
  fixtureScore: number;
  fixtureSolveRate: number;
  passAtKRate: number | null;
  fixturesPassed?: number;
  fixturesAttempted?: number;
  avgDurationMs: number;
  passRateLabel: string;
  qualityLabel: string;
  coverageLabel: string;
  fixtureScoreLabel: string;
  fixtureSolveRateLabel: string;
  passAtKLabel: string;
  repeat: number;
  cohortId: string;
  fixtureSetId: string;
  fixtureCount: number;
  completedAt?: string;
  evidenceAttempts: number;
  scheduledAttempts: number;
  verifiedRunCount: number;
  scoreIntervalLow: number;
  scoreIntervalHigh: number;
  harnessFailures: number;
  modelFormatFailures: number;
  fixtureCoverage: number;
}

function pct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

async function formattedJson(value: unknown): Promise<string> {
  return formatWithPrettier(JSON.stringify(value), { parser: "json" });
}

function normalizeCoverage(m: RawModel): number {
  if (typeof m.coverage === "number" && Number.isFinite(m.coverage))
    return m.coverage;
  if (m.attempts > 0) return m.scored / m.attempts;
  return 0;
}

function suiteFor(
  adapterId: string,
  modelCount: number,
  repeat: number,
): string {
  if (adapterId === "codex") return "codex-cli";
  if (adapterId === "opencode") return "opencode-zen";
  if (adapterId === "openrouter") return "openrouter";
  if (adapterId === "agy") return repeat > 1 ? "agy-repeat" : "agy";
  return modelCount === 1 ? `${adapterId}-single` : adapterId;
}

function rowKey(runId: string, adapterId: string, model: string): string {
  return `${runId}\u0000${adapterId}\u0000${model}`;
}

function rankModels(models: PublishedModelRow[]): PublishedModelRow[] {
  const sorted = [...models].sort(compareVerifiedRows);
  return sorted.map((m, i) => ({ ...m, rank: i + 1 }));
}

function fixtureSetId(fixtureIds: readonly string[]): string {
  return createHash("sha256")
    .update([...new Set(fixtureIds)].sort().join("\n"))
    .digest("hex")
    .slice(0, 16);
}

function modelIdentity(row: PublishedModelRow): string {
  return `${row.adapterId}\u0000${row.model}`;
}

async function loadRun(
  runsRoot: string,
  runId: string,
  minScored: number,
  fixturesRoot?: string,
): Promise<{
  rows: PublishedModelRow[];
  summary?: PublishedRunSummary;
  artifact?: RunArtifact;
  rankingAttempts?: AttemptRecord[];
}> {
  const dir = join(runsRoot, runId);
  const lbFile = Bun.file(join(dir, "leaderboard.json"));
  if (!(await lbFile.exists())) return { rows: [] };

  const lb = (await lbFile.json()) as { models?: RawModel[] };
  const models = lb.models ?? [];
  if (models.length === 0) return { rows: [] };

  let repeat = 1;
  let completedAt: string | undefined;
  const metaFile = Bun.file(join(dir, "metadata.json"));
  if (await metaFile.exists()) {
    const meta = (await metaFile.json()) as {
      repeat?: number;
      completedAt?: string;
    };
    if (typeof meta.repeat === "number") repeat = meta.repeat;
    if (typeof meta.completedAt === "string") completedAt = meta.completedAt;
  }

  // Older / partial exports may lack metadata.json — fall back to run.json.
  const runFile = Bun.file(join(dir, "run.json"));
  let artifact: RunArtifact | undefined;
  if (await runFile.exists()) {
    try {
      artifact = (await runFile.json()) as RunArtifact;
      if (!completedAt && typeof artifact.completedAt === "string") {
        completedAt = artifact.completedAt;
      }
      if (
        repeat === 1 &&
        typeof artifact.repeat === "number" &&
        artifact.repeat > 0
      ) {
        repeat = artifact.repeat;
      }
    } catch {
      artifact = undefined;
    }
  }

  const adapterIds = [
    ...new Set(models.map((model) => model.adapterId)),
  ].sort();
  const suite =
    adapterIds.length > 1
      ? `mixed:${adapterIds.join("+")}`
      : suiteFor(adapterIds[0] ?? "unknown", models.length, repeat);
  const fixtureIds = artifact?.fixtureIds ?? [];
  const setId = fixtureSetId(fixtureIds);
  const cohortId = `${setId}:r${repeat}`;
  let rankingAttempts = artifact?.attempts ?? [];
  if (artifact && fixturesRoot) {
    const fixtures = await loadFixtures(fixturesRoot, artifact.fixtureIds);
    const fixturesById = new Map(
      fixtures.map((fixture) => [fixture.id, fixture]),
    );
    rankingAttempts = artifact.attempts.map((attempt) => {
      const fixture = fixturesById.get(attempt.fixtureId);
      if (
        !fixture ||
        !attempt.finalResponse ||
        attempt.finalResponse.startsWith("(from log; body not captured)")
      ) {
        return attempt;
      }
      const result = scoreFixtureAnswer(fixture, attempt.finalResponse);
      return { ...attempt, status: result.status, detail: result.detail };
    });
  }
  const recomputedByModel = new Map(
    artifact
      ? buildModelLeaderboard(rankingAttempts).map((row) => [
          `${row.adapterId}\u0000${row.model ?? "default"}`,
          row,
        ])
      : [],
  );
  const rows: PublishedModelRow[] = [];

  for (const m of models) {
    const model = m.model ?? "default";
    const recomputed = recomputedByModel.get(`${m.adapterId}\u0000${model}`);
    const attempts = recomputed?.attempts ?? m.attempts;
    const scored = recomputed?.scored ?? m.scored;
    const pass = recomputed?.pass ?? m.pass;
    const partial = recomputed?.partial ?? m.partial;
    const incorrect = recomputed?.incorrect ?? m.incorrect;
    const protocolError = recomputed?.protocol_error ?? m.protocol_error;
    const otherErrors = recomputed?.otherErrors ?? m.otherErrors ?? 0;
    if (scored < minScored) continue;
    if (attempts <= 0) continue;

    const coverage = recomputed?.coverage ?? normalizeCoverage(m);
    const passRate =
      recomputed?.passRate ??
      (Number.isFinite(m.passRate)
        ? m.passRate
        : scored > 0
          ? pass / scored
          : 0);
    const quality =
      recomputed?.quality ?? (Number.isFinite(m.quality) ? m.quality : 0);
    const fixtureScore = recomputed?.fixtureScore ?? m.fixtureScore ?? 0;
    const fixtureSolveRate =
      recomputed?.fixtureSolveRate ?? m.fixtureSolveRate ?? 0;

    rows.push({
      rank: 0,
      adapterId: m.adapterId,
      model,
      label: m.label ?? `${m.adapterId}/${model}`,
      suite,
      runId,
      attempts,
      scored,
      pass,
      partial,
      incorrect,
      protocol_error: protocolError,
      otherErrors,
      passRate: round4(passRate),
      quality: round4(quality),
      coverage: round4(coverage),
      fixtureScore: round4(fixtureScore),
      fixtureSolveRate: round4(fixtureSolveRate),
      passAtKRate:
        repeat <= 1 ||
        (recomputed?.passAtKRate == null && m.passAtKRate == null) ||
        !Number.isFinite(recomputed?.passAtKRate ?? m.passAtKRate)
          ? null
          : round4(recomputed?.passAtKRate ?? m.passAtKRate!),
      ...(recomputed?.fixturesPassed !== undefined ||
      m.fixturesPassed !== undefined
        ? { fixturesPassed: recomputed?.fixturesPassed ?? m.fixturesPassed }
        : {}),
      ...(recomputed?.fixturesAttempted !== undefined ||
      m.fixturesAttempted !== undefined
        ? {
            fixturesAttempted:
              recomputed?.fixturesAttempted ?? m.fixturesAttempted,
          }
        : {}),
      avgDurationMs: recomputed?.avgDurationMs ?? m.avgDurationMs ?? 0,
      passRateLabel: recomputed
        ? pct(passRate)
        : (m.passRateLabel ?? pct(passRate)),
      qualityLabel: recomputed
        ? quality.toFixed(3)
        : (m.qualityLabel ?? quality.toFixed(3)),
      coverageLabel: recomputed
        ? pct(coverage)
        : (m.coverageLabel ?? pct(coverage)),
      fixtureScoreLabel: recomputed
        ? pct(fixtureScore)
        : (m.fixtureScoreLabel ?? pct(fixtureScore)),
      fixtureSolveRateLabel: recomputed
        ? pct(fixtureSolveRate)
        : (m.fixtureSolveRateLabel ?? pct(fixtureSolveRate)),
      passAtKLabel:
        repeat <= 1
          ? "—"
          : recomputed
            ? pct(recomputed.passAtKRate)
            : (m.passAtKLabel ??
              (m.passAtKRate == null ? "—" : pct(m.passAtKRate))),
      repeat,
      cohortId,
      fixtureSetId: setId,
      fixtureCount: fixtureIds.length,
      evidenceAttempts: scored,
      scheduledAttempts: attempts,
      verifiedRunCount: 1,
      scoreIntervalLow: fixtureScore,
      scoreIntervalHigh: fixtureScore,
      harnessFailures: Math.max(0, attempts - scored - protocolError),
      modelFormatFailures: protocolError,
      fixtureCoverage: coverage,
      ...(completedAt ? { completedAt } : {}),
    });
  }

  if (
    !artifact ||
    !completedAt ||
    !Array.isArray(artifact.fixtureIds) ||
    !Array.isArray(artifact.attempts)
  ) {
    return { rows };
  }
  return {
    rows,
    artifact,
    rankingAttempts,
    summary: {
      runId,
      models: rows.length,
      adapters: [...new Set(rows.map((row) => row.adapterId))].sort(),
      completedAt,
      ...(typeof artifact.startedAt === "string"
        ? { startedAt: artifact.startedAt }
        : {}),
      fixtureIds: [...new Set(artifact.fixtureIds)].sort(),
      fixtureCount: new Set(artifact.fixtureIds).size,
      attemptCount: artifact.attempts.length,
      modelIds: [...new Set(rows.map((row) => row.model))].sort(),
      repeat,
    },
  };
}

function safeRunId(runId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(runId))
    throw new Error(`Invalid run id: ${runId}`);
  return runId;
}

function contained(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root);
  const path = resolve(resolvedRoot, ...segments);
  if (!path.startsWith(`${resolvedRoot}${sep}`))
    throw new Error(`Public archive path escapes root: ${path}`);
  return path;
}

function sanitizedArtifact(run: RunArtifact): RunArtifact {
  return {
    ...run,
    attempts: run.attempts.map(
      ({ rawOutput: _rawOutput, ...attempt }) => attempt,
    ),
  };
}

async function publishRunArchive(
  artifactRoot: string,
  publicRoot: string,
  summary: PublishedRunSummary,
  artifact: RunArtifact,
): Promise<void> {
  const runId = safeRunId(summary.runId);
  const sourceDir = contained(artifactRoot, runId);
  const targetDir = contained(publicRoot, "runs", runId);
  await mkdir(targetDir, { recursive: true });
  await Bun.write(
    contained(targetDir, "run.json"),
    `${JSON.stringify(sanitizedArtifact(artifact), null, 2)}\n`,
  );
  for (const name of [
    "report.md",
    "leaderboard.json",
    "attempts.jsonl",
    "attempts.csv",
  ] as const) {
    const source = Bun.file(contained(sourceDir, name));
    if (await source.exists())
      await Bun.write(contained(targetDir, name), await source.arrayBuffer());
  }
}

/**
 * Rebuild the website leaderboard from every finished run on disk.
 * Safe to call after every bench run — additive across the corpus.
 */
export async function publishCumulativeWebsiteLeaderboard(
  options: PublishLeaderboardOptions,
): Promise<{ modelRows: number; runCount: number; path: string }> {
  const log = options.log ?? (() => undefined);
  const runsRoot = resolve(options.artifactRoot);
  const outPath = resolve(options.websiteLeaderboardPath);
  const runsIndexPath = resolve(
    options.websiteRunsIndexPath ?? join(dirname(outPath), "runs.json"),
  );
  const publicRoot = resolve(
    options.websitePublicRoot ??
      join(dirname(dirname(dirname(outPath))), "public"),
  );
  const includeCheckpoints = options.includeCheckpoints === true;
  const minScored = options.minScored ?? 0;

  let names: string[] = [];
  try {
    names = await readdir(runsRoot);
  } catch {
    log(`[gmod-bench] website leaderboard: no runs dir at ${runsRoot}`);
    return { modelRows: 0, runCount: 0, path: outPath };
  }

  const runIds = names
    .filter((name) => {
      if (name.startsWith(".")) return false;
      if (!includeCheckpoints && /checkpoint/i.test(name)) return false;
      return true;
    })
    .sort();

  const byKey = new Map<string, PublishedModelRow>();
  const runSummaries: PublishedRunSummary[] = [];
  const verifiedAttemptsByCohort = new Map<string, VerifiedAttempt[]>();

  for (const runId of runIds) {
    try {
      const { rows, summary, artifact, rankingAttempts } = await loadRun(
        runsRoot,
        runId,
        minScored,
        options.fixturesRoot,
      );
      if (rows.length === 0 || !summary || !artifact) continue;
      if (options.storagePublicBaseUrl) {
        summary.r2ManifestUrl = `${options.storagePublicBaseUrl.replace(/\/$/, "")}/runs/${summary.runId}/manifest.json`;
      }
      for (const row of rows) {
        byKey.set(rowKey(row.runId, row.adapterId, row.model), row);
      }
      const cohortId = rows[0]?.cohortId;
      if (cohortId && rankingAttempts) {
        const cohortAttempts = verifiedAttemptsByCohort.get(cohortId) ?? [];
        cohortAttempts.push(
          ...rankingAttempts.map((attempt) => ({
            runId,
            fixtureId: attempt.fixtureId,
            adapterId: attempt.adapterId,
            model: attempt.model ?? "default",
            status: attempt.status,
            finalResponse: attempt.finalResponse,
            durationMs: attempt.durationMs,
          })),
        );
        verifiedAttemptsByCohort.set(cohortId, cohortAttempts);
      }
      runSummaries.push(summary);
      await publishRunArchive(runsRoot, publicRoot, summary, artifact);
    } catch (error) {
      log(
        `[gmod-bench] website leaderboard: skipped invalid run ${runId} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  if (byKey.size === 0) {
    log("[gmod-bench] website leaderboard: no model rows to publish");
    return { modelRows: 0, runCount: 0, path: outPath };
  }

  const allRows = [...byKey.values()];
  const sourceZeroEvidenceRowCount = allRows.filter(
    (row) => row.scored === 0,
  ).length;
  const eligibleRows = allRows.filter(
    (row) => row.scored > 0 && row.coverage >= 0.5,
  );
  const sourceInsufficientEvidenceRowCount =
    allRows.length - eligibleRows.length - sourceZeroEvidenceRowCount;
  if (eligibleRows.length === 0) {
    log("[gmod-bench] website leaderboard: no rows produced a scorable answer");
    return { modelRows: 0, runCount: runSummaries.length, path: outPath };
  }
  const cohorts = new Map<string, PublishedModelRow[]>();
  for (const row of eligibleRows) {
    const cohort = cohorts.get(row.cohortId) ?? [];
    cohort.push(row);
    cohorts.set(row.cohortId, cohort);
  }
  const cohortCandidates = [...cohorts.entries()].map(([cohortId, rows]) => ({
    cohortId,
    rows,
    distinctModels: new Set(rows.map(modelIdentity)).size,
    fixtureCount: rows[0]?.fixtureCount ?? 0,
    repeat: rows[0]?.repeat ?? 1,
    completedAt: rows.reduce(
      (latest, row) =>
        (row.completedAt ?? "").localeCompare(latest) > 0
          ? (row.completedAt ?? "")
          : latest,
      "",
    ),
  }));
  cohortCandidates.sort(
    (a, b) =>
      b.distinctModels - a.distinctModels ||
      b.fixtureCount - a.fixtureCount ||
      b.completedAt.localeCompare(a.completedAt) ||
      a.cohortId.localeCompare(b.cohortId),
  );
  const primaryCohort = cohortCandidates[0]!;
  const primarySourceRows = allRows.filter(
    (row) => row.cohortId === primaryCohort.cohortId,
  );
  const latestByModel = new Map<string, PublishedModelRow>();
  for (const row of primarySourceRows) {
    const key = modelIdentity(row);
    const current = latestByModel.get(key);
    if (
      !current ||
      (row.completedAt ?? "").localeCompare(current.completedAt ?? "") > 0 ||
      ((row.completedAt ?? "") === (current.completedAt ?? "") &&
        row.runId.localeCompare(current.runId) > 0)
    ) {
      latestByModel.set(key, row);
    }
  }
  const cohortAttempts =
    verifiedAttemptsByCohort.get(primaryCohort.cohortId) ?? [];
  const expectedFixturesByModel = new Map<string, Set<string>>();
  for (const attempt of cohortAttempts) {
    const key = `${attempt.adapterId}\0${attempt.model}`;
    const fixtures = expectedFixturesByModel.get(key) ?? new Set<string>();
    fixtures.add(attempt.fixtureId);
    expectedFixturesByModel.set(key, fixtures);
  }
  const cumulativeRows = buildVerifiedRanking(
    cohortAttempts,
    expectedFixturesByModel,
  ).flatMap((metrics) => {
    const base = latestByModel.get(`${metrics.adapterId}\0${metrics.model}`);
    if (!base) return [];
    const coverage =
      metrics.scheduledAttempts > 0
        ? metrics.evidenceAttempts / metrics.scheduledAttempts
        : 0;
    return [
      {
        ...base,
        attempts: metrics.scheduledAttempts,
        scored: metrics.scored,
        pass: metrics.pass,
        partial: metrics.partial,
        incorrect: metrics.incorrect,
        protocol_error: metrics.modelFormatFailures,
        otherErrors: metrics.harnessFailures,
        passRate: round4(metrics.passRate),
        quality: round4(metrics.quality),
        coverage: round4(coverage),
        fixtureScore: round4(metrics.fixtureScore),
        fixtureSolveRate: round4(metrics.fixtureSolveRate),
        fixturesPassed: metrics.fixturesPassed,
        fixturesAttempted: metrics.fixturesAttempted,
        avgDurationMs: metrics.avgDurationMs,
        passRateLabel: pct(metrics.passRate),
        qualityLabel: metrics.quality.toFixed(3),
        coverageLabel: pct(coverage),
        fixtureScoreLabel: pct(metrics.fixtureScore),
        fixtureSolveRateLabel: pct(metrics.fixtureSolveRate),
        evidenceAttempts: metrics.evidenceAttempts,
        scheduledAttempts: metrics.scheduledAttempts,
        verifiedRunCount: metrics.verifiedRunCount,
        scoreIntervalLow: round4(metrics.scoreIntervalLow),
        scoreIntervalHigh: round4(metrics.scoreIntervalHigh),
        harnessFailures: metrics.harnessFailures,
        modelFormatFailures: metrics.modelFormatFailures,
        fixtureCoverage: round4(metrics.fixtureCoverage),
      },
    ];
  });
  const ranked = rankModels(
    cumulativeRows.filter(
      (row) => row.evidenceAttempts > 0 && row.fixtureCoverage >= 0.5,
    ),
  );
  const unranked = cumulativeRows
    .filter((row) => row.evidenceAttempts > 0 && row.fixtureCoverage < 0.5)
    .sort(compareVerifiedRows)
    .map((row) => ({
      ...row,
      rank: null,
      rankingStatus: "insufficient-coverage" as const,
    }));
  const unrankedZeroEvidenceRowCount = cumulativeRows.filter(
    (row) => row.evidenceAttempts === 0,
  ).length;
  const unrankedInsufficientEvidenceRowCount = unranked.length;
  const publishedModels = [...ranked, ...unranked];
  const adapters = [...new Set(publishedModels.map((m) => m.adapterId))].sort();
  const suites = [...new Set(publishedModels.map((m) => m.suite))].sort();
  const usedRunIds = runSummaries.map((r) => r.runId);
  const fixtureCount = primaryCohort.fixtureCount;
  const publishedFixtureCount = new Set(
    runSummaries.flatMap((run) => run.fixtureIds),
  ).size;
  const noteParts = runSummaries.map(
    (r) =>
      `${r.runId.slice(0, 8)}… (${r.adapters.join("+")}, ${r.models} models)`,
  );

  const payload = {
    meta: {
      title: "Leaderboard",
      disclaimer:
        "Ranks aggregate all verified runs in the broadest compatible fixture cohort. Each fixture has equal weight; harness failures are excluded, malformed model answers score zero, and numeric rank requires at least 50% fixture coverage.",
      fixtureCount,
      rescoredWithCurrentRubrics: Boolean(options.fixturesRoot),
      publishedFixtureCount,
      cohortId: primaryCohort.cohortId,
      cohortRepeat: primaryCohort.repeat,
      cohortModelCount: publishedModels.length,
      rankedModelCount: ranked.length,
      displayedUnrankedModelCount: unranked.length,
      unrankedZeroEvidenceRowCount,
      unrankedInsufficientEvidenceRowCount,
      sourceZeroEvidenceRowCount,
      sourceInsufficientEvidenceRowCount,
      minimumRankedCoverage: 0.5,
      excludedNonCohortRowCount: allRows.length - primarySourceRows.length,
      supersededCohortRowCount: primarySourceRows.length - latestByModel.size,
      excludedModelRowCount: allRows.length - publishedModels.length,
      date: new Date().toISOString().slice(0, 10),
      primaryRunId: usedRunIds[usedRunIds.length - 1] ?? null,
      secondaryRunId:
        usedRunIds.length > 1 ? usedRunIds[usedRunIds.length - 2]! : null,
      runIds: usedRunIds,
      adapters,
      suites,
      runCount: usedRunIds.length,
      modelRowCount: publishedModels.length,
      totalModelRowCount: allRows.length,
      note: `Primary verified cohort: ${fixtureCount} fixtures, repeat ×${primaryCohort.repeat}, ${ranked.length} ranked and ${unranked.length} unranked cumulative model results. All finished runs archived (${usedRunIds.length}): ${noteParts.join(" · ")}`,
    },
    models: publishedModels,
    runs: runSummaries,
  };

  await Bun.write(outPath, await formattedJson(payload));
  let previousRuns: PublishedRunSummary[] = [];
  const previousIndex = Bun.file(runsIndexPath);
  if (await previousIndex.exists()) {
    try {
      const parsed = (await previousIndex.json()) as {
        runs?: PublishedRunSummary[];
      };
      if (Array.isArray(parsed.runs)) previousRuns = parsed.runs;
    } catch {
      previousRuns = [];
    }
  }
  const archiveById = new Map(previousRuns.map((run) => [run.runId, run]));
  for (const run of runSummaries) archiveById.set(run.runId, run);
  const archivedRuns = [...archiveById.values()].sort(
    (a, b) =>
      (b.completedAt ?? "").localeCompare(a.completedAt ?? "") ||
      a.runId.localeCompare(b.runId),
  );
  await mkdir(dirname(runsIndexPath), { recursive: true });
  await Bun.write(
    runsIndexPath,
    await formattedJson({
      generatedAt: new Date().toISOString(),
      runs: archivedRuns,
    }),
  );
  log(
    `[gmod-bench] website leaderboard: ${publishedModels.length} rows (${ranked.length} ranked, ${unranked.length} unranked) from ${usedRunIds.length} run(s) → ${outPath}`,
  );
  return {
    modelRows: publishedModels.length,
    runCount: usedRunIds.length,
    path: outPath,
  };
}
