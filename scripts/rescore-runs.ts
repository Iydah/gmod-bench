/**
 * Re-grade stored model answers with the current scorers — no provider calls.
 *
 * Scoring is a deterministic function of the stored `finalResponse`, so when a
 * scorer or rubric improves we can re-derive every historical grade for free
 * instead of re-running the benchmark. Only answer-evaluated outcomes are
 * touched (pass / partial / incorrect / protocol_error with a real final);
 * harness/methodology outcomes (policy_violation, timeout, unavailable,
 * unsupported, trace_error) are left exactly as recorded.
 *
 *   bun run scripts/rescore-runs.ts --dry-run   # report the delta, write nothing
 *   bun run scripts/rescore-runs.ts             # apply + rebuild run exports
 *   bun run scripts/rescore-runs.ts --include-checkpoints
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { loadFixtures } from "../src/fixtures/load";
import { scoreFixtureAnswer } from "../src/scoring";
import { summarizeAttempts } from "../src/core/summary";
import { hashPrompt } from "../src/core/attempt-meta";
import { rebuildRunExports } from "../src/report/maintenance";
import type { AttemptStatus, BenchmarkFixture, RunArtifact } from "../src/core/types";

const RESCORABLE: ReadonlySet<AttemptStatus> = new Set<AttemptStatus>([
  "pass",
  "partial",
  "incorrect",
  "protocol_error",
]);

const projectRoot = join(import.meta.dir, "..");
const runsRoot = join(projectRoot, ".gmod-bench", "runs");
const dryRun = process.argv.includes("--dry-run");
const includeCheckpoints = process.argv.includes("--include-checkpoints");

// Restrict to an explicit set of fixtures whose scorer you changed and
// verified. Re-grading every fixture would re-apply scorer generations that
// drifted since older runs were graded — a change unrelated to your work.
const fixturesArgIndex = process.argv.indexOf("--fixtures");
const fixtureAllowlist =
  fixturesArgIndex >= 0
    ? new Set((process.argv[fixturesArgIndex + 1] ?? "").split(",").filter(Boolean))
    : null;

const fixturesRoot = join(projectRoot, "fixtures");
const fixtureIds = (await readdir(fixturesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const fixtures = await loadFixtures(fixturesRoot, fixtureIds);
const fixtureById = new Map<string, BenchmarkFixture>(
  fixtures.map((fixture) => [fixture.id, fixture]),
);
// A stored answer may only be re-graded when it was produced for the *current*
// prompt (same hash) and contract (same fixture version). Otherwise a grade
// change would reflect spec drift, not the scorer improvement, and would
// silently corrupt results that were correct under their own rubric.
const currentPromptHash = new Map<string, string>(
  fixtures.map((fixture) => [fixture.id, hashPrompt(fixture.prompt)]),
);

function isFinishedRunDir(name: string): boolean {
  if (name.startsWith(".")) return false;
  if (!includeCheckpoints && name.endsWith("-checkpoint")) return false;
  return true;
}

interface Transition {
  fixtureId: string;
  from: AttemptStatus;
  to: AttemptStatus;
}

const transitions: Transition[] = [];
let runsChanged = 0;
let attemptsRescored = 0;

const entries = await readdir(runsRoot, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory() || !isFinishedRunDir(entry.name)) continue;
  const dir = join(runsRoot, entry.name);
  const runFile = Bun.file(join(dir, "run.json"));
  if (!(await runFile.exists())) continue;

  const run = (await runFile.json()) as RunArtifact;
  let changed = false;

  for (const attempt of run.attempts) {
    if (typeof attempt.finalResponse !== "string" || attempt.finalResponse.length === 0)
      continue;
    if (!RESCORABLE.has(attempt.status)) continue;
    if (fixtureAllowlist && !fixtureAllowlist.has(attempt.fixtureId)) continue;
    const fixture = fixtureById.get(attempt.fixtureId);
    if (!fixture) continue;
    // Only re-grade answers produced for the current prompt + contract.
    if (
      !attempt.promptHash ||
      attempt.promptHash !== currentPromptHash.get(attempt.fixtureId) ||
      attempt.fixtureVersion !== fixture.version
    )
      continue;

    const result = scoreFixtureAnswer(fixture, attempt.finalResponse);
    if (result.status !== attempt.status) {
      transitions.push({
        fixtureId: attempt.fixtureId,
        from: attempt.status,
        to: result.status,
      });
      attemptsRescored += 1;
    }
    // Persist the new grade, detail, and rubric stamp so evidence matches.
    if (
      attempt.status !== result.status ||
      attempt.detail !== result.detail ||
      attempt.rubricVersion !== fixture.oracle.rubricVersion
    ) {
      changed = true;
    }
    attempt.status = result.status;
    attempt.detail = result.detail;
    attempt.rubricVersion = fixture.oracle.rubricVersion;
  }

  if (changed) {
    run.summary = summarizeAttempts(run.attempts);
    runsChanged += 1;
    if (!dryRun) {
      await Bun.write(join(dir, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
      await rebuildRunExports(dir);
    }
  }
}

// Report the delta grouped by fixture and status transition.
const summary = new Map<string, number>();
for (const t of transitions) {
  const key = `${t.fixtureId}  ${t.from} -> ${t.to}`;
  summary.set(key, (summary.get(key) ?? 0) + 1);
}

console.log(`${dryRun ? "[dry-run] " : ""}rescored ${attemptsRescored} attempts across ${runsChanged} runs`);
for (const [key, count] of [...summary.entries()].sort()) {
  console.log(`  ${count.toString().padStart(4)}  ${key}`);
}
if (dryRun) console.log("\n(dry run — no files written; drop --dry-run to apply)");
