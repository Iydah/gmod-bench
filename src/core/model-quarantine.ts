import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isOpenRouterFreeModelId } from "../adapters/openrouter-limits";
import { parseModelSlot } from "../adapters/openrouter-slots";
import type { AttemptRecord } from "./types";

export const DEFAULT_QUARANTINE_MS = 7 * 24 * 60 * 60 * 1000;
/** Need at least this many no-response attempts before persisting a quarantine. */
export const MIN_ATTEMPTS_TO_QUARANTINE = 3;
/** Within a run: after this many consecutive no-response failures, skip remaining fixtures for that free model. */
export const MIN_CONSECUTIVE_NO_RESPONSE_TO_SKIP = 2;

export interface QuarantineEntry {
  /** ISO timestamp when the quarantine expires. */
  until: string;
  reason: string;
  quarantinedAt: string;
  lastRunId?: string;
  noResponseAttempts?: number;
}

export interface ModelQuarantineStore {
  schemaVersion: 1;
  /** Keyed by OpenRouter API model id (without @effort). */
  entries: Record<string, QuarantineEntry>;
}

export function emptyQuarantineStore(): ModelQuarantineStore {
  return { schemaVersion: 1, entries: {} };
}

export function defaultQuarantinePath(projectRoot: string): string {
  return join(projectRoot, ".gmod-bench", "model-quarantine.json");
}

/** Base OpenRouter model id — efforts share capacity, so quarantine applies to all slots. */
export function quarantineModelKey(slotOrModelId: string): string {
  return parseModelSlot(slotOrModelId).modelId;
}

/**
 * True when the model produced no usable answer text.
 * Oversize / bad-format answers that still returned completion tokens count as a response
 * (do not quarantine those models).
 */
export function isNoResponseAttempt(attempt: AttemptRecord): boolean {
  if (
    attempt.finalResponse !== null &&
    attempt.finalResponse.trim().length > 0
  ) {
    return false;
  }
  if ((attempt.usage?.completionTokens ?? 0) > 0) {
    return false;
  }
  return (
    attempt.status === "protocol_error" ||
    attempt.status === "timeout" ||
    attempt.status === "unavailable"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseQuarantineStore(value: unknown): ModelQuarantineStore {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isRecord(value.entries)
  ) {
    return emptyQuarantineStore();
  }

  const entries: Record<string, QuarantineEntry> = {};
  for (const [key, raw] of Object.entries(value.entries)) {
    if (
      !isRecord(raw) ||
      typeof raw.until !== "string" ||
      typeof raw.reason !== "string" ||
      typeof raw.quarantinedAt !== "string"
    ) {
      continue;
    }
    entries[key] = {
      until: raw.until,
      reason: raw.reason,
      quarantinedAt: raw.quarantinedAt,
      ...(typeof raw.lastRunId === "string"
        ? { lastRunId: raw.lastRunId }
        : {}),
      ...(typeof raw.noResponseAttempts === "number"
        ? { noResponseAttempts: raw.noResponseAttempts }
        : {}),
    };
  }

  return { schemaVersion: 1, entries };
}

export async function loadQuarantineStore(
  path: string,
): Promise<ModelQuarantineStore> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return emptyQuarantineStore();
  }
  try {
    return parseQuarantineStore(JSON.parse(await file.text()));
  } catch {
    return emptyQuarantineStore();
  }
}

