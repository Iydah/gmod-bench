import { PAGE_METADATA, SITE } from "../content/site-content";
import leaderboardSnapshot from "../data/leaderboard.json";
import runArchive from "../data/runs.json";

type LeaderboardSnapshot = typeof leaderboardSnapshot;
type RunArchive = typeof runArchive;

const MARKDOWN_ROUTES = {
  documentation: `${SITE.url}/docs/index.html.md`,
  methodology: `${SITE.url}/methodology/index.html.md`,
  leaderboard: `${SITE.url}/leaderboard/index.html.md`,
  runs: `${SITE.url}/runs/index.html.md`,
} as const;

function escapeTableCell(value: string | number): string {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function canonicalLine(path: string): string {
  return `Canonical HTML: ${new URL(path, SITE.url).toString()}`;
}

export function renderRobots(): string {
  return [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${SITE.url}/sitemap-index.xml`,
    "",
  ].join("\n");
}

export function renderLlmsIndex(): string {
  return `# ${SITE.name}

> ${SITE.description}

${SITE.name} helps Garry's Mod developers find the best AI models for GMod Lua coding. It compares models on public coding challenges, with inspectable scoring rules, answers, leaderboard snapshots, and sanitized run artifacts.

## Documentation

- [Documentation](${MARKDOWN_ROUTES.documentation}): Installation, configuration, commands, adapters, and audit artifacts.
- [Methodology](${MARKDOWN_ROUTES.methodology}): Response contract, fixture isolation, scoring, and limitations.
- [Leaderboard](${MARKDOWN_ROUTES.leaderboard}): Bounded current results with a link to the full published data.
- [Run archive](${MARKDOWN_ROUTES.runs}): Immutable published runs and machine-readable artifacts.

## Project

- [Full project context](${SITE.url}/llms-full.txt)
- [Source repository](${SITE.github})
- [Canonical website](${SITE.url}/)

## Optional

- [Published run artifacts](${SITE.url}/runs/): JSON, JSONL, CSV, Markdown, and per-run leaderboards.
`;
}

export function renderLlmsFull(): string {
  const meta = leaderboardSnapshot.meta;
  return `# ${SITE.name}: full project context

${canonicalLine("/")}

## Purpose

${SITE.description}

The suite currently contains ${SITE.suiteSize} public GMod coding challenges. The published leaderboard contains ${meta.modelRowCount} model-run rows from ${meta.runCount} completed runs. Use it to compare models for addon development while remembering that no benchmark covers every possible task.

## Benchmark contract

Each answer must contain exactly one fenced \`lua\` block, exactly one \`Reason:\` line, and no tool calls. Fixture-specific byte limits and semantic rubrics run before a result is accepted.

## Scoring

- \`pass\`: response and code satisfy the fixture contract.
- \`partial\`: useful but incomplete or less suitable behavior.
- \`incorrect\`: wrong or unsafe behavior.
- \`protocol_error\`: the response shape, trace, or tool-use contract failed.
- \`pass@k\`: whether at least one repeated attempt passed.

## Isolation and auditability

CLI adapters run with reviewed tool-denial and isolation controls. Published run pages link sanitized structured answers, reports, leaderboard rows, JSONL attempts, and CSV exports. Raw process logs and credentials are not public artifacts.

## Public resources

- Documentation: ${MARKDOWN_ROUTES.documentation}
- Methodology: ${MARKDOWN_ROUTES.methodology}
- Leaderboard: ${MARKDOWN_ROUTES.leaderboard}
- Run archive: ${MARKDOWN_ROUTES.runs}
- Source: ${SITE.github}

## Limitations

The benchmark measures a narrow short-answer GMod/GLua contract. Scores depend on the published fixtures, runner versions, model identifiers, effort settings, and local execution environment. Compare rows with matching context and inspect the underlying run artifacts.
`;
}

export function renderDocsMarkdown(): string {
  return `# gmod-bench documentation

${canonicalLine(PAGE_METADATA.docs.path)}

## Install

\`\`\`shell
${SITE.install}
${SITE.doctor}
\`\`\`

## Core workflow

1. Run \`bun run bench doctor\` to inspect adapter availability and strictness.
2. Run a bounded fixture/model selection.
3. Read the generated report and structured artifacts under \`.gmod-bench/runs/<run-id>/\`.
4. Publish only sanitized finished runs to the website archive.

## Answer contract

Answers contain one fenced \`lua\` block, one \`Reason:\` line, and no tool calls. Fixture-specific byte limits and scoring rubrics remain authoritative.

## More detail

- Human documentation: ${SITE.url}/docs/
- Methodology: ${MARKDOWN_ROUTES.methodology}
- Source: ${SITE.github}
`;
}

export function renderMethodologyMarkdown(): string {
  return `# gmod-bench methodology

${canonicalLine(PAGE_METADATA.methodology.path)}

## Evaluation model

Fixtures define the prompt, answer byte limit, response contract, and deterministic scoring rubric. Adapters record transport/protocol outcomes separately from semantic scores.

## Result classes

| Result | Meaning |
| --- | --- |
| pass | Contract-complete and correct for the fixture |
| partial | Useful but incomplete or less suitable |
| incorrect | Wrong, unsafe, or behavior-changing |
| protocol_error | Invalid response envelope, trace, or tool use |

## Fair comparison

Inspect adapter, model identifier, effort, repeat count, fixture coverage, and published run artifacts. Aggregate rows do not erase prior completed runs.

Full human methodology: ${SITE.url}/methodology/
`;
}

export function renderLeaderboardMarkdown(
  snapshot: LeaderboardSnapshot,
): string {
  const limit = 50;
  const rows = snapshot.models.slice(0, limit);
  const lines = [
    "# gmod-bench leaderboard",
    "",
    canonicalLine(PAGE_METADATA.leaderboard.path),
    "",
    snapshot.meta.disclaimer,
    "",
    `Snapshot date: ${snapshot.meta.date}. Showing ${rows.length} of ${snapshot.models.length} published model-run rows.`,
    "",
    "| Rank | Model | Adapter | Verified score | 95% interval | Runs | Pass rate | Coverage | Run |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.rank ?? "Unranked"} | ${escapeTableCell(row.model)} | ${escapeTableCell(row.adapterId)} | ${row.fixtureScoreLabel} | ${(row.scoreIntervalLow * 100).toFixed(1)}–${(row.scoreIntervalHigh * 100).toFixed(1)}% | ${row.verifiedRunCount} | ${row.passRateLabel} | ${row.coverageLabel} | [${row.runId.slice(0, 8)}](${SITE.url}/runs/${row.runId}/) |`,
    );
  }

  lines.push(
    "",
    `Full archive and machine-readable per-run leaderboards: ${SITE.url}/runs/`,
    "",
  );
  return lines.join("\n");
}

export function renderRunsMarkdown(archive: RunArchive): string {
  const lines = [
    "# Published gmod-bench runs",
    "",
    canonicalLine(PAGE_METADATA.runs.path),
    "",
    `Generated ${archive.generatedAt}. ${archive.runs.length} immutable finished runs are published.`,
    "",
    "| Run | Completed | Fixtures | Attempts | Adapters | Artifacts |",
    "| --- | --- | ---: | ---: | --- | --- |",
  ];

  for (const run of archive.runs) {
    const base = `${SITE.url}/runs/${run.runId}`;
    lines.push(
      `| [${run.runId}](${base}/) | ${run.completedAt ?? "unknown"} | ${run.fixtureCount} | ${run.attemptCount} | ${escapeTableCell(run.adapters.join(", "))} | [report](${base}/report.md) · [JSON](${base}/run.json) |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}
