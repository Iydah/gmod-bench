import { formatModelLabel } from "../core/summary";
import type { RunArtifact } from "../core/types";
import { aggregateUsageTotals } from "./exports";
import { buildModelLeaderboard, formatPercent } from "./leaderboard";

export function renderMarkdownReport(run: RunArtifact): string {
  const counts = run.summary.statusCounts;
  const usage = aggregateUsageTotals(run.attempts);
  const leaderboard = buildModelLeaderboard(run.attempts);

  const leaderboardRows = leaderboard.map((row) => {
    const model = row.label.replace(/\|/g, "\\|");
    const quality =
      row.quality == null || !Number.isFinite(row.quality)
        ? "—"
        : row.quality.toFixed(2);
    return `| ${row.rank} | \`${model}\` | ${formatPercent(row.fixtureScore)} | ${formatPercent(row.fixtureSolveRate)} | ${row.pass} | ${row.partial} | ${row.incorrect} | ${row.scored} | ${formatPercent(row.coverage)} | ${formatPercent(row.passRate)} | ${formatPercent(row.passAtKRate)} | ${quality} | ${row.protocol_error} | ${row.fixturesPassed}/${row.fixturesAttempted} | ${row.avgDurationMs} | ${row.totalPromptTokens}/${row.totalCompletionTokens} |`;
  });

  const groupRows = run.summary.groups.map((group) => {
    const label = formatModelLabel(group.adapterId, group.model).replace(
      /\|/g,
      "\\|",
    );
    const mean =
      group.meanScore == null || !Number.isFinite(group.meanScore)
        ? "—"
        : group.meanScore.toFixed(2);
    return `| ${group.fixtureId} | ${label} | ${group.attempts} | ${group.passCount} | ${group.passAtK ? "yes" : "no"} | ${mean} | ${group.bestStatus} |`;
  });

  const attemptRows = run.attempts.map((attempt) => {
    const model = (attempt.model ?? "—").replace(/\|/g, "\\|");
    const detail = attempt.detail.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    const promptTok = attempt.usage?.promptTokens ?? "—";
    const completionTok = attempt.usage?.completionTokens ?? "—";
    const reasoningTok = attempt.usage?.reasoningTokens ?? "—";
    const src = attempt.usage?.source ?? "—";
    const body = attempt.finalResponse
      ? attempt.finalResponse.includes("(from log")
        ? "log-placeholder"
        : "yes"
      : "no";
    const answerBytes = attempt.answerBytes ?? "—";
    return `| ${attempt.fixtureId} | ${attempt.adapterId} | ${model} | ${attempt.attemptIndex} | ${attempt.status} | ${attempt.durationMs} | ${promptTok}/${completionTok} | ${reasoningTok} | ${src} | ${answerBytes} | ${body} | ${detail} |`;
  });

  const fixtureList =
    run.fixtureIds.length <= 12
      ? run.fixtureIds.map((id) => `\`${id}\``).join(", ")
      : `${run.fixtureIds.length} fixtures (\`bun run bench list\`)`;

  const meanLabel =
    run.summary.overallMeanScore === null ||
    run.summary.overallMeanScore === undefined
      ? "—"
      : run.summary.overallMeanScore.toFixed(3);

  const wallSeconds =
    run.metadata?.durationSeconds ??
    (() => {
      const s = Date.parse(run.startedAt);
      const c = Date.parse(run.completedAt);
      return Number.isFinite(s) && Number.isFinite(c)
        ? Math.max(0, Math.round((c - s) / 1000))
        : 0;
    })();

  return [
    "# GMod Bench report",
    "",
    `Run: \`${run.runId}\``,
    `Fixtures: ${fixtureList}`,
    `Repeat: ${run.repeat} · Concurrency: ${run.concurrency}`,
    `Started: ${run.startedAt} · Completed: ${run.completedAt}`,
    `Wall clock: ${wallSeconds}s · Sum of attempt durations: ${usage.totalDurationMs}ms (avg ${usage.avgDurationMs}ms, min ${usage.minDurationMs}ms, max ${usage.maxDurationMs}ms)`,
    "",
    "## Model leaderboard",
    "",
    "Sorted by **fixture score** (each fixture weighted equally; failures score zero), then fixture solve rate, coverage, and pass rate.",
    "",
    `| Rank | Runner / model | Fixture score | Fixture solve | Pass | Partial | Incorrect | Scored | Coverage | Pass rate | ${run.repeat > 1 ? `pass@${run.repeat}` : "Fixture pass"} | Scored quality | Protocol err | Fixtures | Avg ms | Prompt/Compl tok |`,
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...leaderboardRows,
    "",
    "## Rates",
    "",
    `- Scored attempts: ${counts.scored}`,
    `- Pass / partial / incorrect: ${counts.pass} / ${counts.partial} / ${counts.incorrect}`,
    `- Pass rate (scored): ${counts.pass}/${counts.scored}`,
    run.repeat > 1
      ? `- pass@${run.repeat} (groups with ≥1 pass / scored groups): ${run.summary.passAtKRate}`
      : `- Fixture pass rate (passed fixture groups / scored fixture groups): ${run.summary.passAtKRate}`,
    `- Overall mean score (pass=1, partial=0.5): ${meanLabel}`,
    `- Protocol errors: ${counts.protocol_error}`,
    `- Policy violations: ${counts.policy_violation}`,
    `- Trace errors: ${counts.trace_error}`,
    `- Timeouts: ${counts.timeout}`,
    `- Unavailable: ${counts.unavailable}`,
    `- Unsupported: ${counts.unsupported}`,
    "",
    "## Usage & timing",
    "",
    "Token counts: **provider** when the runner reports them (OpenRouter); otherwise **estimated** (~chars/4) so CLI runs still get numbers.",
    "",
    `- Prompt tokens: ${usage.promptTokens}`,
    `- Completion tokens: ${usage.completionTokens}`,
    `- Reasoning tokens: ${usage.reasoningTokens}`,
    `- Total tokens: ${usage.totalTokens}`,
    `- Cached prompt tokens: ${usage.cachedTokens}`,
    `- Cache write tokens: ${usage.cacheWriteTokens}`,
    `- Reported cost: ${usage.cost}`,
    `- Upstream inference cost: ${usage.upstreamInferenceCost}`,
    `- Attempts with token counts: ${usage.attemptsWithUsage} (provider ${usage.providerUsageAttempts}, estimated ${usage.estimatedUsageAttempts})`,
    `- Answer bytes (sum): ${usage.totalAnswerBytes}`,
    `- Attempt duration avg/min/max: ${usage.avgDurationMs} / ${usage.minDurationMs} / ${usage.maxDurationMs} ms`,
    "",
    `## Groups (${run.repeat > 1 ? `pass@${run.repeat}` : "single-sample result"} + mean score)`,
    "",
    `| Fixture | Runner | K | Passes | ${run.repeat > 1 ? `pass@${run.repeat}` : "Passed"} | Mean | Best |`,
    "| --- | --- | ---: | ---: | --- | ---: | --- |",
    ...groupRows,
    "",
    "## Attempts",
    "",
    "| Fixture | Adapter | Model | # | Status | ms | P/C tok | Reason tok | Src | Bytes | Body | Detail |",
    "| --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: | --- | --- |",
    ...attemptRows,
    "",
    "## Files (audit pack)",
    "",
    "Same run directory contains:",
    "",
    "- `run.json` — full structured artifact (answers + per-attempt metrics; raw stdout stripped)",
    "- `metadata.json` — run provenance + `usageTotals` (tokens, cost, timing)",
    "- `leaderboard.json` / `leaderboard.csv` — fixture-normalized model ranking, diagnostics, tokens, and timing",
    "- `attempts.jsonl` / `attempts.csv` — one row per attempt + tokens/timing/sizes",
    "- `preds.jsonl` — SWE-style predictions with usage fields",
    "- `responses/<adapter>/<model>/<fixture>--kN.txt` — graded answer files",
    "- `raw/*.log` — redacted stdout/stderr when keepRaw is on (default)",
    "",
    'Compare two models: `bun run bench compare --run <run.json> --model "A" --model "B"`',
    "",
  ].join("\n");
}
