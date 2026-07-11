/**
 * OpenCode Zen free catalog (provider id `opencode/*`).
 * Keep this table hand-curated from `opencode models opencode --verbose` —
 * free launch-window models change often.
 */

export interface OpenCodeFreeModel {
  /** Full id: opencode/<slug> */
  id: string;
  name: string;
  /** Reasoning variants accepted by `--variant` (empty = no variants). */
  variants: readonly string[];
}

/** Zen free models currently exposed by OpenCode (cost=0 on models list). */
export const OPENCODE_FREE_MODELS: readonly OpenCodeFreeModel[] = [
  { id: "opencode/big-pickle", name: "Big Pickle", variants: [] },
  {
    id: "opencode/deepseek-v4-flash-free",
    name: "DeepSeek V4 Flash Free",
    variants: ["low", "medium", "high", "max"],
  },
  {
    id: "opencode/hy3-free",
    name: "Hy3 Free",
    variants: ["low", "medium", "high"],
  },
  {
    id: "opencode/mimo-v2.5-free",
    name: "MiMo V2.5 Free",
    variants: ["low", "medium", "high"],
  },
  {
    id: "opencode/nemotron-3-ultra-free",
    name: "Nemotron 3 Ultra Free",
    variants: ["low", "medium", "high"],
  },
  {
    id: "opencode/north-mini-code-free",
    name: "North Mini Code Free",
    variants: ["low", "medium", "high"],
  },
] as const;

/** Bare free model ids (no @variant). */
export function openCodeFreeModelIds(): string[] {
  return OPENCODE_FREE_MODELS.map((m) => m.id);
}

/**
 * Full free matrix: bare id when no variants, else one slot per variant (`id@low`, …).
 * Use this for a thorough free-suite run.
 */
export function openCodeFreeSlots(): string[] {
  const slots: string[] = [];
  for (const model of OPENCODE_FREE_MODELS) {
    if (model.variants.length === 0) {
      slots.push(model.id);
      continue;
    }
    for (const variant of model.variants) {
      slots.push(`${model.id}@${variant}`);
    }
  }
  return slots;
}
