/**
 * Shared `model@effort` parsing for CLI runners (Codex, OpenCode, OpenRouter-style slots).
 * Keep this tiny and pure so new adapters only declare which efforts they accept.
 */

export function parseEffortSlot<T extends string>(
  model: string | undefined,
  allowedEfforts: readonly T[],
): { modelId?: string; effort?: T } {
  if (!model?.trim()) {
    return {};
  }
  const raw = model.trim();
  const at = raw.lastIndexOf("@");
  if (at <= 0) {
    return { modelId: raw };
  }
  const modelId = raw.slice(0, at).trim();
  const effort = raw
    .slice(at + 1)
    .trim()
    .toLowerCase() as T;
  if (!modelId || !allowedEfforts.includes(effort)) {
    // Unknown @suffix → treat whole string as the model id (defensive).
    return { modelId: raw };
  }
  return { modelId, effort };
}

/** Expand bare model ids into effort slots when the catalog lists supported efforts. */
export function expandModelEfforts(
  modelIds: readonly string[],
  effortsByModel: ReadonlyMap<string, readonly string[]>,
): string[] {
  const out: string[] = [];
  for (const id of modelIds) {
    if (id.includes("@")) {
      out.push(id);
      continue;
    }
    const efforts = effortsByModel.get(id);
    if (!efforts || efforts.length === 0) {
      out.push(id);
      continue;
    }
    for (const effort of efforts) {
      out.push(`${id}@${effort}`);
    }
  }
  return out;
}
