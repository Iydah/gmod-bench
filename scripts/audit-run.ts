/**
 * Audit a run.json for result-quality issues (false passes, contract gaming, skew).
 * Usage: bun run scripts/audit-run.ts .gmod-bench/runs/<id>/run.json
 */
import { listFixtureIds, loadFixtures } from "../src/fixtures/load";
import { scoreFixtureAnswer } from "../src/scoring";
import type { AttemptRecord } from "../src/core/types";

const path =
  process.argv[2] ??
  ".gmod-bench/runs/38c62341-b58b-4e7d-9756-3fc0c03c77c9/run.json";
const run = JSON.parse(await Bun.file(path).text()) as {
  runId: string;
  attempts: AttemptRecord[];
};

const fixtures = await loadFixtures(
  "fixtures",
  await listFixtureIds("fixtures"),
);
const byId = Object.fromEntries(fixtures.map((f) => [f.id, f]));

function extractCode(answer: string): string {
  const m = /^```(?:lua)?\r?\n([\s\S]*?)\r?\n```/m.exec(answer);
  return m?.[1] ?? "";
}

function extractReason(answer: string): string {
  const m = /^Reason:\s*(.+)$/im.exec(answer);
  return m?.[1]?.trim() ?? "";
}

const attempts = run.attempts;
const statusCounts: Record<string, number> = {};
for (const a of attempts) {
  statusCounts[a.status] = (statusCounts[a.status] ?? 0) + 1;
}

const fromLog = attempts.filter((a) => a.finalResponse?.includes("(from log"));
const scored = attempts.filter((a) =>
  ["pass", "partial", "incorrect"].includes(a.status),
);
const scoredWithBody = scored.filter(
  (a) => a.finalResponse && !a.finalResponse.includes("(from log"),
);

// 1) Rescore consistency
let rescoreOk = 0;
let rescoreMismatch = 0;
const mismatches: unknown[] = [];
for (const a of scoredWithBody) {
  const f = byId[a.fixtureId];
  if (!f) continue;
  const r = scoreFixtureAnswer(f, a.finalResponse!);
  if (r.status === a.status) rescoreOk += 1;
  else {
    rescoreMismatch += 1;
    if (mismatches.length < 20) {
      mismatches.push({
        model: a.model,
        fixture: a.fixtureId,
        recorded: a.status,
        rescore: r.status,
        detail: r.detail,
      });
    }
  }
}

// 2) Suspicious passes
type Flagged = {
  model: string | null;
  fixture: string;
  flags: string[];
  code: string;
  reason: string;
};
const flagged: Flagged[] = [];
const passBodies = scoredWithBody.filter((a) => a.status === "pass");

