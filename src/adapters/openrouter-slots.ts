/**
 * OpenRouter model slots.
 *
 * Logical slot ids encode optional reasoning effort:
 *   openai/gpt-oss-20b:free@high
 *   openai/gpt-oss-20b:free           (no explicit effort)
 *
 * The API model id is everything before the last `@effort` segment when the
 * suffix is a known effort level.
 */

export const REASONING_EFFORTS = [
  "max",
  "xhigh",
  "high",
  "medium",
  "low",
  "minimal",
  "none",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

const effortSet = new Set<string>(REASONING_EFFORTS);

export interface ModelSlot {
  /** Full slot label used in reports and --model values. */
  slotId: string;
  /** OpenRouter model id sent to the API. */
  modelId: string;
  /** Reasoning effort when the model supports it. */
  reasoningEffort?: ReasoningEffort;
}

export interface ReasoningMeta {
  mandatory?: boolean;
  supported_efforts?: string[] | null;
  default_effort?: string | null;
}

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return effortSet.has(value);
}

/** Parse `provider/model@high` → model + effort. Bare model ids pass through. */
export function parseModelSlot(raw: string): ModelSlot {
  const at = raw.lastIndexOf("@");
  if (at > 0) {
    const maybeEffort = raw.slice(at + 1);
    if (isReasoningEffort(maybeEffort)) {
      const modelId = raw.slice(0, at);
      if (modelId.length > 0) {
        return { slotId: raw, modelId, reasoningEffort: maybeEffort };
      }
    }
  }

  return { slotId: raw, modelId: raw };
}

export function formatModelSlot(
  modelId: string,
  effort?: ReasoningEffort,
): string {
  return effort ? `${modelId}@${effort}` : modelId;
}

/**
 * Expand a base model id into one slot per supported reasoning effort.
 * Non-reasoning models (or empty supported_efforts) yield a single bare slot.
 *
 * When the caller already pinned an effort via `@high`, returns that slot only.
 */
export function expandModelToReasoningSlots(
  raw: string,
  reasoning?: ReasoningMeta | null,
): ModelSlot[] {
  const parsed = parseModelSlot(raw);
  if (parsed.reasoningEffort) {
    return [parsed];
  }

  const efforts = (reasoning?.supported_efforts ?? []).filter(
    isReasoningEffort,
  );
  if (efforts.length === 0) {
    return [{ slotId: parsed.modelId, modelId: parsed.modelId }];
  }

  // Prefer catalog order (usually highest first); keep stable for reports.
  return efforts.map((effort) => ({
    slotId: formatModelSlot(parsed.modelId, effort),
    modelId: parsed.modelId,
    reasoningEffort: effort,
  }));
}

/**
 * For free-suite expansion: each free model becomes N slots when it has efforts.
 */
export function expandFreeModelsWithReasoning(
  freeModels: ReadonlyArray<{ id: string; reasoning?: ReasoningMeta | null }>,
): ModelSlot[] {
  const slots: ModelSlot[] = [];
  for (const model of freeModels) {
    slots.push(...expandModelToReasoningSlots(model.id, model.reasoning));
  }
  return slots;
}
