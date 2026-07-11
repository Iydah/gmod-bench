/**
 * Parse a gmod-bench stderr log into attempt records + checkpoint run.json.
 * Usage: bun run scripts/parse-run-log.ts <logPath> [outDir]
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  applyQuarantineUpdates,
  defaultQuarantinePath,
  emptyQuarantineStore,
  loadQuarantineStore,
  planQuarantineFromAttempts,
  saveQuarantineStore,
} from "../src/core/model-quarantine";
import { summarizeAttempts } from "../src/core/summary";
import type { AdapterId } from "../src/adapters/types";
import type {
  AttemptRecord,
  AttemptStatus,
  RunArtifact,
} from "../src/core/types";
import { writeRunArtifacts } from "../src/report/write";

const statuses = new Set<string>([
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

function parseLog(text: string): {
  runId: string | null;
  attempts: AttemptRecord[];
} {
  const runMatch = /\[gmod-bench\] run ([0-9a-f-]+):/.exec(text);
  const runId = runMatch?.[1] ?? null;
  const attempts: AttemptRecord[] = [];

  // done (N/M) adapter[/model…] @ fixture #k → status Xms [tokens=…] — detail
  // model may contain spaces / parentheses (agy display names)
  const lineRe =
    /\[gmod-bench\] done\s+\((\d+)\/(\d+)\) ([a-z0-9_-]+)(?:\/(.+?))? @ (\S+) #(\d+)\s*(?:→|->)?\s*(\S+) (\d+)ms(?: tokens=(\d+)\/(\d+) cached=(\d+))?\s*(?:—|-)\s*(.*)$/i;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const m = lineRe.exec(line);
    if (!m) continue;
    const status = m[7] ?? "";
    if (!statuses.has(status)) continue;

    const adapterId = m[3] as AdapterId;
    const model = m[4]?.trim() || null;
    const promptTokens = m[9] !== undefined ? Number(m[9]) : undefined;
    const completionTokens = m[10] !== undefined ? Number(m[10]) : undefined;
    const cachedTokens = m[11] !== undefined ? Number(m[11]) : undefined;
    const usage =
      promptTokens !== undefined
        ? {
            promptTokens,
            completionTokens: completionTokens ?? 0,
            cachedTokens: cachedTokens ?? 0,
          }
        : undefined;

    const hasBody = ["pass", "partial", "incorrect"].includes(status);
    attempts.push({
      fixtureId: m[5]!,
      adapterId,
      model,
      attemptIndex: Number(m[6]),
      status: status as AttemptStatus,
      detail: (m[12] ?? "").trim(),
      finalResponse: hasBody ? "(from log; body not captured)" : null,
      durationMs: Number(m[8]),
      version: adapterId === "openrouter" ? "openrouter-api" : adapterId,
      ...(usage ? { usage } : {}),
    });
  }

  const map = new Map<string, AttemptRecord>();
  for (const attempt of attempts) {
    map.set(
      `${attempt.fixtureId}\0${attempt.adapterId}\0${attempt.model}\0${attempt.attemptIndex}`,
      attempt,
    );
  }
  return { runId, attempts: [...map.values()] };
}

const logPath = process.argv[2];
const outRoot = process.argv[3] ?? join(process.cwd(), ".gmod-bench", "runs");
if (!logPath) {
  console.error("Usage: bun run scripts/parse-run-log.ts <logPath> [outDir]");
  process.exit(1);
}

const text = await Bun.file(logPath).text();
const { runId: parsedRunId, attempts } = parseLog(text);
const runId = parsedRunId ?? crypto.randomUUID();
const now = new Date().toISOString();

const byModel = new Map<string, AttemptRecord[]>();
for (const a of attempts) {
  const key = `${a.adapterId}/${a.model ?? "default"}`;
  const list = byModel.get(key) ?? [];
  list.push(a);
  byModel.set(key, list);
}

console.log(`Parsed ${attempts.length} attempts (run ${runId})`);
for (const [model, list] of [...byModel.entries()].sort((a, b) =>
  a[0].localeCompare(b[0]),
)) {
  const pass = list.filter((x) => x.status === "pass").length;
  const scored = list.filter((x) =>
    ["pass", "partial", "incorrect"].includes(x.status),
  ).length;
  console.log(`  ${model}: n=${list.length} pass=${pass} scored=${scored}`);
}

const artifact: RunArtifact = {
  schemaVersion: 3,
  runId: `${runId}-checkpoint`,
  fixtureIds: [...new Set(attempts.map((a) => a.fixtureId))].sort(),
  startedAt: now,
  completedAt: now,
  repeat: 1,
  concurrency: 1,
  attempts,
  summary: summarizeAttempts(attempts),
};

await mkdir(outRoot, { recursive: true });
const paths = await writeRunArtifacts(outRoot, artifact, false);
console.log(`Wrote checkpoint under ${paths.directory}`);

const freeAttempts = attempts.filter((a) => a.adapterId === "openrouter");
if (freeAttempts.length > 0) {
  const updates = planQuarantineFromAttempts(freeAttempts, {
    runId: artifact.runId,
    minAttempts: 3,
  });
  if (updates.length > 0) {
    const qPath = defaultQuarantinePath(process.cwd());
    const store = (await loadQuarantineStore(qPath)) ?? emptyQuarantineStore();
    applyQuarantineUpdates(store, updates);
    await saveQuarantineStore(qPath, store);
    console.log(`Quarantined ${updates.length} free model(s)`);
  }
}

console.log(`CHECKPOINT_DIR=${paths.directory}`);
