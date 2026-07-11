import type { AttemptRecord, RunArtifact } from "../core/types";

function modelKey(adapterId: string, model: string | null): string {
  return model ? `${adapterId}/${model}` : adapterId;
}

function pickAttempts(run: RunArtifact, modelFilter: string): AttemptRecord[] {
  const needle = modelFilter.toLowerCase();
  const exact = run.attempts.filter((a) => {
    const label = modelKey(a.adapterId, a.model).toLowerCase();
    return label === needle || a.model?.toLowerCase() === needle;
  });
  if (exact.length > 0) return exact;

  const partial = run.attempts.filter((a) => {
    const label = modelKey(a.adapterId, a.model).toLowerCase();
    return (
      label.includes(needle) ||
      (a.model?.toLowerCase().includes(needle) ?? false)
    );
  });
  const identities = new Set(
    partial.map((attempt) => modelKey(attempt.adapterId, attempt.model)),
  );
  if (identities.size > 1) {
    throw new Error(
      `Model filter is ambiguous: ${modelFilter}. Matches: ${[...identities].join(", ")}`,
    );
  }
  return partial;
}

function fenced(value: string | null): string[] {
  const body = value ?? "(no finalResponse stored)";
  const longestRun = Math.max(
    0,
    ...[...body.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return [fence, body, fence];
}

/**
 * Side-by-side comparison of two models in the same run (or any run artifact).
 * Shows fixtures where statuses differ, with full answers when present.
 */
export function renderModelCompare(
  run: RunArtifact,
  modelA: string,
  modelB: string,
): string {
  const aAttempts = pickAttempts(run, modelA);
  const bAttempts = pickAttempts(run, modelB);
  if (aAttempts.length === 0) {
    throw new Error(`No attempts matched model filter: ${modelA}`);
  }
  if (bAttempts.length === 0) {
    throw new Error(`No attempts matched model filter: ${modelB}`);
  }

  const aLabel = modelKey(aAttempts[0]!.adapterId, aAttempts[0]!.model);
  const bLabel = modelKey(bAttempts[0]!.adapterId, bAttempts[0]!.model);

  const byFixA = new Map<string, AttemptRecord>();
  const byFixB = new Map<string, AttemptRecord>();
  // Prefer highest attempt index when repeats exist
  for (const a of aAttempts) {
    const prev = byFixA.get(a.fixtureId);
    if (!prev || a.attemptIndex >= prev.attemptIndex)
      byFixA.set(a.fixtureId, a);
  }
  for (const a of bAttempts) {
    const prev = byFixB.get(a.fixtureId);
    if (!prev || a.attemptIndex >= prev.attemptIndex)
      byFixB.set(a.fixtureId, a);
  }

  const fixtures = [...new Set([...byFixA.keys(), ...byFixB.keys()])].sort();
  const diffs: string[] = [];
  let same = 0;
  let onlyA = 0;
  let onlyB = 0;

  for (const fixture of fixtures) {
    const a = byFixA.get(fixture);
    const b = byFixB.get(fixture);
    if (a && !b) {
      onlyA += 1;
      continue;
    }
    if (b && !a) {
      onlyB += 1;
      continue;
    }
    if (!a || !b) continue;
    if (a.status === b.status) {
      same += 1;
      continue;
    }

    diffs.push(
      [
        `### \`${fixture}\``,
        "",
        `| | \`${aLabel}\` | \`${bLabel}\` |`,
        `| --- | --- | --- |`,
        `| Status | **${a.status}** | **${b.status}** |`,
        `| Detail | ${a.detail.replace(/\|/g, "\\|")} | ${b.detail.replace(/\|/g, "\\|")} |`,
        `| ms | ${a.durationMs} | ${b.durationMs} |`,
        `| tokens (p/c/r) | ${a.usage?.promptTokens ?? "—"}/${a.usage?.completionTokens ?? "—"}/${a.usage?.reasoningTokens ?? "—"} | ${b.usage?.promptTokens ?? "—"}/${b.usage?.completionTokens ?? "—"}/${b.usage?.reasoningTokens ?? "—"} |`,
        `| usage source | ${a.usage?.source ?? "—"} | ${b.usage?.source ?? "—"} |`,
        `| answer bytes | ${a.answerBytes ?? "—"} | ${b.answerBytes ?? "—"} |`,
        `| cost | ${a.usage?.cost ?? "—"} | ${b.usage?.cost ?? "—"} |`,
        "",
        `#### ${aLabel}`,
        "",
        ...fenced(a.finalResponse),
        "",
        `#### ${bLabel}`,
        "",
        ...fenced(b.finalResponse),
        "",
      ].join("\n"),
    );
  }

  const aPass = aAttempts.filter((x) => x.status === "pass").length;
  const bPass = bAttempts.filter((x) => x.status === "pass").length;

  return [
    `# Model compare`,
    "",
    `Run: \`${run.runId}\``,
    "",
    `| Model | Attempts | Pass |`,
    `| --- | ---: | ---: |`,
    `| \`${aLabel}\` | ${aAttempts.length} | ${aPass} |`,
    `| \`${bLabel}\` | ${bAttempts.length} | ${bPass} |`,
    "",
    `Same status on shared fixtures: **${same}** · Status diffs: **${diffs.length}** · Only A: ${onlyA} · Only B: ${onlyB}`,
    "",
    diffs.length > 0
      ? "## Fixtures with different status"
      : "## No status differences on shared fixtures",
    "",
    ...diffs,
  ].join("\n");
}