for (const a of passBodies) {
  const code = extractCode(a.finalResponse!);
  const reason = extractReason(a.finalResponse!);
  const flags: string[] = [];

  if (code.trim().length < 12) flags.push("tiny_code");
  if (!reason) flags.push("missing_reason_line");
  if (
    /^\s*--/.test(code) &&
    code.split("\n").every((l) => !l.trim() || l.trim().startsWith("--"))
  ) {
    flags.push("comments_only");
  }
  if (/TODO|FIXME|placeholder|your code here/i.test(code))
    flags.push("placeholder");

  // Fixture-specific smell tests
  if (a.fixtureId.includes("player-iterator")) {
    if (/\bpairs\s*\(/.test(code)) flags.push("pass_with_pairs");
    if (/GetHumans|GetBots/.test(code)) flags.push("wrong_player_set");
    if (!/player\.Iterator/.test(code) && !/#\s*\w+/.test(code))
      flags.push("pass_without_iterator_or_hash");
  }
  if (a.fixtureId.includes("table-hasvalue") && /table\.HasValue/.test(code)) {
    flags.push("hasvalue_in_pass");
  }
  if (
    a.fixtureId.includes("disttosqr") &&
    /:Distance\s*\(/.test(code) &&
    !/DistToSqr/.test(code)
  ) {
    flags.push("distance_not_disttosqr");
  }
  if (
    a.fixtureId.includes("msg-vs-print") &&
    /\bprint\s*\(/.test(code) &&
    !/\bMsg/.test(code)
  ) {
    flags.push("print_not_msg");
  }

  // Reason says one thing, code another (lightweight)
  if (
    /iterator/i.test(reason) &&
    /player\.GetAll/.test(code) &&
    !/player\.Iterator/.test(code)
  ) {
    flags.push("reason_iterator_code_getall");
  }
  if (
    /cache/i.test(reason) &&
    !/local\s+\w+\s*=/.test(code) &&
    !/cache/i.test(code)
  ) {
    flags.push("reason_cache_no_local");
  }

  // Multi-fence or tool-ish
  if ((a.finalResponse!.match(/```/g) ?? []).length > 2)
    flags.push("extra_fences");
  if (/\bweb_search\b|\bbrowse\b|as an AI/i.test(a.finalResponse!))
    flags.push("meta_or_tool_speak");

  if (flags.length > 0) {
    flagged.push({
      model: a.model,
      fixture: a.fixtureId,
      flags,
      code: code.replace(/\s+/g, " ").slice(0, 140),
      reason: reason.slice(0, 120),
    });
  }
}

// 3) Pass-rate skew: models with few scored vs high rate
type ModelAgg = {
  pass: number;
  partial: number;
  incorrect: number;
  protocol_error: number;
  scored: number;
  fromLogScored: number;
};
const byModel = new Map<string, ModelAgg>();
for (const a of attempts) {
  const m = a.model ?? "—";
  const row = byModel.get(m) ?? {
    pass: 0,
    partial: 0,
    incorrect: 0,
    protocol_error: 0,
    scored: 0,
    fromLogScored: 0,
  };
  if (a.status === "pass") row.pass += 1;
  if (a.status === "partial") row.partial += 1;
  if (a.status === "incorrect") row.incorrect += 1;
  if (a.status === "protocol_error") row.protocol_error += 1;
  if (["pass", "partial", "incorrect"].includes(a.status)) {
    row.scored += 1;
    if (a.finalResponse?.includes("(from log")) row.fromLogScored += 1;
  }
  byModel.set(m, row);
}

const modelRows = [...byModel.entries()]
  .map(([model, r]) => ({
    model,
    ...r,
    passRate: r.scored ? r.pass / r.scored : 0,
    quality: r.scored ? (r.pass + 0.5 * r.partial) / r.scored : 0,
  }))
  .sort((a, b) => b.passRate - a.passRate || b.pass - a.pass);

// 4) Fixture difficulty among scored
const byFix = new Map<
  string,
  { pass: number; partial: number; incorrect: number }
>();
for (const a of scored) {
  const row = byFix.get(a.fixtureId) ?? { pass: 0, partial: 0, incorrect: 0 };
  if (a.status === "pass") row.pass += 1;
  if (a.status === "partial") row.partial += 1;
  if (a.status === "incorrect") row.incorrect += 1;
  byFix.set(a.fixtureId, row);
}
const fixtureDiff = [...byFix.entries()]
  .map(([id, r]) => {
    const n = r.pass + r.partial + r.incorrect;
    return { id, n, passRate: n ? r.pass / n : 0, ...r };
  })
  .sort((a, b) => a.passRate - b.passRate);

// 5) Protocol buckets
const peBuckets: Record<string, number> = {};
for (const a of attempts.filter((x) => x.status === "protocol_error")) {
  let k = a.detail.slice(0, 100);
  if (/HTTP 429|rate-limited/i.test(a.detail)) k = "HTTP_429";
  else if (/HTTP 502|Upstream|ResourceExhausted/i.test(a.detail))
    k = "HTTP_502_upstream";
  else if (/byte cap/i.test(a.detail)) k = "byte_cap";
  else if (/fenced code/i.test(a.detail)) k = "bad_fence";
  else if (/candidate loops/i.test(a.detail)) k = "loop_contract";
  else if (/reason/i.test(a.detail)) k = "reason_contract";
  else if (/Skipped:/i.test(a.detail)) k = "skipped_dead_in_run";
  else if (/empty/i.test(a.detail)) k = "empty_content";
  else if (/500/i.test(a.detail)) k = "HTTP_500";
  peBuckets[k] = (peBuckets[k] ?? 0) + 1;
}

// 6) Checkpoint vs live scoring contamination
const liveScoredFromLog = scored.filter((a) =>
  a.finalResponse?.includes("(from log"),
);
const liveModelsWithLogBodies = new Set(liveScoredFromLog.map((a) => a.model));

console.log(
  JSON.stringify(
    {
      runId: run.runId,
      totals: {
        attempts: attempts.length,
        statusCounts,
        scored: scored.length,
        fromLogBodies: fromLog.length,
      },
      rescore: {
        checked: rescoreOk + rescoreMismatch,
        ok: rescoreOk,
        mismatch: rescoreMismatch,
        samples: mismatches,
      },
      suspiciousPasses: {
        count: flagged.length,
        of: passBodies.length,
        samples: flagged.slice(0, 30),
      },
      protocolErrorBuckets: Object.entries(peBuckets).sort(
        (a, b) => b[1] - a[1],
      ),
      modelLeaderboardCaveats: modelRows
        .filter((r) => r.scored > 0 || r.protocol_error > 0)
        .map((r) => ({
          model: r.model,
          pass: r.pass,
          scored: r.scored,
          passRate: Number(r.passRate.toFixed(3)),
          quality: Number(r.quality.toFixed(3)),
          protocol_error: r.protocol_error,
          fromLogScored: r.fromLogScored,
          thinSample: r.scored > 0 && r.scored < 10,
          allDead: r.scored === 0 && r.protocol_error >= 10,
        })),
      hardestFixtures: fixtureDiff.slice(0, 10),
      easiestFixtures: fixtureDiff.slice(-8).reverse(),
      checkpointContamination: {
        scoredWithPlaceholderBodies: liveScoredFromLog.length,
        modelsAffected: [...liveModelsWithLogBodies],
      },
    },
    null,
    2,
  ),
);
