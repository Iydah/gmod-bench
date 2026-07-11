/**
 * Per-model fixture outcomes from published attempts.jsonl.
 * Built once at import time (SSG / SSR) for expand-panel chips.
 */

export type FixtureStatus =
  | "pass"
  | "partial"
  | "incorrect"
  | "protocol_error"
  | "mixed"
  | "other";

export interface FixtureResult {
  /** Full fixture id, e.g. gmod.ents-iterator.v1 */
  fixtureId: string;
  /** Short label for chips */
  name: string;
  status: FixtureStatus;
  pass: number;
  partial: number;
  incorrect: number;
  protocol_error: number;
  other: number;
  attempts: number;
  /** Hover summary */
  summary: string;
}

type RawAttempt = {
  runId?: string;
  fixtureId?: string;
  instance_id?: string;
  adapterId?: string;
  model?: string;
  model_name_or_path?: string;
  status?: string;
};

type Agg = {
  fixtureId: string;
  pass: number;
  partial: number;
  incorrect: number;
  protocol_error: number;
  other: number;
  attempts: number;
};

const STATUS_RANK: Record<FixtureStatus, number> = {
  pass: 5,
  partial: 4,
  mixed: 3,
  incorrect: 2,
  protocol_error: 1,
  other: 0,
};

function shortName(fixtureId: string): string {
  return fixtureId
    .replace(/^gmod\./i, "")
    .replace(/\.v\d+$/i, "")
    .replace(/\./g, "-");
}

function modelKey(
  runId: string,
  adapterId: string,
  model: string,
): string {
  return `${runId}\0${adapterId}\0${model}`;
}

function normalizeStatus(raw: string | undefined): keyof Omit<Agg, "fixtureId" | "attempts"> {
  switch ((raw ?? "").toLowerCase()) {
    case "pass":
      return "pass";
    case "partial":
      return "partial";
    case "incorrect":
    case "fail":
    case "failed":
      return "incorrect";
    case "protocol_error":
    case "format":
    case "format_error":
      return "protocol_error";
    default:
      return "other";
  }
}

function finalize(agg: Agg): FixtureResult {
  const {
    fixtureId,
    pass,
    partial,
    incorrect,
    protocol_error,
    other,
    attempts,
  } = agg;

  let status: FixtureStatus;
  if (pass > 0 && pass === attempts) status = "pass";
  else if (pass > 0) status = "mixed";
  else if (partial > 0 && partial + pass === attempts) status = "partial";
  else if (partial > 0) status = "partial";
  else if (incorrect > 0) status = "incorrect";
  else if (protocol_error > 0) status = "protocol_error";
  else status = "other";

  const bits: string[] = [];
  if (pass) bits.push(`${pass} pass`);
  if (partial) bits.push(`${partial} partial`);
  if (incorrect) bits.push(`${incorrect} wrong`);
  if (protocol_error) bits.push(`${protocol_error} format`);
  if (other) bits.push(`${other} other`);
  const summary =
    attempts > 1
      ? `${bits.join(" · ") || "no scored"} · ${attempts} tries`
      : bits[0] ?? status;

  return {
    fixtureId,
    name: shortName(fixtureId),
    status,
    pass,
    partial,
    incorrect,
    protocol_error,
    other,
    attempts,
    summary,
  };
}

function parseJsonl(text: string): RawAttempt[] {
  const rows: RawAttempt[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as RawAttempt);
    } catch {
      // skip bad lines
    }
  }
  return rows;
}

function buildIndex(): Map<string, FixtureResult[]> {
  const modules = import.meta.glob("/public/runs/*/attempts.jsonl", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  /** key → fixtureId → agg */
  const bag = new Map<string, Map<string, Agg>>();

  for (const [path, raw] of Object.entries(modules)) {
    if (typeof raw !== "string") continue;
    const runFromPath = path.match(/\/runs\/([^/]+)\/attempts\.jsonl$/)?.[1];

    for (const row of parseJsonl(raw)) {
      const runId = row.runId || runFromPath;
      const adapterId = row.adapterId;
      const model = row.model || row.model_name_or_path;
      const fixtureId = row.fixtureId || row.instance_id;
      if (!runId || !adapterId || !model || !fixtureId) continue;

      const key = modelKey(runId, adapterId, model);
      let fixtures = bag.get(key);
      if (!fixtures) {
        fixtures = new Map();
        bag.set(key, fixtures);
      }
      let agg = fixtures.get(fixtureId);
      if (!agg) {
        agg = {
          fixtureId,
          pass: 0,
          partial: 0,
          incorrect: 0,
          protocol_error: 0,
          other: 0,
          attempts: 0,
        };
        fixtures.set(fixtureId, agg);
      }
      const bucket = normalizeStatus(row.status);
      agg[bucket] += 1;
      agg.attempts += 1;
    }
  }

  const index = new Map<string, FixtureResult[]>();
  for (const [key, fixtures] of bag) {
    const list = [...fixtures.values()]
      .map(finalize)
      .sort((a, b) => {
        const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
        if (rank !== 0) return rank; // worse first so failures surface
        return a.name.localeCompare(b.name);
      });
    index.set(key, list);
  }
  return index;
}

const INDEX = buildIndex();

export function fixtureResultsFor(
  runId: string | undefined,
  adapterId: string | undefined,
  model: string | undefined,
): FixtureResult[] {
  if (!runId || !adapterId || !model) return [];
  return INDEX.get(modelKey(runId, adapterId, model)) ?? [];
}

export function fixtureStatusLabel(status: FixtureStatus): string {
  switch (status) {
    case "pass":
      return "Pass";
    case "partial":
      return "Partial";
    case "incorrect":
      return "Wrong";
    case "protocol_error":
      return "Format";
    case "mixed":
      return "Mixed";
    default:
      return "Other";
  }
}