export async function saveQuarantineStore(
  path: string,
  store: ModelQuarantineStore,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(store, null, 2)}\n`);
}

/** Drop expired entries. Returns how many were removed. */
export function pruneExpiredQuarantine(
  store: ModelQuarantineStore,
  now = new Date(),
): number {
  const nowMs = now.getTime();
  let removed = 0;
  for (const [key, entry] of Object.entries(store.entries)) {
    if (Date.parse(entry.until) <= nowMs) {
      delete store.entries[key];
      removed += 1;
    }
  }
  return removed;
}

export function isModelQuarantined(
  store: ModelQuarantineStore,
  slotOrModelId: string,
  now = new Date(),
): boolean {
  const key = quarantineModelKey(slotOrModelId);
  const entry = store.entries[key];
  if (!entry) {
    return false;
  }
  return Date.parse(entry.until) > now.getTime();
}

export function getQuarantineEntry(
  store: ModelQuarantineStore,
  slotOrModelId: string,
  now = new Date(),
): QuarantineEntry | null {
  const key = quarantineModelKey(slotOrModelId);
  const entry = store.entries[key];
  if (!entry || Date.parse(entry.until) <= now.getTime()) {
    return null;
  }
  return entry;
}

/**
 * Remove free OpenRouter slots that are still quarantined.
 * Paid / non-free model ids are never filtered here.
 */
export function filterQuarantinedModels(
  models: readonly (string | undefined)[],
  store: ModelQuarantineStore,
  now = new Date(),
): {
  kept: Array<string | undefined>;
  skipped: Array<{ model: string; until: string; reason: string }>;
} {
  const kept: Array<string | undefined> = [];
  const skipped: Array<{ model: string; until: string; reason: string }> = [];

  for (const model of models) {
    if (!model || !isOpenRouterFreeModelId(model)) {
      kept.push(model);
      continue;
    }
    const entry = getQuarantineEntry(store, model, now);
    if (entry) {
      skipped.push({ model, until: entry.until, reason: entry.reason });
      continue;
    }
    kept.push(model);
  }

  return { kept, skipped };
}

export interface QuarantineUpdate {
  modelId: string;
  entry: QuarantineEntry;
}

/**
 * After a run: free models that never produced any text answer are quarantined.
 * Models that returned at least one scored answer (even incorrect) are not quarantined.
 */
export function planQuarantineFromAttempts(
  attempts: readonly AttemptRecord[],
  options: {
    runId: string;
    now?: Date;
    quarantineMs?: number;
    minAttempts?: number;
  },
): QuarantineUpdate[] {
  const now = options.now ?? new Date();
  const quarantineMs = options.quarantineMs ?? DEFAULT_QUARANTINE_MS;
  const minAttempts = options.minAttempts ?? MIN_ATTEMPTS_TO_QUARANTINE;

  type Acc = { total: number; noResponse: number; anyAnswer: boolean };
  const byModel = new Map<string, Acc>();

  for (const attempt of attempts) {
    if (
      attempt.adapterId !== "openrouter" ||
      !attempt.model ||
      !isOpenRouterFreeModelId(attempt.model)
    ) {
      continue;
    }
    const key = quarantineModelKey(attempt.model);
    let acc = byModel.get(key);
    if (!acc) {
      acc = { total: 0, noResponse: 0, anyAnswer: false };
      byModel.set(key, acc);
    }
    acc.total += 1;
    if (isNoResponseAttempt(attempt)) {
      acc.noResponse += 1;
    } else {
      acc.anyAnswer = true;
    }
  }

  const updates: QuarantineUpdate[] = [];
  const until = new Date(now.getTime() + quarantineMs).toISOString();
  const quarantinedAt = now.toISOString();

  for (const [modelId, acc] of byModel) {
    if (acc.anyAnswer) {
      continue;
    }
    if (acc.total < minAttempts) {
      continue;
    }
    if (acc.noResponse < acc.total) {
      continue;
    }
    updates.push({
      modelId,
      entry: {
        until,
        quarantinedAt,
        lastRunId: options.runId,
        noResponseAttempts: acc.noResponse,
        reason: `No model text in ${acc.noResponse}/${acc.total} attempts (HTTP errors / timeouts / empty). Skipped for ~7 days.`,
      },
    });
  }

  return updates;
}

export function applyQuarantineUpdates(
  store: ModelQuarantineStore,
  updates: readonly QuarantineUpdate[],
): number {
  let added = 0;
  for (const update of updates) {
    store.entries[update.modelId] = update.entry;
    added += 1;
  }
  return added;
}

/** Clear a single model or all entries. Returns number removed. */
export function clearQuarantine(
  store: ModelQuarantineStore,
  modelId?: string,
): number {
  if (!modelId) {
    const count = Object.keys(store.entries).length;
    store.entries = {};
    return count;
  }
  const key = quarantineModelKey(modelId);
  if (store.entries[key]) {
    delete store.entries[key];
    return 1;
  }
  return 0;
}

export function formatQuarantineReport(
  store: ModelQuarantineStore,
  now = new Date(),
): string {
  pruneExpiredQuarantine(store, now);
  const rows = Object.entries(store.entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, entry]) => {
      const remainingMs = Date.parse(entry.until) - now.getTime();
      const remainingH = Math.max(0, Math.ceil(remainingMs / (60 * 60 * 1000)));
      return `| \`${model}\` | ${entry.until} (~${remainingH}h) | ${entry.reason.replace(/\|/g, "\\|")} |`;
    });

  if (rows.length === 0) {
    return "No free models are currently quarantined.";
  }

  return [
    `# Free-model quarantine (${rows.length})`,
    "",
    "Models that never returned text are skipped for ~7 days. Clear with `bun run bench quarantine --clear`.",
    "",
    "| Model | Until | Reason |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
